"use client";

import { useEffect, useMemo, useState } from "react";
import type { Alert, AlertBundle, AlertFamily } from "@/lib/types";
import AlertCard from "./AlertCard";

type Filter = "all" | AlertFamily;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "news", label: "News" },
  { key: "correlation", label: "Connections" },
  { key: "macro", label: "Macro" },
  { key: "ipo", label: "IPO" },
  { key: "holiday", label: "Holidays" },
];

export default function Dashboard({
  initialBundle,
  teamsEnabled,
}: {
  initialBundle: AlertBundle | null;
  teamsEnabled: boolean;
}) {
  const [bundle, setBundle] = useState<AlertBundle | null>(initialBundle);
  const [loading, setLoading] = useState(!initialBundle);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  function showToast(msg: string, kind: "ok" | "err") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }

  // First load with no cache: fetch (and generate) once.
  useEffect(() => {
    if (initialBundle) return;
    (async () => {
      try {
        const res = await fetch("/api/alerts");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load alerts");
        setBundle(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [initialBundle]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      setBundle(data);
      showToast("Alerts refreshed ✓", "ok");
    } catch (e) {
      setError((e as Error).message);
      showToast("Refresh failed", "err");
    } finally {
      setRefreshing(false);
    }
  }

  const alerts = bundle?.alerts ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: alerts.length, holiday: 0, macro: 0, ipo: 0, news: 0, correlation: 0 };
    for (const a of alerts) c[a.family] = (c[a.family] ?? 0) + 1;
    return c;
  }, [alerts]);

  const needsReview = alerts.filter((a) => a.status === "needs_review").length;
  const visible: Alert[] = filter === "all" ? alerts : alerts.filter((a) => a.family === filter);

  const lastRefreshed = bundle?.generatedAt
    ? new Date(bundle.generatedAt).toLocaleString()
    : "—";

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/axi-logo-red.svg" alt="Axi" width={60} height={32} />
          <div className="brand-divider" />
          <div>
            <h1>Market Alert Center</h1>
            <div className="sub">
              Live alerts auto-drafted from public market data &amp; news, tightened by AI.
            </div>
            <div className="meta" style={{ marginTop: 6 }}>
              Last refreshed: {lastRefreshed}
              {needsReview > 0 && <> · <strong style={{ color: "var(--review)" }}>{needsReview} to review</strong></>}
            </div>
          </div>
        </div>
        <div className="right">
          <a className="btn ghost small" href="/api/diagnostics" target="_blank" rel="noreferrer">Diagnostics</a>
          <button className="btn primary" onClick={refresh} disabled={refreshing}>
            {refreshing ? <><span className="spinner" />Refreshing…</> : "↻ Refresh alerts"}
          </button>
        </div>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="count">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="banner err">
          <strong>Something went wrong:</strong> {error}
          <div style={{ marginTop: 6 }}>
            Check <a href="/api/diagnostics" target="_blank" rel="noreferrer">/api/diagnostics</a> to see which feed failed.
          </div>
        </div>
      )}

      {bundle && bundle.warnings.length > 0 && (
        <div className="banner warn">
          <details>
            <summary>{bundle.warnings.length} note(s) from the last refresh</summary>
            <ul>{bundle.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        </div>
      )}

      {loading ? (
        <div className="empty"><span className="spinner" />Generating alerts from live data… (first load can take ~20–40s)</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          No alerts in this category right now. Try “Refresh alerts”, or switch filters.
        </div>
      ) : (
        <div className="grid">
          {visible.map((a) => (
            <AlertCard key={a.id} alert={a} teamsEnabled={teamsEnabled} onToast={showToast} />
          ))}
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
