import type { Alert, AlertBundle } from "@/lib/types";
import { buildMarketSnapshot } from "@/lib/builders/shared";
import { buildHolidayAlerts } from "@/lib/builders/holidays";
import { buildMacroAlerts } from "@/lib/builders/macro";
import { buildIpoAlerts } from "@/lib/builders/ipo";
import { buildNewsAlerts } from "@/lib/builders/news";
import { refineAlert } from "@/lib/llm";
import { mapLimit } from "@/lib/concurrency";

const DEFAULT_AUDIENCE =
  process.env.ALERT_AUDIENCE ||
  "Axi dealing desks, relationship managers, affiliates and IB partners";

/**
 * Full pipeline: fetch public data (FMP) -> build deterministic baseline drafts ->
 * refine with OpenAI (best-effort) -> sort by urgency. Every step is fault-tolerant:
 * a failing feed adds a warning rather than blanking the dashboard.
 */
export async function generateAlerts(now: Date = new Date()): Promise<AlertBundle> {
  const warnings: string[] = [];

  // Shared market snapshot (used by macro reaction + news context).
  const snapshot = await buildMarketSnapshot();
  warnings.push(...snapshot.warnings);

  const [holidayRes, macroRes, ipoRes, newsRes] = await Promise.all([
    buildHolidayAlerts(now).then((a) => ({ alerts: a, warnings: [] as string[] })).catch((e) => ({ alerts: [] as Alert[], warnings: [`holiday: ${(e as Error).message}`] })),
    buildMacroAlerts(now, snapshot).catch((e) => ({ alerts: [] as Alert[], warnings: [`macro: ${(e as Error).message}`] })),
    buildIpoAlerts(now).catch((e) => ({ alerts: [] as Alert[], warnings: [`ipo: ${(e as Error).message}`] })),
    buildNewsAlerts(now, snapshot).catch((e) => ({ alerts: [] as Alert[], warnings: [`news: ${(e as Error).message}`] })),
  ]);

  for (const r of [holidayRes, macroRes, ipoRes, newsRes]) warnings.push(...r.warnings);

  const alerts: Alert[] = [
    ...holidayRes.alerts,
    ...macroRes.alerts,
    ...ipoRes.alerts,
    ...newsRes.alerts,
  ];

  // AI refinement (best-effort, bounded concurrency).
  if (process.env.OPENAI_API_KEY) {
    await mapLimit(alerts, 4, async (a) => {
      try {
        const r = await refineAlert(a, DEFAULT_AUDIENCE);
        if (r.refined) {
          a.draft = r.text;
          a.refined = true;
        }
        if (r.needsReview && a.status === "ready") {
          a.status = "needs_review";
          a.needsReviewReason = a.needsReviewReason ?? r.needsReview;
        }
      } catch (e) {
        warnings.push(`openai: "${a.title}" not refined (${(e as Error).message})`);
      }
    });
  } else {
    warnings.push("openai: OPENAI_API_KEY not set — showing template drafts without AI refinement.");
  }

  // Most urgent first; ties broken by soonest event date.
  alerts.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999");
  });

  return { generatedAt: now.toISOString(), alerts, warnings };
}
