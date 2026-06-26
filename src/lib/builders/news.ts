import type { Alert } from "@/lib/types";
import { getGeneralNews, getStockNews, type NewsItem } from "@/lib/fmp";
import { fetchFeed, type RssItem } from "@/lib/rss";
import { FEEDS } from "@/lib/sources";
import { fillTemplate } from "@/lib/templates";
import { mapLimit } from "@/lib/concurrency";
import { fetchHotFinancialNews, type HotNewsItem } from "@/lib/websearch";
import { makeAlert, type MarketSnapshot } from "./shared";

/**
 * High-impact keywords (weighted x3) — the catalysts that move markets and that
 * we never want buried under routine headlines.
 */
const MAJOR = [
  "fed", "fomc", "rate decision", "rate cut", "rate hike", "interest rate", "cpi", "inflation",
  "pce", "nonfarm", "non-farm", "payroll", "jobs report", "unemployment", "recession", "gdp",
  "default", "downgrade", "crash", "selloff", "sell-off", "plunge", "rout", "crisis", "war",
  "invasion", "ceasefire", "sanction", "tariff", "opec", "central bank", "ecb", "boj",
  "treasury yield", "bond yield", "debt ceiling", "shutdown", "powell", "warsh",
];

/** Secondary keywords (weighted x1) — relevant context, not headline catalysts. */
const MINOR = [
  "earnings", "guidance", "merger", "acquisition", "ipo", "layoff", "stimulus", "jobless",
  "retail sales", "pmi", "manufacturing", "housing", "oil", "crude", "gold", "dollar",
  "bitcoin", "crypto", "stocks", "nasdaq", "dow", "s&p", "yields", "bond", "fed chair",
  "consumer", "spending", "trade", "china", "europe", "energy",
];

/** Items older than this are dropped (Google News queries are already scoped to ~2 days). */
const RECENCY_HOURS = 48;
/** Max number of news cards to surface. */
const MAX_NEWS = 10;
/** How many live web-search "hottest" stories to request. */
const HOT_WEBSEARCH = 6;
/** Weight given to a live web-search story so it outranks RSS echoes of itself. */
const WEBSEARCH_WEIGHT = 4;

function pctOnly(q: { changePercentage: number } | undefined): string {
  if (!q) return "";
  const s = q.changePercentage >= 0 ? "+" : "";
  return `${s}${q.changePercentage.toFixed(2)}%`;
}

/** One compact line of cross-asset context (facts only, no interpretation). */
function assetLine(snapshot: MarketSnapshot): string {
  const q = snapshot.quotes;
  const parts = [
    q.sp500 && `S&P ${pctOnly(q.sp500)}`,
    q.nasdaq && `Nasdaq ${pctOnly(q.nasdaq)}`,
    q.gold && `Gold ${pctOnly(q.gold)}`,
    q.brent && `Brent ${pctOnly(q.brent)}`,
    q.eurusd && `EUR/USD ${pctOnly(q.eurusd)}`,
    q.btc && `BTC ${pctOnly(q.btc)}`,
    snapshot.yield10y && `US10Y ${snapshot.yield10y.latest}%`,
  ].filter(Boolean);
  return parts.length ? `Market snapshot — ${parts.join(", ")}.` : "";
}

interface Headline {
  title: string;
  link: string;
  publishedDate: string;
  publisher: string;
  feed: string;
}

/** A scored news candidate, carrying optional web-search enrichment. */
interface Candidate {
  h: Headline;
  weight: number;
  fromWebSearch: boolean;
  emoji?: string;
  summary?: string;
  category?: string;
}

/** A distinct top story handed to the correlation builder. */
export interface HotStory {
  emoji: string;
  headline: string;
  /** Short factual blurb (web-search summary, or headline + topic for RSS). */
  blurb: string;
  category: string;
  entities: string[];
  url?: string;
  publisher?: string;
  fromWebSearch: boolean;
}

/** Google News titles arrive as "Headline - Publisher"; split that out for display. */
function splitPublisher(title: string, fallback: string): { title: string; publisher: string } {
  const m = title.match(/^(.*\S)\s+[-–—]\s+([^-–—]{2,42})$/);
  if (m && m[2].split(" ").length <= 6) return { title: m[1].trim(), publisher: m[2].trim() };
  return { title: title.trim(), publisher: fallback };
}

/** Normalize a title to a dedup signature so the same story from 3 wires collapses to 1. */
function dedupKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+[-|–—]\s+[^-|–—]+$/, "") // trailing " - Publisher"
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|a|an|to|of|in|on|for|and|as|is|are|us|after|amid|over|says|say|new|will)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
}

