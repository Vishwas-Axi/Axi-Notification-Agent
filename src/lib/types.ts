export type AlertFamily = "holiday" | "macro" | "ipo" | "news";

export type AlertSeverity = "info" | "watch" | "high";

export type AlertStatus = "ready" | "needs_review";

export interface SourceRef {
  label: string;
  url: string;
}

export interface Alert {
  /** Stable id used for de-duplication across refreshes. */
  id: string;
  family: AlertFamily;
  title: string;
  /** e.g. "T-2", "T", "T+1", "Pre-release", "Result", "Reaction". */
  timing?: string;
  /** ISO date (YYYY-MM-DD) of the underlying event, when applicable. */
  eventDate?: string;
  severity: AlertSeverity;
  status: AlertStatus;
  /** Final text shown to the user (AI-refined when available, else the deterministic template fill). */
  draft: string;
  /** Deterministic template fill — always present, used as the fallback. */
  baseline: string;
  /** True when OpenAI successfully refined the draft. */
  refined: boolean;
  /** Why the alert needs human review (missing data, breaking news, etc.). */
  needsReviewReason?: string;
  sources: SourceRef[];
  /** The structured data the draft was generated from (audit trail). */
  payload: Record<string, unknown>;
  /** Sort weight; higher = more urgent / surfaces first. */
  priority: number;
}

export interface AlertBundle {
  generatedAt: string;
  alerts: Alert[];
  /** Non-fatal problems encountered while building the bundle (per-feed). */
  warnings: string[];
}
