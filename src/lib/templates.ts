/**
 * Approved alert templates + the deterministic fill routine. The fill produces a
 * guaranteed baseline draft even when OpenAI is unavailable, and reports any
 * missing fields so the alert can be flagged NEEDS_REVIEW.
 *
 * Templates are intentionally short (a few scannable lines) and carry no legal
 * disclaimer footer — the desk adds approved disclaimers at distribution time.
 */

export const TEMPLATES = {
  holiday_t2: `Heads-up: {holiday_date} is a US/Fed market holiday for {holiday_name}. Expect altered trading hours, liquidity, and funding across affected products. Check the approved holiday schedule.`,

  holiday_t: `Today, {holiday_date}, is a US/Fed holiday for {holiday_name} — {affected_markets} closed. Refer to product-specific trading hours for operational impact.`,

  holiday_t1: `US markets reopen after the {holiday_name} holiday ({holiday_date}). Watch for thin early liquidity, wider opening spreads, and any delayed reaction to news from the holiday period — especially in USD pairs, Treasuries, gold, oil, and US indices.`,

  macro_pre: `Next US {event_name} is due {release_date}. Consensus: {estimate} · Previous: {previous}. Likely movers: USD pairs, gold, US indices, and Treasury yields.`,

  macro_result: `US {event_name} — {classification}. Actual {actual} vs consensus {estimate} (previous {previous}). Watch USD, Treasury yields, gold, and index reaction into the next Fed decision.`,

  macro_reaction: `Cross-asset reaction to US {event_name} — Indices: {indices_summary} · USD: {usd_summary} · 10Y: {yield_summary} · Gold: {gold_summary} · Brent: {oil_summary}.`,

  ipo_preview: `IPO Watch: {company_name} ({symbol}) is expected to list on {exchange} around {listing_date}. Indicated range {price_range}, {shares} shares. Expect IPO-day volatility, gaps, and wider spreads around the open.`,

  ipo_pricing: `IPO Pricing: {company_name} ({symbol}) on {exchange} — range {price_range}, first trade {listing_date}, {shares} shares, indicated cap {market_cap}. Confirm instrument availability before the open.`,

  news_volatility: `{headline}

{publisher} · {published_ago} · potential impact: {topic}.
{asset_move_summary}`,
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

const PLACEHOLDER_RE = /\{([a-z0-9_]+)\}/gi;

export interface FillResult {
  text: string;
  missing: string[];
}

/**
 * Replace {placeholders} with payload values. Any placeholder whose value is
 * missing/empty is recorded in `missing` and rendered as a visible [field] marker.
 */
export function fillTemplate(
  key: TemplateKey,
  payload: Record<string, unknown>,
): FillResult {
  const missing: string[] = [];

  const text = TEMPLATES[key].replace(PLACEHOLDER_RE, (_m, name: string) => {
    const v = payload[name];
    if (v === undefined || v === null || v === "") {
      missing.push(name);
      return `[${name}]`;
    }
    return String(v);
  });

  return { text: text.trim(), missing: Array.from(new Set(missing)) };
}
