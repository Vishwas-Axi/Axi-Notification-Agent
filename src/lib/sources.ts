/**
 * Catalog of free, public news feeds the alert engine aggregates.
 *
 * The design goal is breadth + recency: a handful of broad finance wires for
 * volume, plus targeted Google News topic queries so high-value catalysts
 * (Fed/CPI/jobs/oil/geopolitics/IPOs) are never missed even if the wires bury
 * them. None of these require an API key.
 *
 * `weight` is a base trust/quality score (1–3) folded into ranking so a Reuters
 * or CNBC headline outranks an aggregator echo of the same story.
 */

export interface FeedDef {
  name: string;
  url: string;
  weight: number;
  category: "markets" | "macro" | "central-bank" | "ipo" | "general";
}

/** Google News topic search as RSS, scoped to the last 2 days for freshness. */
const gnews = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:2d`)}&hl=en-US&gl=US&ceid=US:en`;

export const FEEDS: FeedDef[] = [
  // --- Targeted high-value topics (guarantee these catalysts surface) ---
  { name: "Fed & rates", url: gnews("Federal Reserve interest rate OR FOMC OR Powell"), weight: 3, category: "central-bank" },
  { name: "Inflation / CPI", url: gnews("US inflation CPI PCE report"), weight: 3, category: "macro" },
  { name: "Jobs / payrolls", url: gnews("US jobs report nonfarm payrolls unemployment"), weight: 3, category: "macro" },
  { name: "Equities", url: gnews("US stock market Dow S&P 500 Nasdaq"), weight: 2, category: "markets" },
  { name: "Oil & energy", url: gnews("oil prices OPEC crude Brent"), weight: 2, category: "markets" },
  { name: "Geopolitics", url: gnews("markets geopolitics war sanctions tariffs"), weight: 2, category: "general" },
  { name: "IPOs", url: gnews("IPO stock market debut pricing listing"), weight: 2, category: "ipo" },
  { name: "FX & rates", url: gnews("US dollar Treasury yields bond market"), weight: 2, category: "markets" },

  // --- Broad finance wires (volume) ---
  { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", weight: 2, category: "general" },
  { name: "CNBC Top News", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", weight: 3, category: "general" },
  { name: "CNBC Markets", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", weight: 3, category: "markets" },
  { name: "CNBC Economy", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", weight: 3, category: "macro" },
  { name: "MarketWatch Top", url: "https://feeds.marketwatch.com/marketwatch/topstories/", weight: 2, category: "markets" },
  { name: "MarketWatch Realtime", url: "https://feeds.marketwatch.com/marketwatch/realtimeheadlines/", weight: 2, category: "markets" },
  { name: "Investing.com", url: "https://www.investing.com/rss/news_25.rss", weight: 1, category: "markets" },

  // --- Primary sources (authoritative, low noise) ---
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", weight: 3, category: "central-bank" },
];
