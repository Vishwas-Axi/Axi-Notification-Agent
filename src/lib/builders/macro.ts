import type { Alert } from "@/lib/types";
import { getEconomicCalendar, type EconEvent } from "@/lib/fmp";
import { fillTemplate } from "@/lib/templates";
import { isoDate, addDays, prettyDate } from "@/lib/dates";
import { makeAlert, fmtPct, type MarketSnapshot } from "./shared";

/** Macro events we care about, with the patterns used to match FMP event names. */
const MACRO_EVENTS: { name: string; patterns: RegExp[]; source: { label: string; url: string } }[] = [
  {
    name: "Non-Farm Payrolls",
    patterns: [/non.?farm/i, /nonfarm payroll/i, /payrolls/i],
    source: { label: "BLS Employment Situation schedule", url: "https://www.bls.gov/schedule/news_release/empsit.htm" },
  },
  {
    name: "CPI (Inflation)",
    patterns: [/consumer price index/i, /\bcpi\b/i, /inflation rate/i],
    source: { label: "BLS CPI release schedule", url: "https://www.bls.gov/schedule/news_release/cpi.htm" },
  },
  {
    name: "FOMC Rate Decision",
    patterns: [/fed interest rate/i, /fomc/i, /federal funds/i, /interest rate decision/i],
    source: { label: "Federal Reserve FOMC calendar", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  },
];

function fmtVal(v: number | null, unit: string | null): string {
  if (v === null || v === undefined) return "";
  return unit ? `${v}${unit}` : `${v}`;
}

function classify(actual: number | null, estimate: number | null): { label: string; desc: string } {
  if (actual === null || estimate === null) return { label: "Released", desc: "in line with the available data" };
  const diff = actual - estimate;
  const tol = Math.abs(estimate) * 0.01;
  if (Math.abs(diff) <= tol) return { label: "In line", desc: "broadly in line with consensus" };
  if (diff > 0) return { label: "Beat", desc: "above consensus expectations" };
  return { label: "Miss", desc: "below consensus expectations" };
}

function reactionSummary(snapshot: MarketSnapshot): Record<string, string> {
  const q = snapshot.quotes;
  const idx = [q.sp500, q.nasdaq, q.dow].filter(Boolean).map((x) => `${x!.name} ${x!.changePercentage >= 0 ? "+" : ""}${x!.changePercentage.toFixed(2)}%`);
  return {
    indices_summary: idx.length ? idx.join("; ") : "",
    usd_summary: [q.eurusd && `EUR/USD ${fmtPct(q.eurusd)}`, q.usdjpy && `USD/JPY ${fmtPct(q.usdjpy)}`].filter(Boolean).join("; "),
    yield_summary: snapshot.yield10y ? `${snapshot.yield10y.latest}%${snapshot.yield10y.changeBps !== null ? ` (${snapshot.yield10y.changeBps >= 0 ? "+" : ""}${snapshot.yield10y.changeBps} bps d/d)` : ""}` : "",
    gold_summary: q.gold ? fmtPct(q.gold) : "",
    oil_summary: q.brent ? fmtPct(q.brent) : "",
  };
}

/**
 * Build macro alerts for NFP / CPI / FOMC.
 * For each tracked event we pick the nearest upcoming instance (pre-release) and the most
 * recent released instance (result, plus a reaction draft if it released within ~2 days).
 */
export async function buildMacroAlerts(now: Date, snapshot: MarketSnapshot): Promise<{ alerts: Alert[]; warnings: string[] }> {
  const warnings: string[] = [];
  const alerts: Alert[] = [];

  const from = isoDate(addDays(now, -10));
  const to = isoDate(addDays(now, 45));
  let events: EconEvent[] = [];
  try {
    events = await getEconomicCalendar(from, to);
  } catch (e) {
    warnings.push(`macro: economic calendar unavailable (${(e as Error).message})`);
    return { alerts, warnings };
  }

  const us = events.filter((e) => e.country === "US" || e.currency === "USD");

  for (const def of MACRO_EVENTS) {
    const matches = us
      .filter((e) => def.patterns.some((p) => p.test(e.event)))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (matches.length === 0) continue;

    const nowMs = now.getTime();
    const upcoming = matches.find((e) => new Date(e.date.replace(" ", "T") + "Z").getTime() >= nowMs && e.actual === null);
    const released = [...matches].reverse().find((e) => e.actual !== null);

    if (upcoming) {
      const { text, missing } = fillTemplate("macro_pre", {
        event_name: def.name,
        release_date: `${prettyDate(upcoming.date.slice(0, 10))} (${upcoming.date.slice(11, 16)} UTC)`,
        estimate: fmtVal(upcoming.estimate, upcoming.unit) || "not yet published",
        previous: fmtVal(upcoming.previous, upcoming.unit),
      });
      alerts.push(makeAlert({
        id: `macro-pre-${def.name}-${upcoming.date.slice(0, 10)}`,
        family: "macro", title: `Pre-release: ${def.name}`, timing: "Pre-release",
        eventDate: upcoming.date.slice(0, 10), severity: "watch",
        baseline: text, missing: missing.filter((m) => m !== "estimate"),
        sources: [def.source], priority: 75,
        payload: { ...upcoming },
      }));
    }

    if (released) {
      const cls = classify(released.actual, released.estimate);
      const { text, missing } = fillTemplate("macro_result", {
        event_name: def.name,
        classification: cls.label,
        classification_description: cls.desc,
        actual: fmtVal(released.actual, released.unit),
        estimate: fmtVal(released.estimate, released.unit) || "n/a",
        previous: fmtVal(released.previous, released.unit),
      });
      alerts.push(makeAlert({
        id: `macro-result-${def.name}-${released.date.slice(0, 10)}`,
        family: "macro", title: `Result: ${def.name} — ${cls.label}`, timing: "Result",
        eventDate: released.date.slice(0, 10), severity: "high",
        baseline: text, missing: missing.filter((m) => m !== "estimate"),
        // Calendar feeds can mix units (MoM vs YoY) — verify the figure against the
        // official source before any external use.
        forceReview: true,
        reviewReason: `Verify the released figure against ${def.source.label} — calendar values can differ in units (MoM vs YoY).`,
        sources: [def.source], priority: 85,
        payload: { ...released, classification: cls.label },
      }));

      // Reaction draft if released within ~2 days and we have market data.
      const ageDays = (now.getTime() - new Date(released.date.replace(" ", "T") + "Z").getTime()) / 86_400_000;
      if (ageDays >= 0 && ageDays <= 2 && Object.keys(snapshot.quotes).length > 0) {
        const r = reactionSummary(snapshot);
        const { text: rtext, missing: rmissing } = fillTemplate("macro_reaction", { event_name: def.name, ...r });
        alerts.push(makeAlert({
          id: `macro-reaction-${def.name}-${released.date.slice(0, 10)}`,
          family: "macro", title: `Reaction: ${def.name}`, timing: "Reaction",
          eventDate: released.date.slice(0, 10), severity: "watch",
          baseline: rtext, missing: rmissing,
          sources: [def.source, { label: "FMP market quotes", url: "https://site.financialmodelingprep.com/" }],
          priority: 60, payload: { event_name: def.name, ...r, snapshotWarnings: snapshot.warnings },
        }));
      }
    }
  }

  return { alerts, warnings };
}
