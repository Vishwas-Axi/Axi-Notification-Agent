/**
 * Lightweight RSS 2.0 / Atom reader — zero dependencies, no API key.
 *
 * Used to aggregate breaking market news from many public feeds (Yahoo Finance,
 * CNBC, MarketWatch, Google News topic queries, the Federal Reserve, ...) so the
 * dashboard is never dependent on a single provider. Every feed is fetched with a
 * short timeout and parsing is tolerant — a malformed or unreachable feed simply
 * yields no items instead of throwing.
 */

export interface RssItem {
  title: string;
  link: string;
  /** ISO 8601, or "" when the feed gave no parseable date. */
  publishedDate: string;
  /** Display name of the feed it came from. */
  feed: string;
  /** Original publisher when the feed exposes one (e.g. Google News <source>). */
  publisher: string;
  summary: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&apos;": "'", "&#39;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Remove CDATA wrappers, strip nested HTML, decode entities. */
function clean(raw: string | null): string {
  if (!raw) return "";
  const noCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(stripTags(noCdata)).trim();
}

function firstTag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
}

function attrOf(block: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
}

function toIso(dateStr: string | null): string {
  if (!dateStr) return "";
  const t = Date.parse(dateStr.trim());
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

/** Parse a raw feed body (RSS 2.0 or Atom) into normalized items. */
export function parseFeed(xml: string, feedName: string): RssItem[] {
  const items: RssItem[] = [];

  // --- RSS 2.0 <item> ---
  const rssBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of rssBlocks) {
    const title = clean(firstTag(block, "title"));
    if (!title) continue;
    let link = clean(firstTag(block, "link"));
    if (!link) link = attrOf(block, "link", "href") ?? "";
    const pub =
      firstTag(block, "pubDate") ?? firstTag(block, "dc:date") ?? firstTag(block, "published");
    const publisher = clean(firstTag(block, "source"));
    const summary = clean(firstTag(block, "description"));
    items.push({ title, link, publishedDate: toIso(pub), feed: feedName, publisher, summary });
  }
  if (items.length) return items;

  // --- Atom <entry> ---
  const atomBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of atomBlocks) {
    const title = clean(firstTag(block, "title"));
    if (!title) continue;
    const link = attrOf(block, "link", "href") ?? clean(firstTag(block, "id"));
    const pub = firstTag(block, "updated") ?? firstTag(block, "published");
    const summary = clean(firstTag(block, "summary")) || clean(firstTag(block, "content"));
    items.push({ title, link, publishedDate: toIso(pub), feed: feedName, publisher: "", summary });
  }
  return items;
}

const UA =
  "Mozilla/5.0 (compatible; AxiAlertCenter/1.0; +https://www.axi.com) news-aggregator";

/** Fetch and parse a single feed. Never throws — returns [] on any error/timeout. */
export async function fetchFeed(url: string, feedName: string, timeoutMs = 8000): Promise<RssItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml, feedName);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
