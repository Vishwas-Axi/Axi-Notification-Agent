import type { Alert } from "@/lib/types";
import { getIpoCalendar, type IpoEvent } from "@/lib/fmp";
import { fillTemplate } from "@/lib/templates";
import { isoDate, addDays, prettyDate } from "@/lib/dates";
import { makeAlert } from "./shared";

const SOURCES = [
  { label: "FMP IPO calendar", url: "https://site.financialmodelingprep.com/developer/docs/stable/ipos-calendar" },
  { label: "SEC EDGAR", url: "https://www.sec.gov/search-filings" },
];

function fmtCap(v: number | null): string {
  if (!v) return "";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v}`;
}

/**
 * Build IPO alerts from the FMP IPO calendar.
 * v1 covers Preview (and a pricing-style summary when a price range is set).
 * The "instrument live / first-trade" alert is intentionally out of scope — it requires
 * internal platform status, per the research doc §4.3.
 */
export async function buildIpoAlerts(now: Date): Promise<{ alerts: Alert[]; warnings: string[] }> {
  const warnings: string[] = [];
  const alerts: Alert[] = [];

  const from = isoDate(now);
  const to = isoDate(addDays(now, 30));
  let ipos: IpoEvent[] = [];
  try {
    ipos = await getIpoCalendar(from, to);
  } catch (e) {
    warnings.push(`ipo: calendar unavailable (${(e as Error).message})`);
    return { alerts, warnings };
  }

  // Prioritise larger / nearer deals; cap to keep the dashboard readable and the LLM cost low.
  const ranked = ipos
    .filter((i) => i.symbol && i.company)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, 6);

  for (const ipo of ranked) {
    const hasPrice = !!ipo.priceRange;
    const key = hasPrice ? "ipo_pricing" : "ipo_preview";
    const { text, missing } = fillTemplate(key as "ipo_pricing" | "ipo_preview", {
      company_name: ipo.company,
      symbol: ipo.symbol,
      exchange: ipo.exchange || "TBC",
      price_range: ipo.priceRange || "TBC",
      listing_date: prettyDate(ipo.date),
      shares: ipo.shares ? ipo.shares.toLocaleString("en-US") : "TBC",
      market_cap: fmtCap(ipo.marketCap),
    });

    alerts.push(makeAlert({
      id: `ipo-${ipo.symbol}-${ipo.date}`,
      family: "ipo",
      title: `IPO ${hasPrice ? "Pricing" : "Watch"}: ${ipo.company} (${ipo.symbol})`,
      timing: hasPrice ? "Pricing" : "Preview",
      eventDate: ipo.date,
      severity: "info",
      baseline: text,
      // 'shares' / 'price_range' are often genuinely TBC for early filings — don't flag those.
      missing: missing.filter((m) => !["shares", "price_range", "market_cap", "exchange"].includes(m)),
      sources: SOURCES,
      priority: 45,
      payload: { ...ipo },
    }));
  }

  return { alerts, warnings };
}
