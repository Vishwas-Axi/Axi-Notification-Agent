/**
 * Financial Modeling Prep client — targets the modern `/stable/` endpoints.
 * (The legacy `/api/v3/` endpoints return 403 for stable-only keys.)
 */

const BASE = "https://financialmodelingprep.com";

function apiKey(): string {
  const k = process.env.FMP_API_KEY;
  if (!k) throw new Error("FMP_API_KEY is not set (check your .env file).");
  return k;
}

async function fmpGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("apikey", apiKey());

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    // 402 = endpoint/symbol needs a paid plan; surface a readable message.
    throw new Error(`FMP ${path} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface EconEvent {
  date: string;
  country: string;
  event: string;
  currency: string;
  previous: number | null;
  estimate: number | null;
  actual: number | null;
  change: number | null;
  changePercentage: number | null;
  impact: string;
  unit: string | null;
}

export function getEconomicCalendar(from: string, to: string) {
  return fmpGet<EconEvent[]>("/stable/economic-calendar", { from, to });
}

export interface IpoEvent {
  symbol: string;
  date: string;
  daa?: string;
  company: string;
  exchange: string;
  actions: string;
  shares: number | null;
  priceRange: string | null;
  marketCap: number | null;
}

export function getIpoCalendar(from: string, to: string) {
  return fmpGet<IpoEvent[]>("/stable/ipos-calendar", { from, to });
}

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  changePercentage: number;
  change: number;
  volume: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
}

export async function getQuote(symbol: string): Promise<Quote | undefined> {
  const r = await fmpGet<Quote[] | Quote>("/stable/quote", { symbol });
  if (Array.isArray(r)) return r[0];
  return r as Quote;
}

export interface NewsItem {
  symbol: string | null;
  publishedDate: string;
  publisher: string;
  title: string;
  image: string | null;
  site: string;
  text: string;
  url: string;
}

export function getGeneralNews(limit = 30) {
  return fmpGet<NewsItem[]>("/stable/news/general-latest", { page: 0, limit });
}

export function getStockNews(limit = 30) {
  return fmpGet<NewsItem[]>("/stable/news/stock-latest", { page: 0, limit });
}

export interface TreasuryRates {
  date: string;
  month1: number;
  month2: number;
  month3: number;
  month6: number;
  year1: number;
  year2: number;
  year3: number;
  year5: number;
  year7: number;
  year10: number;
  year20: number;
  year30: number;
}

export function getTreasuryRates(from: string, to: string) {
  return fmpGet<TreasuryRates[]>("/stable/treasury-rates", { from, to });
}
