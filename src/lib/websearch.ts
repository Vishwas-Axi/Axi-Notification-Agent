/**
 * Live "hottest news" via OpenAI web search.
 *
 * The RSS catalog in `sources.ts` gives breadth, but it never *searches* the web
 * for the single hottest global stories of the day. This module asks an OpenAI
 * web-search-enabled model ("…-search-preview") to do exactly that and return a
 * small, punchy, emoji-led set of the biggest market-moving stories worldwide.
 *
 * Everything here is best-effort: any failure (no key, model unavailable, bad
 * JSON, timeout) resolves to an empty list + a warning so the dashboard never
 * blanks — the RSS pipeline remains the safety net.
 */
import OpenAI from "openai";

/** A single hot story returned by the web search, already punchy + emoji-led. */
export interface HotNewsItem {
  /** One leading emoji that fits the story (e.g. 🛢️, 🏛️, 📉). */
  emoji: string;
  /** Punchy headline, ~90 chars max. */
  headline: string;
  /** 1–2 punchy sentences with the concrete facts (levels, %, who/what). */
  summary: string;
  /** Coarse bucket used for ranking + dedup: rates | equities | oil | fx | crypto | geopolitics | macro | other. */
  category: string;
  /** Editorial impact estimate. */
  impact: "high" | "medium";
  /** Source article URL, if the model cited one. */
  url?: string;
  /** Source/publisher name, if available. */
  publisher?: string;
}

/** Web-search model. Defaults to the cheap search-preview; override per account/availability. */
const SEARCH_MODEL = process.env.OPENAI_SEARCH_MODEL || "gpt-4o-mini-search-preview";

function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set (check your .env file).");
  return new OpenAI({ apiKey });
}

const SYSTEM = `You are the markets desk editor at Axi, a global online broker. You web-search for the day's HOTTEST, most market-moving financial news worldwide and write punchy, scannable alerts.

Coverage must be GLOBAL and diverse — span as many of these as the day's news supports: central banks & rates (Fed/ECB/BoJ/BoE/PBoC), equities/indices, FX (USD/EUR/JPY/GBP), commodities & oil, crypto, and geopolitics/trade. Do NOT return several variants of the same story.

Tone: punchy, energetic, emoji-led, factual. Lead every summary with the concrete fact (a level, a %, a decision). No trade recommendations, no forecasts, no advice, no hype words like "soars/explodes" unless they are literal. Keep each summary to 1–2 short sentences.`;

const userPrompt = (now: Date, maxItems: number) =>
  `Today is ${now.toUTCString()}. Web-search the latest financial news and return the ${maxItems} HOTTEST global market-moving stories from roughly the last 24–48 hours.

Return ONLY a JSON array (no prose, no code fence) of objects with EXACTLY these keys:
- "emoji": one emoji that fits the story
- "headline": punchy headline, max ~90 chars
- "summary": 1–2 punchy sentences, lead with the concrete fact (levels/%/decision)
- "category": one of "rates" | "equities" | "oil" | "fx" | "crypto" | "geopolitics" | "macro" | "other"
- "impact": "high" or "medium"
- "url": the source article URL
- "publisher": the source name

Make the set DIVERSE (different stories/assets/regions), most impactful first.`;

/** Pull the first JSON array out of a model response, tolerating fences/preamble. */
function extractJsonArray(raw: string): unknown[] {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalize(rows: unknown[], maxItems: number): HotNewsItem[] {
  const out: HotNewsItem[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const headline = clean(o.headline) || clean(o.title);
    const summary = clean(o.summary) || clean(o.text);
    if (!headline || !summary) continue;
    const url = clean(o.url) || undefined;
    out.push({
      emoji: clean(o.emoji) || "📰",
      headline: headline.slice(0, 140),
      summary,
      category: (clean(o.category) || "other").toLowerCase(),
      impact: clean(o.impact).toLowerCase() === "high" ? "high" : "medium",
      url: url && /^https?:\/\//i.test(url) ? url : undefined,
      publisher: clean(o.publisher) || undefined,
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Web-search for the day's hottest global financial stories.
 * Never throws — returns `{ items: [], warnings: [...] }` on any failure.
 */
export async function fetchHotFinancialNews(
  now: Date,
  maxItems = 6,
): Promise<{ items: HotNewsItem[]; warnings: string[] }> {
  if (!process.env.OPENAI_API_KEY) {
    return { items: [], warnings: ["websearch: OPENAI_API_KEY not set — skipping live web search."] };
  }
  try {
    const openai = client();
    // Search-preview models run web search automatically; they do NOT accept
    // `temperature`, so it is intentionally omitted.
    const resp = await openai.chat.completions.create({
      model: SEARCH_MODEL,
      max_tokens: 1500,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(now, maxItems) },
      ],
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "";
    const items = normalize(extractJsonArray(raw), maxItems);
    if (items.length === 0) {
      return { items: [], warnings: [`websearch: ${SEARCH_MODEL} returned no usable stories this refresh.`] };
    }
    return { items, warnings: [] };
  } catch (e) {
    return {
      items: [],
      warnings: [`websearch: live search via ${SEARCH_MODEL} failed (${(e as Error).message}).`],
    };
  }
}
