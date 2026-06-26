import type { Alert } from "@/lib/types";
import { composeCorrelation, type CorrelationStory } from "@/lib/llm";
import { isoDate } from "@/lib/dates";
import { mapLimit } from "@/lib/concurrency";
import { makeAlert, fmtPct, type MarketSnapshot } from "./shared";
import type { HotStory } from "./news";

const AUDIENCE =
  process.env.ALERT_AUDIENCE ||
  "Axi dealing desks, relationship managers, affiliates and IB partners";

/** Which correlation variants to generate. */
const VARIANTS: { key: "playful" | "professional"; label: string; emoji: string }[] = [
  { key: "playful", label: "Playful", emoji: "🎯" },
  { key: "professional", label: "Professional", emoji: "🔗" },
];

/** Compact cross-asset line — the only market levels the composer may use. */
function marketLine(snapshot: MarketSnapshot): string {
  const q = snapshot.quotes;
  const parts = [
    q.sp500 && `S&P 500 ${fmtPct(q.sp500)}`,
    q.nasdaq && `Nasdaq ${fmtPct(q.nasdaq)}`,
    q.dow && `Dow ${fmtPct(q.dow)}`,
    q.gold && `Gold ${fmtPct(q.gold)}`,
    q.brent && `Brent ${fmtPct(q.brent)}`,
    q.eurusd && `EUR/USD ${fmtPct(q.eurusd)}`,
    q.usdjpy && `USD/JPY ${fmtPct(q.usdjpy)}`,
    q.btc && `BTC ${fmtPct(q.btc)}`,
    snapshot.yield10y &&
      `US 10Y ${snapshot.yield10y.latest}%${
        snapshot.yield10y.changeBps !== null ? ` (${snapshot.yield10y.changeBps >= 0 ? "+" : ""}${snapshot.yield10y.changeBps}bps)` : ""
      }`,
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * "Connect-the-dots" alerts: weave the day's top distinct stories into a single
 * narrative that surfaces a shared driver / cross-asset linkage / divergence.
 *
 * Deliberately the most interpretive family in the app, so every card is forced
 * to Needs-review and the composer is constrained to the supplied story + market
 * facts only (no invented numbers, no trade calls). Two voices are produced per
 * refresh — playful and professional — so the desk can pick.
 */
export async function buildCorrelationAlerts(
  now: Date,
  snapshot: MarketSnapshot,
  topStories: HotStory[],
): Promise<{ alerts: Alert[]; warnings: string[] }> {
  const warnings: string[] = [];

  if (!process.env.OPENAI_API_KEY) {
    return { alerts: [], warnings: ["correlation: OPENAI_API_KEY not set — skipping connect-the-dots cards."] };
  }
  // Use the strongest few distinct stories as raw material.
  const stories: CorrelationStory[] = topStories.slice(0, 5).map((s) => ({
    emoji: s.emoji,
    headline: s.headline,
    blurb: s.blurb,
    category: s.category,
  }));
  if (stories.length < 2) {
    warnings.push("correlation: fewer than 2 distinct top stories — nothing to correlate this refresh.");
    return { alerts: [], warnings };
  }

  const mkt = marketLine(snapshot);
  const day = isoDate(now);
  const sources = topStories
    .slice(0, 3)
    .filter((s) => s.url)
    .map((s) => ({ label: s.publisher || "Source", url: s.url as string }));

  const alerts: Alert[] = [];
  await mapLimit(VARIANTS, 2, async (v) => {
    try {
      const res = await composeCorrelation(stories, mkt, AUDIENCE, v.key);
      if (!res) {
        warnings.push(`correlation: ${v.key} variant returned no text.`);
        return;
      }
      alerts.push(
        makeAlert({
          id: `corr-${v.key}-${day}`,
          family: "correlation",
          title: `${v.emoji} Connect the dots — ${v.label}`,
          timing: "Narrative",
          severity: topStories.some((s) => s.fromWebSearch) ? "high" : "watch",
          baseline: res.text,
          missing: [],
          forceReview: true,
          reviewReason:
            "AI-correlated narrative across multiple stories — higher interpretation risk. Verify every linkage and number before sending.",
          sources: sources.length ? sources : [{ label: "Top stories", url: "https://news.google.com/" }],
          priority: 58,
          payload: {
            variant: v.key,
            storiesUsed: stories,
            marketSnapshot: mkt,
            generatedFor: day,
          },
        }),
      );
    } catch (e) {
      warnings.push(`correlation: ${v.key} variant failed (${(e as Error).message}).`);
    }
  });

  // Stable order: professional under playful (or by id) so refreshes look consistent.
  alerts.sort((a, b) => a.id.localeCompare(b.id));
  return { alerts, warnings };
}
