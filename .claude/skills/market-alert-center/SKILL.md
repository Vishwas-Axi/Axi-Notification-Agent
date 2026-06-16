---
name: market-alert-center
description: Work on Axi's Market Alert Center — the Next.js app in this folder that auto-drafts market/partner alerts (holidays, macro NFP/CPI/FOMC, IPOs, breaking news) from free public data + OpenAI. Use when the user wants to run it, change the look, add/adjust news sources or alert families, tune accuracy/dedup, wire Teams, or troubleshoot empty/low-quality alerts.
---

# Axi · Market Alert Center

A local-first **Next.js 14 (App Router, TypeScript)** web app. On open it shows AI-tightened alert
drafts built from public data. A human reviews before sending; **Copy** and **Send to Teams** buttons,
never auto-publish. Light, Axi-branded UI. Short cards, **no legal disclaimer footer**.

## Run it (PowerShell, this folder)
```powershell
npm run dev          # http://localhost:3000  (or: npm run build; $env:PORT=3000; npm start)
```
Click **↻ Refresh alerts** to regenerate. Health check: `/api/diagnostics`.
Full start/stop guide: `HOW_TO_RUN.md`. Stop: Ctrl+C, or kill the port:
```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select -Expand OwningProcess -Unique | % { Stop-Process -Id $_ -Force }
```

## Keys (.env — already populated)
- **Required:** `FMP_API_KEY` (stable-tier free), `OPENAI_API_KEY`. Optional: `OPENAI_MODEL`
  (default `gpt-4o-mini`), `TEAMS_WEBHOOK_URL`, `ALERT_AUDIENCE`.
- **No other key is required** — news is free keyless RSS. Optional accuracy upgrades documented in
  `.env.example`: **FRED** (macro numbers — recommended), Marketaux/Finnhub (news sentiment).
- FMP key is **stable-only** (`/stable/` endpoints; `/api/v3/` → 403). WTI/DXY/`^TNX` are paid →
  app uses Brent, EUR/USD+USD/JPY, and `treasury-rates` `year10` instead.

## Architecture
- `src/lib/generate.ts` — orchestrator. Fault-tolerant: a failing feed adds a **warning**, never blanks
  the dashboard. Builders run in parallel → OpenAI refine (bounded, `mapLimit`) → sort by priority.
- `src/lib/builders/` — `holidays.ts`, `macro.ts`, `ipo.ts`, `news.ts`, `shared.ts` (snapshot + `makeAlert`).
- `src/lib/rss.ts` — zero-dependency RSS 2.0 / Atom reader (tolerant; timeouts → `[]`).
- `src/lib/sources.ts` — **the feed catalog** (Yahoo, CNBC, MarketWatch, Fed, Google News topic queries).
  Each feed has a `weight` (1–3) folded into ranking.
- `src/lib/templates.ts` — short templates + `fillTemplate` (missing field → `[field]` + flag).
- `src/lib/llm.ts` — OpenAI refine; strict "use only payload facts", short output, returns `NEEDS_REVIEW`
  if a `[placeholder]` survives.
- `src/app/globals.css` — light theme; Axi accent `--accent: #e4002b`.
- Cache: `data/cache/alerts.json` (git-ignored). API: `/api/alerts` (GET), `/api/alerts/refresh` (POST),
  `/api/teams`, `/api/diagnostics`.

## News engine (the main quality lever)
In `src/lib/builders/news.ts`: fetch all `FEEDS` + FMP news → normalize → de-dup across sources
(exact key, then **token-set Jaccard ≥ 0.6** for near-dups) → recency filter (`RECENCY_HOURS`, 48h)
→ score (`MAJOR`×3 + `MINOR`×1 + feed weight) → keep top `MAX_NEWS` (10). Every news alert is
`forceReview: true`.

### Common changes
- **Add a news source:** add a `FeedDef` to `FEEDS` in `sources.ts` (RSS/Atom URL + weight + category).
  Use the `gnews("…")` helper for a targeted Google News topic. No other change needed.
- **Surface more/fewer news:** `MAX_NEWS` in `news.ts`. Tighten/loosen dedup: the `0.6` Jaccard threshold.
- **Catch a missing catalyst:** add keywords to `MAJOR`/`MINOR` in `news.ts`, or a `gnews` topic feed.
- **Add an alert family:** new `src/lib/builders/<x>.ts` returning `{alerts, warnings}`, a template in
  `templates.ts`, wire it into the `Promise.all` in `generate.ts`, add the family to `types.ts`
  (`AlertFamily`), the filter in `Dashboard.tsx`, and a `.badge.family-<x>` style.

## Known caveats / gotchas
- **Macro numbers:** FMP economic-calendar `actual/estimate` can mix MoM vs YoY (e.g. CPI showed a
  garbled value). Released macro alerts are therefore **flagged Needs review** and link to BLS/Fed.
  The real fix is wiring **FRED** (`FRED_API_KEY`) for authoritative series.
- **Google News titles** arrive as "Headline - Publisher" → `splitPublisher()` cleans them.
- **Mojibake in PowerShell output** (e.g. `â…`) is a console display artifact only; the cached JSON and
  the browser render correct UTF-8 — verify via `data/cache/alerts.json`, not the terminal.
- Holiday dates in `data/holidays.json` should be checked against the official Fed schedule.
- Verify changes with `npm run build` (typecheck), then POST `/api/alerts/refresh` and inspect counts
  per family + `warnings`.
