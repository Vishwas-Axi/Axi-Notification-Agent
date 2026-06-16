import { NextResponse } from "next/server";
import { isTeamsConfigured, sendToTeams } from "@/lib/teams";

export const dynamic = "force-dynamic";

/** POST /api/teams — deliver an alert draft to the configured Teams channel. */
export async function POST(req: Request) {
  if (!isTeamsConfigured()) {
    return NextResponse.json(
      { error: "Teams is not configured. Set TEAMS_WEBHOOK_URL in your .env file." },
      { status: 400 },
    );
  }

  let body: { title?: string; text?: string; sourceLabel?: string; sourceUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.title || !body.text) {
    return NextResponse.json({ error: "title and text are required." }, { status: 400 });
  }

  try {
    await sendToTeams({
      title: body.title,
      text: body.text,
      sourceLabel: body.sourceLabel,
      sourceUrl: body.sourceUrl,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