const STOP = new Set(
  "the a an to of in on for and as is are us after amid over says say new will with at by from be has have its it this that into than amp how could would more first early test face faces step steps role amid ahead than other matters reached across board"
    .split(" "),
);

/** Significant-token set (light singularization) used for near-duplicate detection. */
function tokenSet(title: string): Set<string> {
  const toks = title
    .toLowerCase()
    .replace(/\s+[-|–—]\s+[^-|–—]+$/, "") // trailing " - Publisher"
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
  return new Set(toks);
}

/**
 * Distinctive entities — the named people / institutions / places / assets a
 * headline is *about*. Two headlines sharing the same dominant entity are almost
 * always the same story even when worded completely differently (e.g. five
 * different "Kevin Warsh / new Fed Chair" rewrites). Generic words like "stocks"
 * or "market" are deliberately excluded so unrelated stories never merge on them.
 */
const ENTITY_RULES: [RegExp, string][] = [
  [/\bwarsh\b/, "warsh"],
  [/\bpowell\b/, "powell"],
  [/\btrump\b/, "trump"],
  [/\b(fed|fomc|federal reserve)\b/, "fed"],
  [/\becb\b/, "ecb"],
  [/\b(boj|bank of japan)\b/, "boj"],
  [/\b(boe|bank of england)\b/, "boe"],
  [/\b(pboc|china central bank)\b/, "pboc"],
  [/\biran\b/, "iran"],
  [/\bisrael\b/, "israel"],
  [/\bhormuz\b/, "hormuz"],
  [/\b(russia|ukraine|kremlin|putin)\b/, "russia-ukraine"],
  [/\bchina\b/, "china"],
  [/\bopec\b/, "opec"],
  [/\b(oil|crude|brent|wti)\b/, "oil"],
  [/\bgold\b/, "gold"],
  [/\b(bitcoin|btc|ether|ethereum|crypto)\b/, "crypto"],
  [/\b(treasury|treasuries|yield|yields|bond)\b/, "rates"],
  [/\b(cpi|inflation|pce)\b/, "inflation"],
  [/\b(payroll|payrolls|nonfarm|non-farm|jobs report|unemployment|jobless)\b/, "jobs"],
  [/\b(tariff|tariffs)\b/, "tariffs"],
  [/\bnvidia\b/, "nvidia"],
  [/\bmicron\b/, "micron"],
  [/\brheinmetall\b/, "rheinmetall"],
];

function distinctiveEntities(title: string): Set<string> {
  const hay = title.toLowerCase();
  const out = new Set<string>();
  for (const [re, name] of ENTITY_RULES) if (re.test(hay)) out.add(name);
  return out;
}

/** Jaccard similarity of two token sets (0..1). */
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function intersize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** A story signature used for clustering. */
interface Sig {
  tokens: Set<string>;
  entities: Set<string>;
}

/**
 * Decide whether `cand` is the same underlying story as an already-accepted one.
 * Word overlap alone misses reworded wire copy, so we ALSO merge on shared
 * distinctive entities — this is what collapses the duplicate clusters.
 */
function isDuplicate(cand: Sig, accepted: Sig): boolean {
  const jac = jaccard(cand.tokens, accepted.tokens);
  if (jac >= 0.5) return true; // near-identical wording
  const sharedEnt = intersize(cand.entities, accepted.entities);
  if (sharedEnt >= 2) return true; // two distinctive entities in common → same story
  if (sharedEnt >= 1 && jac >= 0.28) return true; // one entity + decent overlap
  return false;
}

function hoursAgo(iso: string, now: Date): number {
  if (!iso) return 9999;
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000;
}

