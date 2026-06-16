import type { Alert } from "@/lib/types";
import { getQuote, getTreasuryRates, type Quote } from "@/lib/fmp";

export interface MakeAlertInput {
  id: string;
  family: Alert["family"];
  title: string;
  timing?: string;
  eventDate?: string;
  severity: Alert["severity"];
  baseline: string;
  missing: string[];
  sources: Alert["sources"];
  payload: Record<string, unknown>;
  priority: number;
  /** Force needs_review even when no fields are missing (e.g. breaking news). */
  forceReview?: boolean;
  reviewReason?: string;
}

export function makeAlert(o: MakeAlertInput): Alert {
  const needsReview = o.forceReview || o.missing.length > 0;
  const reason =
    o.reviewReason ??
    (o.missing.length > 0 ? `Missing data: ${o.missing.join(", ")}` : undefined);
  return {
    id: o.id,
    family: o.family,
    title: o.title,
    timing: o.timing,
    eventDate: o.eventDate,
    severity: o.severity,
    status: needsReview ? "needs_review" : "ready",
    draft: o.baseline,
    baseline: o.baseline,
    refined: false,
    needsReviewReason: needsReview ? reason : undefined,
    sources: o.sources,
    payload: o.payload,
    priority: o.priority,
  };
}

/** Curated set of assets that resolve on the FMP free/stable tier. */
export const MARKET_SYMBOLS: { key: string; symbol: string; label: string }[] = [
  { key: "sp500", symbol: "^GSPC", label: "S&P 500" },
  { key: "nasdaq", symbol: "^IXIC", label: "Nasdaq Composite" },
  { key: "dow", symbol: "^DJI", label: "Dow Jones" },
  { key: "gold", symbol: "GCUSD", label: "Gold" },
  { key: "brent", symbol: "BZUSD", label: "Brent Crude" },
  { key: "eurusd", symbol: "EURUSD", label: "EUR/USD" },
  { key: "usdjpy", symbol: "USDJPY", label: "USD/JPY" },
  { key: "btc", symbol: "BTCUSD", label: "Bitcoin" },
];

export interface MarketSnapshot {
  quotes: Record<string, Quote>;
  /** 10Y Treasury yield (latest) and day-over-day change in basis points. */
  yield10y?: { latest: number; changeBps: number | null };
  warnings: string[];
}

/** Fetch all tracked quotes + the 10Y yield. Tolerant: any symbol that errors is skipped. */
export async function buildMarketSnapshot(): Promise<MarketSnapshot> {
  const snapshot: MarketSnapshot = { quotes: {}, warnings: [] };

  const results = await Promise.allSettled(
    MARKET_SYMBOLS.map(async (s) => ({ key: s.key, quote: await getQuote(s.symbol) })),
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value.quote) {
      snapshot.quotes[r.value.key] = r.value.quote;
    } else {
      snapshot.warnings.push(`market: ${MARKET_SYMBOLS[i].label} unavailable`);
    }
  }

  // 10Y yield from treasury-rates (^TNX is paid-only on the free tier).
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 12 * 86_400_000);
    const rows = await getTreasuryRates(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (sorted[0]) {
      const latest = sorted[0].year10;
      const prev = sorted[1]?.year10;
      snapshot.yield10y = {
        latest,
        changeBps: prev !== undefined ? Math.round((latest - prev) * 100) : null,
      };
    }
  } catch {
    snapshot.warnings.push("market: 10Y treasury yield unavailable");
  }

  return snapshot;
}

export function fmtPct(q: Quote | undefined): string {
  if (!q) return "n/a";
  const sign = q.changePercentage >= 0 ? "+" : "";
  return `${q.price} (${sign}${q.changePercentage.toFixed(2)}%)`;
}
