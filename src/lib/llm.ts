import OpenAI from "openai";
import type { Alert } from "@/lib/types";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set (check your .env file).");
  return new OpenAI({ apiKey });
}

/** Neutral, compliance-safe tone for scheduled families (holiday / macro / ipo). */
const neutralPrompt = (audience: string) =>
  `You are a markets editor at Axi (a global online broker) drafting a short internal alert for ${audience}.

Rules:
1. Use ONLY the facts in the provided draft and JSON payload. Do NOT introduce numbers, dates, tickers, percentages, or source names that are not already there.
2. No trade recommendations, no forecasts, no directional calls. Neutral, professional, non-advisory tone.
3. Keep it SHORT and scannable: 1–3 sentences, ideally under 55 words. No headings, no bullet lists unless the draft already has them, no sign-off, and no legal disclaimer.
4. Do not add marketing language or a brand voice. Plain, factual, useful.
5. Values such as "TBC", "to be confirmed", "not yet published", "pending", or "n/a" are KNOWN states — keep them as written; do NOT treat them as missing data and do NOT flag them.
6. ONLY if the draft still contains an unresolved placeholder in square brackets (e.g. [estimate], [holiday_date]), respond with EXACTLY: NEEDS_REVIEW: <comma-separated bracketed fields>
7. Return ONLY the final alert text — no preamble, no "Final:", no commentary, no code fences.`;

/** Punchy, emoji-led tone for breaking news — still strictly facts-only. */
const newsPrompt = (audience: string) =>
  `You are the markets desk editor at Axi (a global online broker) writing a PUNCHY breaking-news alert for ${audience}.

Rules:
1. Use ONLY the facts in the provided draft and JSON payload. Do NOT invent or change numbers, levels, %, dates, tickers, or source names.
2. Make it punchy, energetic and scannable. LEAD with one relevant emoji; you may use up to 3 tasteful emoji total. Short, active sentences.
3. Keep it tight: 1–3 short sentences, under ~45 words. Lead with the concrete fact (a level, a %, a decision).
4. No trade recommendations, no forecasts, no price targets, no advice. Punchy ≠ hype — don't add adjectives the facts don't support.
5. Keep any source/"… ago" attribution line if present. No legal disclaimer, no sign-off.
6. ONLY if the draft still contains an unresolved placeholder in square brackets, respond with EXACTLY: NEEDS_REVIEW: <comma-separated bracketed fields>
7. Return ONLY the final alert text — no preamble, no commentary, no code fences.`;

const systemPrompt = (audience: string, family: Alert["family"]) =>
  family === "news" ? newsPrompt(audience) : neutralPrompt(audience);

export interface RefineResult {
  text: string;
  refined: boolean;
  needsReview?: string;
}

/** Refine a single alert's baseline draft with OpenAI, faithfully and within guardrails. */
export async function refineAlert(alert: Alert, audience: string): Promise<RefineResult> {
  const openai = client();
  const user = `DRAFT (template already filled — tighten the wording, keep every fact):
"""
${alert.baseline}
"""

JSON PAYLOAD (the only source of facts you may use):
${JSON.stringify(alert.payload, null, 2)}`;

  const resp = await openai.chat.completions.create({
    model: MODEL,
    temperature: alert.family === "news" ? 0.5 : 0.3,
    max_tokens: 400,
    messages: [
      { role: "system", content: systemPrompt(audience, alert.family) },
      { role: "user", content: user },
    ],
  });

  const out = resp.choices[0]?.message?.content?.trim() ?? "";
  if (!out) return { text: alert.baseline, refined: false };
  if (/^NEEDS_REVIEW/i.test(out)) {
    return { text: alert.baseline, refined: false, needsReview: out.replace(/^NEEDS_REVIEW:?\s*/i, "").trim() };
  }
  return { text: out, refined: true };
}

/** A story fact handed to the correlation composer. */
export interface CorrelationStory {
  emoji: string;
  headline: string;
  blurb: string;
  category: string;
}

const correlationSystem = (audience: string, variant: "playful" | "professional") => {
  const voice =
    variant === "playful"
      ? `Open with ONE light metaphor as a hook (a sports/everyday analogy is welcome — e.g. "three catalysts, zero half-time"), then immediately get to the facts. Energetic and engaging.`
      : `Neutral, professional broker tone. No metaphors, no jokes. Crisp and analytical.`;
  return `You are the markets desk editor at Axi (a global online broker) writing ONE short "connect-the-dots" alert for ${audience} that weaves the day's top stories into a single narrative.

Goal: show how the separate stories RELATE — a shared driver, a cross-asset linkage, or a notable divergence. This is the value: connecting the dots a list of headlines doesn't.

Rules:
1. Use ONLY the facts in the provided stories and market-snapshot line. Do NOT invent or alter numbers, levels, %, tickers, dates, or names.
2. You MAY draw connections, point out a shared catalyst, or note a divergence. You may NOT give trade recommendations, directional forecasts, price targets, or position-sizing advice.
3. Lead with one emoji. 3–6 short, punchy sentences. Scannable. You may use a few tasteful emoji.
4. End with a neutral situational-awareness nudge (e.g. "mind the gaps", "watch the cross-asset read-through") — NOT advice.
5. No legal disclaimer, no sign-off. Return ONLY the alert text — no preamble, no code fences.
6. Voice: ${voice}`;
};

/** Compose a single correlation/"connect-the-dots" narrative from the day's top stories. */
export async function composeCorrelation(
  stories: CorrelationStory[],
  marketLine: string,
  audience: string,
  variant: "playful" | "professional",
): Promise<{ text: string } | null> {
  if (stories.length < 2) return null;
  const openai = client();
  const facts = stories
    .map((s, i) => `${i + 1}. ${s.emoji} [${s.category}] ${s.headline}\n   ${s.blurb}`)
    .join("\n");
  const user = `TOP STORIES TODAY (the only facts you may use):
${facts}

MARKET SNAPSHOT (the only market levels you may use):
${marketLine || "(no live market snapshot available)"}

Write the single connect-the-dots alert now.`;

  const resp = await openai.chat.completions.create({
    model: MODEL,
    temperature: variant === "playful" ? 0.6 : 0.4,
    max_tokens: 380,
    messages: [
      { role: "system", content: correlationSystem(audience, variant) },
      { role: "user", content: user },
    ],
  });
  const out = resp.choices[0]?.message?.content?.trim() ?? "";
  return out ? { text: out } : null;
}
