import { promises as fs } from "node:fs";
import path from "node:path";
import type { Alert } from "@/lib/types";
import { fillTemplate } from "@/lib/templates";
import { addDays, daysBetween, isoDate, nextBusinessDay, parseISO, prettyDate } from "@/lib/dates";

interface HolidayRecord {
  date: string;
  name: string;
  markets: string[];
}

interface HolidayFile {
  source: { label: string; url: string };
  holidays: HolidayRecord[];
}

async function loadHolidays(): Promise<HolidayFile> {
  const file = path.join(process.cwd(), "data", "holidays.json");
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw) as HolidayFile;
}

/**
 * Build holiday alerts following the T-2 / T / T+1 model.
 *   - If a holiday is active now (T-2, T, or T+1 today), emit the matching alert as high/watch priority.
 *   - Otherwise, surface the single next upcoming holiday as a low-priority "info" card so the
 *     dashboard is always useful.
 */
export async function buildHolidayAlerts(now: Date): Promise<Alert[]> {
  const { source, holidays } = await loadHolidays();
  const alerts: Alert[] = [];
  let nextUpcoming: { rec: HolidayRecord; days: number } | null = null;

  for (const rec of holidays) {
    const hDate = parseISO(rec.date);
    const diff = daysBetween(now, hDate); // +ve = days until holiday
    const markets = rec.markets.join(", ");
    const common = {
      family: "holiday" as const,
      eventDate: rec.date,
      sources: [{ label: source.label, url: source.url }],
    };

    if (diff === 2) {
      const { text, missing } = fillTemplate("holiday_t2", {
        holiday_date: prettyDate(rec.date),
        holiday_name: rec.name,
      });
      alerts.push(makeAlert(`holiday-t2-${rec.date}`, {
        ...common, title: `T-2: ${rec.name}`, timing: "T-2", severity: "watch",
        baseline: text, missing,
        payload: { holiday_date: rec.date, holiday_name: rec.name, affected_markets: markets },
        priority: 70,
      }));
    } else if (diff === 0) {
      const { text, missing } = fillTemplate("holiday_t", {
        holiday_date: prettyDate(rec.date),
        holiday_name: rec.name,
        affected_markets: markets,
      });
      alerts.push(makeAlert(`holiday-t-${rec.date}`, {
        ...common, title: `Today: ${rec.name}`, timing: "T", severity: "high",
        baseline: text, missing,
        payload: { holiday_date: rec.date, holiday_name: rec.name, affected_markets: markets },
        priority: 95,
      }));
    } else if (isoDate(nextBusinessDay(hDate)) === isoDate(now)) {
      const { text, missing } = fillTemplate("holiday_t1", {
        holiday_date: prettyDate(rec.date),
        holiday_name: rec.name,
      });
      alerts.push(makeAlert(`holiday-t1-${rec.date}`, {
        ...common, title: `Post-holiday outlook: ${rec.name}`, timing: "T+1", severity: "watch",
        baseline: text, missing,
        payload: { holiday_date: rec.date, holiday_name: rec.name, affected_markets: markets },
        priority: 65,
      }));
    }

    if (diff > 0 && (nextUpcoming === null || diff < nextUpcoming.days)) {
      nextUpcoming = { rec, days: diff };
    }
  }

  // If no active T-2/T/T+1 alert fired, show the next upcoming holiday as context.
  const hasActive = alerts.length > 0;
  if (!hasActive && nextUpcoming) {
    const { rec, days } = nextUpcoming;
    const { text, missing } = fillTemplate("holiday_t2", {
      holiday_date: prettyDate(rec.date),
      holiday_name: rec.name,
    });
    alerts.push(makeAlert(`holiday-upcoming-${rec.date}`, {
      family: "holiday", eventDate: rec.date,
      sources: [{ label: source.label, url: source.url }],
      title: `Upcoming holiday in ${days} day(s): ${rec.name}`, timing: `T-${days}`, severity: "info",
      baseline: text, missing,
      payload: { holiday_date: rec.date, holiday_name: rec.name, affected_markets: rec.markets.join(", "), days_until: days },
      priority: 30,
    }));
  }

  return alerts;
}

function makeAlert(
  id: string,
  o: {
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
  },
): Alert {
  return {
    id,
    family: o.family,
    title: o.title,
    timing: o.timing,
    eventDate: o.eventDate,
    severity: o.severity,
    status: o.missing.length > 0 ? "needs_review" : "ready",
    draft: o.baseline,
    baseline: o.baseline,
    refined: false,
    needsReviewReason: o.missing.length > 0 ? `Missing data: ${o.missing.join(", ")}` : undefined,
    sources: o.sources,
    payload: o.payload,
    priority: o.priority,
  };
}
