"use client";

import { useState } from "react";
import type { Alert } from "@/lib/types";

const FAMILY_LABEL: Record<Alert["family"], string> = {
  holiday: "Holiday",
  macro: "Macro",
  ipo: "IPO",
  news: "News",
  correlation: "Connections",
};

export default function AlertCard({
  alert,
  teamsEnabled,
  onToast,
}: {
  alert: Alert;
  teamsEnabled: boolean;
  onToast: (msg: string, kind: "ok" | "err") => void;
}) {
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(alert.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onToast("Could not copy to clipboard", "err");
    }
  }

  async function sendToTeams() {
    setSending(true);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: alert.title,
          text: alert.draft,
          sourceLabel: alert.sources[0]?.label,
          sourceUrl: alert.sources[0]?.url,
        }),
      });
      const data = await res.json();
      if (res.ok) onToast("Sent to Teams ✓", "ok");
      else onToast(data.error || "Teams send failed", "err");
    } catch (e) {
      onToast((e as Error).message, "err");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`card sev-${alert.severity}`}>
      <div className="card-head">
        <div className="badges">
          <span className={`badge family-${alert.family}`}>{FAMILY_LABEL[alert.family]}</span>
          {alert.timing && <span className="badge timing">{alert.timing}</span>}
          <span className={`badge status-${alert.status}`}>
            {alert.status === "ready" ? "Ready" : "Needs review"}
          </span>
          <span className={`badge ${alert.refined ? "ai" : "tmpl"}`}>
            {alert.refined ? "AI-refined" : "Template"}
          </span>
        </div>
        <h3 className="card-title">{alert.title}</h3>
        {alert.eventDate && <div className="card-date">Event date: {alert.eventDate}</div>}
      </div>

      {alert.status === "needs_review" && alert.needsReviewReason && (
        <div className="review-note">⚠ {alert.needsReviewReason}</div>
      )}

      <pre className="draft">{alert.draft}</pre>

      <div className="card-foot">
        <div className="actions">
          <button className="btn small primary" onClick={copy}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
          {teamsEnabled && (
            <button className="btn small" onClick={sendToTeams} disabled={sending}>
              {sending ? <><span className="spinner" />Sending…</> : "Send to Teams"}
            </button>
          )}
        </div>

        {alert.sources.length > 0 && (
          <div className="sources">
            <span className="src-label">Sources:</span>
            {alert.sources.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
            ))}
          </div>
        )}

        <details className="payload">
          <summary>Source data (audit)</summary>
          <pre>{JSON.stringify(alert.payload, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}