function ago(iso: string, now: Date): string {
  const h = hoursAgo(iso, now);
  if (h >= 9000) return "recent";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function score(h: Headline, feedWeight: number): { score: number; hits: string[]; major: boolean } {
  const hay = h.title.toLowerCase();
  const majorHits = MAJOR.filter((k) => hay.includes(k));
  const minorHits = MINOR.filter((k) => hay.includes(k));
  const hits = [...new Set([...majorHits, ...minorHits])];
  return { score: majorHits.length * 3 + minorHits.length + feedWeight, hits, major: majorHits.length > 0 };
}

/** Coarse story category from keyword hits (for the deterministic leading emoji). */
function categoryFromHits(hits: string[]): string {
  const has = (...k: string[]) => k.some((x) => hits.includes(x));
  if (has("fed", "fomc", "powell", "warsh", "interest rate", "rate cut", "rate hike", "rate decision", "central bank", "ecb", "boj", "treasury yield", "bond yield", "yields", "bond", "fed chair"))
    return "rates";
  if (has("cpi", "inflation", "pce", "payroll", "nonfarm", "non-farm", "jobs report", "unemployment", "jobless", "gdp", "pmi", "retail sales", "housing", "manufacturing"))
    return "macro";
  if (has("oil", "crude", "opec", "energy")) return "oil";
  if (has("dollar", "yields")) return "fx";
  if (has("bitcoin", "crypto")) return "crypto";
  if (has("war", "invasion", "ceasefire", "sanction", "tariff", "china")) return "geopolitics";
  if (has("stocks", "nasdaq", "dow", "s&p", "selloff", "sell-off", "plunge", "rout", "crash")) return "equities";
  return "other";
}

const EMOJI_BY_CAT: Record<string, string> = {
  rates: "🏛️",
  macro: "📊",
  oil: "🛢️",
  equities: "📉",
  fx: "💱",
  crypto: "🪙",
  geopolitics: "🌍",
  other: "📰",
};

function emojiFor(category: string, major: boolean): string {
  if (EMOJI_BY_CAT[category]) return EMOJI_BY_CAT[category];
  return major ? "🔥" : "📰";
}

/**
 * Build punchy, emoji-led breaking-news / volatility-watch alerts.
 *
 * Sources: a live OpenAI web search for the day's hottest global stories
 * (the spine) PLUS many free public RSS feeds (Yahoo, CNBC, MarketWatch, Google
 * News topics, the Fed) and FMP news for breadth. Headlines are de-duplicated by
 * BOTH word overlap and shared distinctive entities (so the same story reworded
 * across five wires collapses to one), filtered for recency, and ranked by impact
 * + source quality. Every news alert is flagged for human review before any
 * external distribution. Also returns the deduped top stories for correlation.
 */
export async function buildNewsAlerts(
  now: Date,
  snapshot: MarketSnapshot,
): Promise<{ alerts: Alert[]; warnings: string[]; topStories: HotStory[] }> {
  const warnings: string[] = [];

  // --- Live web search (the hottest global stories) + every RSS feed + FMP news. ---
  const [hotRes, rssResults] = await Promise.all([
    fetchHotFinancialNews(now, HOT_WEBSEARCH),
    mapLimit(FEEDS, 6, async (f) => ({ feed: f, items: await fetchFeed(f.url, f.name) })),
  ]);
  warnings.push(...hotRes.warnings);

  const fmpItems: NewsItem[] = [];
  try {
    const [general, stock] = await Promise.all([
      getGeneralNews(40).catch(() => [] as NewsItem[]),
      getStockNews(40).catch(() => [] as NewsItem[]),
    ]);
    fmpItems.push(...general, ...stock);
  } catch {
    /* FMP news is optional supplemental volume; ignore failures. */
  }

  // --- Normalize everything into one candidate stream. ---
  const raw: Candidate[] = [];

  // Web-search hot stories first — the curated spine (treated as "now", high weight).
  for (const it of hotRes.items as HotNewsItem[]) {
    raw.push({
      h: {
        title: it.headline,
        link: it.url || "https://news.google.com/",
        publishedDate: now.toISOString(),
        publisher: it.publisher || "Web search",
        feed: "Web search · Hot",
      },
      weight: WEBSEARCH_WEIGHT,
      fromWebSearch: true,
      emoji: it.emoji,
      summary: it.summary,
      category: it.category,
    });
  }

  for (const r of rssResults) {
    const isGoogle = r.feed.url.includes("news.google.com");
    for (const it of r.items as RssItem[]) {
      const { title, publisher } = isGoogle
        ? splitPublisher(it.title, it.publisher || r.feed.name)
        : { title: it.title, publisher: it.publisher || r.feed.name };
      raw.push({
        h: { title, link: it.link, publishedDate: it.publishedDate, publisher, feed: r.feed.name },
        weight: r.feed.weight,
        fromWebSearch: false,
      });
    }
  }
  for (const it of fmpItems) {
    raw.push({
      h: {
        title: it.title,
        link: it.url,
        publishedDate: it.publishedDate ? new Date(it.publishedDate.replace(" ", "T") + "Z").toISOString() : "",
        publisher: it.publisher || it.site || "FMP",
        feed: "FMP news",
      },
      weight: 1,
      fromWebSearch: false,
    });
  }

  if (raw.length === 0) {
    warnings.push("news: no public feeds or web search returned data this refresh.");
    return { alerts: [], warnings, topStories: [] };
  }

  // --- De-dup by exact key, keeping the best-scoring variant per key. ---
  interface Best {
    c: Candidate;
    score: number;
    hits: string[];
    major: boolean;
  }
  const bestByKey = new Map<string, Best>();
  for (const c of raw) {
    if (!c.h.title) continue;
    if (!c.fromWebSearch && hoursAgo(c.h.publishedDate, now) > RECENCY_HOURS) continue;
    const sc = score(c.h, c.weight);
    const total = sc.score + (c.fromWebSearch ? 6 : 0); // web-search stories are curated → always relevant
    if (!c.fromWebSearch && sc.score < 2) continue; // require some market relevance for raw feeds
    const key = c.fromWebSearch ? `ws:${dedupKey(c.h.title)}` : dedupKey(c.h.title);
    if (!key) continue;
    const existing = bestByKey.get(key);
    if (
      !existing ||
      total > existing.score ||
      (total === existing.score && c.h.publishedDate > existing.c.h.publishedDate)
    ) {
      bestByKey.set(key, { c, score: total, hits: sc.hits, major: sc.major || c.fromWebSearch });
    }
  }

  // --- Rank by impact, then collapse near-duplicates via word + entity clustering. ---
  const sorted = [...bestByKey.values()].sort(
    (a, b) => b.score - a.score || (a.c.h.publishedDate < b.c.h.publishedDate ? 1 : -1),
  );
  const ranked: Best[] = [];
  const acceptedSigs: Sig[] = [];
  for (const cand of sorted) {
    const sig: Sig = { tokens: tokenSet(cand.c.h.title), entities: distinctiveEntities(cand.c.h.title) };
    if (acceptedSigs.some((s) => isDuplicate(sig, s))) continue;
    acceptedSigs.push(sig);
    ranked.push(cand);
    if (ranked.length >= MAX_NEWS) break;
  }

  if (ranked.length === 0) {
    warnings.push("news: feeds returned data but nothing matched the relevance/recency filters.");
  }

  const ctx = assetLine(snapshot);
  const alerts: Alert[] = [];
  const topStories: HotStory[] = [];

  for (const r of ranked) {
    const { c, hits, major, score: sc } = r;
    const h = c.h;
    const category = c.fromWebSearch ? c.category || categoryFromHits(hits) : categoryFromHits(hits);
    const emoji = c.fromWebSearch && c.emoji ? c.emoji : emojiFor(category, major);
    const topic = hits.slice(0, 3).join(", ") || "market-moving development";

    let baseline: string;
    if (c.fromWebSearch && c.summary) {
      // Already punchy from the web-search model — keep it, just frame it.
      baseline = `${emoji} ${h.title}\n\n${c.summary}\n${h.publisher} · ${ago(h.publishedDate, now)}`;
    } else {
      baseline = fillTemplate("news_volatility", {
        emoji,
        headline: h.title,
        publisher: h.publisher,
        published_ago: ago(h.publishedDate, now),
        topic,
        asset_move_summary: ctx || "Live market context unavailable.",
      }).text;
    }

    alerts.push(
      makeAlert({
        id: `news-${Buffer.from(dedupKey(h.title) || h.title).toString("base64url").slice(0, 24)}`,
        family: "news",
        title: `${emoji} ${h.title.slice(0, 108)}${h.title.length > 108 ? "…" : ""}`,
        timing: c.fromWebSearch ? "🔥 Hot" : major ? "Breaking" : "Watch",
        severity: (major && sc >= 6) || c.fromWebSearch ? "high" : "watch",
        baseline,
        missing: [],
        forceReview: true,
        reviewReason: "Breaking news — verify against the source and review before external distribution.",
        sources: [{ label: h.publisher || h.feed, url: h.link || "https://news.google.com/" }],
        priority: 40 + sc,
        payload: {
          headline: h.title,
          publisher: h.publisher,
          feed: h.feed,
          publishedDate: h.publishedDate,
          url: h.link,
          keywordHits: hits,
          category,
          fromWebSearch: c.fromWebSearch,
          score: sc,
        },
      }),
    );

    topStories.push({
      emoji,
      headline: h.title,
      blurb: c.fromWebSearch && c.summary ? c.summary : `${h.title} (${topic}).`,
      category,
      entities: [...distinctiveEntities(h.title)],
      url: h.link,
      publisher: h.publisher,
      fromWebSearch: c.fromWebSearch,
    });
  }

  return { alerts, warnings, topStories };
}
