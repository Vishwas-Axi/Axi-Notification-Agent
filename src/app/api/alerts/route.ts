import { NextResponse } from "next/server";
import { readCache, writeCache } from "@/lib/cache";
import { generateAlerts } from "@/lib/generate";

export const dynamic = "force-dynamic";
// First load on a cold cache generates the bundle (FMP + RSS + OpenAI). Give it room.
export const maxDuration = 60;

/**
 * GET /api/alerts — return the cached alert bundle.
 * If the cache is empty (first run), generate it once so the page is never blank.
 */
export async function GET() {
  let bundle = await readCache();
  if (!bundle) {
    try {
      bundle = await generateAlerts();
      await writeCache(bundle);
    } catch (e) {
      return NextResponse.json(
        { error: `Failed to generate alerts: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  }
  return NextResponse.json(bundle);
}
