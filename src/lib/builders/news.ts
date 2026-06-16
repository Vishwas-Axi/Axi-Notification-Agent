import type { Alert } from "@/lib/types";
import { getGeneralNews, getStockNews, type NewsItem } from "@/lib/fmp";
import { fetchFeed, type RssItem } from "@/lib/rss";
import { FEEDS } from "@/lib/sources";
import { fillTemplate } from "@/lib/templates";
import { mapLimit } from "@/lib/concurrency";
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
  "treasury yield", "bond yield", "debt ceiling", "shutdown", "powell",
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
  "the a an to of in on for and as is are us after amid over says say new will with at by from be has have its it this that into than amp how"
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

/** Jaccard similarity of two token sets (0..1). */
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
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

/**
 * Build breaking-news / volatility-watch alerts from many free public feeds
 * (RSS: Yahoo, CNBC, MarketWatch, Google News topics, the Fed) plus the FMP
 * news endpoints as one more source. Headlines are de-duplicated across sources,
 * filtered for recency, and ranked by impact + source quality so the highest-value
 * items always surface first. Every news alert is flagged for human review before
 * any external distribution.
 */
export async function buildNewsAlerts(
  now: Date,
  snapshot: MarketSnapshot,
): Promise<{ alerts: Alert[]; warnings: string[] }> {
  const warnings: string[] = [];

  // --- Fetch every RSS feed concurrently (bounded), plus FMP news. All tolerant. ---
  const rssResults = await mapLimit(FEEDS, 6, async (f) => {
    const items = await fetchFeed(f.url, f.name);
    return { feed: f, items };
  });

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

  // --- Normalize everything into one Headline + weight stream. ---
  type Scored = { h: Headline; weight: number };
  const raw: Scored[] = [];

  for (const r of rssResults) {
    const isGoogle = r.feed.url.includes("news.google.com");
    for (const it of r.items as RssItem[]) {
      const { title, publisher } = isGoogle
        ? splitPublisher(it.title, it.publisher || r.feed.name)
        : { title: it.title, publisher: it.publisher || r.feed.name };
      raw.push({
        h: { title, link: it.link, publishedDate: it.publishedDate, publisher, feed: r.feed.name },
        weight: r.feed.weight,
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
    });
  }

  if (raw.length === 0) {
    warnings.push("news: no public feeds returned data this refresh.");
    return { alerts: [], warnings };
  }

  // --- De-dup across sources, keep recent + relevant, rank. ---
  const bestByKey = new Map<string, { h: Headline; score: number; hits: string[]; major: boolean }>();
  for (const { h, weight } of raw) {
    if (!h.title) continue;
    if (hoursAgo(h.publishedDate, now) > RECENCY_HOURS) continue;
    const sc = score(h, weight);
    if (sc.score < 2) continue; // require at least some market relevance
    const key = dedupKey(h.title);
    if (!key) continue;
    const existing = bestByKey.get(key);
    // Keep the highest-scoring variant; tie-break to the more recent one.
    if (
      !existing ||
      sc.score > existing.score ||
      (sc.score === existing.score && h.publishedDate > existing.h.publishedDate)
    ) {
      bestByKey.set(key, { h, score: sc.score, hits: sc.hits, major: sc.major });
    }
  }

  // Rank by impact, then suppress near-duplicates (same story across wires /
  // slightly reworded headlines) via token-set similarity before capping.
  const sorted = [...bestByKey.values()].sort(
    (a, b) => b.score - a.score || (a.h.publishedDate < b.h.publishedDate ? 1 : -1),
  );
  const ranked: typeof sorted = [];
  const acceptedSets: Set<string>[] = [];
  for (const c of sorted) {
    const ts = tokenSet(c.h.title);
    if (acceptedSets.some((s) => jaccard(ts, s) >= 0.6)) continue;
    acceptedSets.push(ts);
    ranked.push(c);
    if (ranked.length >= MAX_NEWS) break;
  }

  if (ranked.length === 0) {
    warnings.push("news: feeds returned data but nothing matched the relevance/recency filters.");
  }

  const ctx = assetLine(snapshot);
  const alerts: Alert[] = [];

  for (const r of ranked) {
    const { h, hits, major, score: sc } = r;
    const topic = hits.slice(0, 3).join(", ") || "market-moving development";
    const { text } = fillTemplate("news_volatility", {
      headline: h.title,
      publisher: h.publisher,
      published_ago: ago(h.publishedDate, now),
      topic,
      asset_move_summary: ctx || "Live market context unavailable.",
    });

    alerts.push(
      makeAlert({
        id: `news-${Buffer.from(dedupKey(h.title) || h.title).toString("base64url").slice(0, 24)}`,
        family: "news",
        title: h.title.slice(0, 110) + (h.title.length > 110 ? "…" : ""),
        timing: major ? "Breaking" : "Watch",
        severity: major && sc >= 6 ? "high" : "watch",
        baseline: text,
        missing: [],
        forceReview: true,
        reviewReason: "Breaking news — verify against the source and review before external distribution.",
        sources: [
          { label: h.publisher || h.feed, url: h.link || "https://news.google.com/" },
        ],
        priority: 40 + sc,
        payload: {
          headline: h.title,
          publisher: h.publisher,
          feed: h.feed,
          publishedDate: h.publishedDate,
          url: h.link,
          keywordHits: hits,
          score: sc,
        },
      }),
    );
  }

  return { alerts, warnings };
}
