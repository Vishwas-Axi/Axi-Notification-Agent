import { NextResponse } from "next/server";
import { getEconomicCalendar, getIpoCalendar, getGeneralNews, getQuote, getTreasuryRates } from "@/lib/fmp";
import { isTeamsConfigured } from "@/lib/teams";
import { isoDate, addDays } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** GET /api/diagnostics — quick health check of every external dependency. */
export async function GET() {
  const now = new Date();
  const from = isoDate(now);
  const to = isoDate(addDays(now, 14));

  const checks: Record<string, { ok: boolean; detail: string }> = {};

  async function check(name: string, fn: () => Promise<string>) {
    try {
      checks[name] = { ok: true, detail: await fn() };
    } catch (e) {
      checks[name] = { ok: false, detail: (e as Error).message };
    }
  }

  await Promise.all([
    check("env.FMP_API_KEY", async () => (process.env.FMP_API_KEY ? "set" : Promise.reject(new Error("missing")))),
    check("env.OPENAI_API_KEY", async () => (process.env.OPENAI_API_KEY ? "set" : Promise.reject(new Error("missing")))),
    check("fmp.economicCalendar", async () => `${(await getEconomicCalendar(isoDate(addDays(now, -7)), to)).length} events`),
    check("fmp.ipoCalendar", async () => `${(await getIpoCalendar(from, to)).length} IPOs`),
    check("fmp.news", async () => `${(await getGeneralNews(5)).length} articles`),
    check("fmp.quote(^GSPC)", async () => `S&P ${(await getQuote("^GSPC"))?.price ?? "?"}`),
    check("fmp.treasuryRates", async () => `10Y ${(await getTreasuryRates(isoDate(addDays(now, -7)), to))[0]?.year10 ?? "?"}%`),
  ]);

  checks["teams.webhook"] = { ok: isTeamsConfigured(), detail: isTeamsConfigured() ? "configured" : "not configured (optional)" };

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok: allOk, openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini", checks });
}
