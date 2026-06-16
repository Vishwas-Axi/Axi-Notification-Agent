import OpenAI from "openai";
import type { Alert } from "@/lib/types";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set (check your .env file).");
  return new OpenAI({ apiKey });
}

const systemPrompt = (audience: string) =>
  `You are a markets editor at Axi (a global online broker) drafting a short internal alert for ${audience}.

Rules:
1. Use ONLY the facts in the provided draft and JSON payload. Do NOT introduce numbers, dates, tickers, percentages, or source names that are not already there.
2. No trade recommendations, no forecasts, no directional calls. Neutral, professional, non-advisory tone.
3. Keep it SHORT and scannable: 1–3 sentences, ideally under 55 words. No headings, no bullet lists unless the draft already has them, no sign-off, and no legal disclaimer.
4. Do not add marketing language or a brand voice. Plain, factual, useful.
5. Values such as "TBC", "to be confirmed", "not yet published", "pending", or "n/a" are KNOWN states — keep them as written; do NOT treat them as missing data and do NOT flag them.
6. ONLY if the draft still contains an unresolved placeholder in square brackets (e.g. [estimate], [holiday_date]), respond with EXACTLY: NEEDS_REVIEW: <comma-separated bracketed fields>
7. Return ONLY the final alert text — no preamble, no "Final:", no commentary, no code fences.`;

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
    temperature: 0.3,
    max_tokens: 400,
    messages: [
      { role: "system", content: systemPrompt(audience) },
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
