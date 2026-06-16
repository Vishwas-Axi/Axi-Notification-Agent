import { NextResponse } from "next/server";
import { writeCache } from "@/lib/cache";
import { generateAlerts } from "@/lib/generate";

export const dynamic = "force-dynamic";
// Generating drafts (FMP fetches + OpenAI calls) can take a while.
export const maxDuration = 120;

/** POST /api/alerts/refresh — regenerate alerts from live data and update the cache. */
export async function POST() {
  try {
    const bundle = await generateAlerts();
    await writeCache(bundle);
    return NextResponse.json(bundle);
  } catch (e) {
    return NextResponse.json(
      { error: `Refresh failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
