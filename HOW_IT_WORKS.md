# Axi · Market Alert Center — How It Works

A complete walkthrough of the project: what it is, the architecture, and the full journey
each notification travels — from a raw public data point to a reviewed card on screen (and
optionally a Microsoft Teams message).

> Companion docs: **`README.md`** (setup + features), **`HOW_TO_RUN.md`** (start/stop),
> and the Claude Code skill at **`.claude/skills/market-alert-center/SKILL.md`**.

---

## 1. What this is (in one paragraph)

The Market Alert Center is a local-first web app that **watches public market data and news,
auto-drafts short, on-brand alert notifications**, and shows them on a dashboard for a human to
review and distribute. It covers four alert families — **market holidays, macro releases
(NFP / CPI / FOMC), IPOs, and breaking news / volatility**. Each draft is built deterministically
from real data first, then tightened by OpenAI, and always carries its **sources and the raw
underlying data** for audit. Nothing is published automatically; a person clicks **Copy** or
**Send to Teams**.

**Design principles**
- **Never blank.** Every data feed is fault-tolerant — if one fails, it adds a warning instead of
  emptying the dashboard.
- **Facts first, AI second.** A template is filled from real data before the LLM ever runs, so the
  app still works (and stays accurate) even if OpenAI is down.
- **Human in the loop.** News and released macro figures are flagged **Needs review** before any
  external send.
- **No secrets in the browser.** All API calls happen server-side in Next.js API routes.

---

## 2. The big picture

```
                         ┌──────────────────────────────────────────────┐
                         │                 DATA SOURCES                  │
                         │                                              │
   Free public RSS ──────┤  Yahoo Finance · CNBC · MarketWatch · Fed     │
   (no API key)          │  Google News topic feeds (Fed/CPI/jobs/oil…)  │
                         │                                              │
   Financial Modeling ───┤  economic calendar · IPO calendar             │
   Prep (/stable/)       │  treasury rates · index/FX/commodity quotes   │
                         │  + general & stock news (one more source)     │
                         └───────────────────────┬──────────────────────┘
                                                 │
                                                 ▼
         ┌───────────────────────────────────────────────────────────────────┐
         │  GENERATE PIPELINE  (server-side, src/lib/generate.ts)             │
         │                                                                   │
         │  1. Market snapshot (quotes + 10Y yield)                          │
         │  2. Builders run in parallel, each fault-tolerant:               │
         │        holidays · macro · ipo · news                             │
         │  3. Each builder fills a short TEMPLATE from real data           │
         │        → a "baseline" draft + a flag if any field is missing     │
         │  4. OpenAI tightens each baseline (bounded concurrency)           │
         │  5. Sort by priority, then by soonest event date                 │
         └───────────────────────────────┬───────────────────────────────────┘
                                         │  AlertBundle { generatedAt, alerts[], warnings[] }
                                         ▼
                         ┌────────────────────────────────┐
                         │  DISK CACHE                     │
                         │  data/cache/alerts.json         │
                         └───────────────┬────────────────┘
                                         │
                                         ▼
         ┌───────────────────────────────────────────────────────────────────┐
         │  DASHBOARD (Next.js)                                              │
         │  page.tsx reads the cache → renders instantly                    │
         │  Cards: badges · title · draft · sources · raw data (audit)      │
         │  Buttons: Copy · Send to Teams      Filters: All/Holiday/Macro/…  │
         │  "↻ Refresh alerts" re-runs the pipeline                         │
         └───────────────────────────────────────────────────────────────────┘
```

---

## 3. The journey of a notification (end to end)

Here is exactly what happens, in order, from opening the page to a card appearing — and what a
single news headline goes through along the way.

### Stage A — You open the page
1. `src/app/page.tsx` (a server component) calls `readCache()` and reads
   `data/cache/alerts.json` — the last generated bundle.
2. It renders `<Dashboard>` with that bundle, so **alerts appear instantly** (no waiting on APIs).
3. If there is no cache yet (first ever run), the Dashboard calls `GET /api/alerts`, which
   generates a bundle once and caches it.

### Stage B — You click "↻ Refresh alerts"
1. The browser sends `POST /api/alerts/refresh`.
2. That route calls `generateAlerts()` and writes the fresh bundle back to the cache, then returns
   it. The dashboard swaps in the new cards and shows a toast.

### Stage C — Inside `generateAlerts()` (the pipeline)
1. **Market snapshot** — `buildMarketSnapshot()` fetches index/FX/commodity quotes from FMP and the
   10-year Treasury yield (from `treasury-rates`, because `^TNX` is paid-only on the free key).
   Any symbol that fails is simply skipped with a warning.
2. **Four builders run in parallel**, each wrapped so a failure becomes a warning, not a crash:
   - `buildHolidayAlerts()` — reads `data/holidays.json`.
   - `buildMacroAlerts()` — reads the FMP economic calendar.
   - `buildIpoAlerts()` — reads the FMP IPO calendar.
   - `buildNewsAlerts()` — aggregates many RSS feeds + FMP news (detailed below).
3. Each builder turns data into one or more **Alert** objects. To do that it:
   - picks the right **template** (`src/lib/templates.ts`),
   - fills the `{placeholders}` with real values via `fillTemplate()`,
   - any placeholder with no value becomes a visible `[field]` marker and is recorded as
     **missing** → the alert is flagged `needs_review`.
4. **AI refinement** — for every alert, `refineAlert()` sends the baseline draft + the raw JSON
   payload to OpenAI with a strict prompt: *use only the facts in the payload, keep it short, no
   advice, no disclaimer.* If the model still sees an unresolved `[placeholder]`, it returns
   `NEEDS_REVIEW` and we keep the safe baseline instead.
5. **Sort** — alerts are ordered by `priority` (urgency), ties broken by soonest event date.
6. The result is an **`AlertBundle`** `{ generatedAt, alerts[], warnings[] }`, cached and returned.

### Stage D — A single news headline's path (zoom-in on `buildNewsAlerts`)
```
RSS/Atom XML  ──parse──►  RssItem{title,link,date,publisher}
   from ~15 feeds                     │
   (+ FMP news)                       ▼
                         normalize  (split "Headline - Publisher",
                                     convert dates to ISO)
                                       │
                                       ▼
                         recency filter  (drop > 48h old)
                                       │
                                       ▼
                         relevance score  (MAJOR kw ×3 + MINOR kw ×1 + feed weight)
                                       │   drop anything below threshold
                                       ▼
                         de-duplicate
                           • exact key (first 8 significant words)
                           • near-dup: token-set Jaccard ≥ 0.6
                             (collapses "yields slide" vs "10-year yield slides")
                                       │
                                       ▼
                         rank by score → keep top 10
                                       │
                                       ▼
                         fill `news_volatility` template
                           {headline}{publisher}{published_ago}{topic}{asset snapshot}
                                       │
                                       ▼
                         makeAlert(... forceReview: true ...)   ← always human-reviewed
                                       │
                                       ▼
                         OpenAI tightens wording → Alert added to bundle
```

### Stage E — The card on screen
Each `Alert` renders as a card (`src/components/AlertCard.tsx`) showing:
- **Badges** — family (Holiday/Macro/IPO/News), timing (e.g. "Breaking", "Pre-release"),
  status (**Ready** / **Needs review**), and whether it was **AI-refined** or a **Template** fallback.
- **Title** + event date.
- **Draft** — the final text (short, no disclaimer footer).
- **Sources** — clickable links to where the facts came from.
- **Source data (audit)** — the exact raw JSON the draft was built from, collapsed by default.
- **Buttons** — **Copy** (to clipboard) and, if configured, **Send to Teams**.

### Stage F — Send to Teams (optional)
1. Clicking **Send to Teams** posts the title + draft to `POST /api/teams`.
2. `sendToTeams()` wraps it in an **Adaptive Card** and POSTs to your `TEAMS_WEBHOOK_URL`
   (a Power Automate / Workflows incoming webhook). A toast confirms success or failure.

---

## 4. The four alert families

| Family | Built from | Timings produced | Review policy |
|---|---|---|---|
| **Holiday** | `data/holidays.json` | T-2 heads-up, T (day-of), T+1 reopen outlook; otherwise the next upcoming holiday | Ready (dates are known) |
| **Macro** | FMP economic calendar (NFP / CPI / FOMC) | Pre-release (schedule), Result (figure), Reaction (cross-asset moves) | Pre-release Ready; **Result flagged Needs review** (verify figure vs BLS/Fed) |
| **IPO** | FMP IPO calendar (+ SEC EDGAR link) | Preview, Pricing | Ready unless key fields missing |
| **News** | Free RSS (Yahoo, CNBC, MarketWatch, Google News, Fed) + FMP news | Breaking / Watch | **Always Needs review** |

**Why macro results are flagged:** third-party economic calendars sometimes mix units (a
month-over-month figure vs a year-over-year consensus), which can make a release look like a wild
"beat/miss". So the app shows the number **and a link to the authoritative source (BLS/Fed)** and
asks a human to confirm before distribution. The clean fix is to wire **FRED** (free key) — see §6.

---

## 5. Content guardrails (how we keep it accurate)

1. **Deterministic baseline.** The template is filled from real data *before* any AI runs. The card
   is usable even with OpenAI off.
2. **Missing-field detection.** Any unfilled `{placeholder}` becomes a visible `[field]` and flips
   the alert to **Needs review**.
3. **Constrained AI.** The LLM may use *only* the JSON payload's facts — no new numbers, dates,
   tickers, or sources. It returns `NEEDS_REVIEW` if a placeholder survives.
4. **Forced review** for the subjective/uncertain cases: all news, and released macro figures.
5. **Audit trail.** Every card carries its sources and the exact raw payload it was generated from.

---

## 6. Data sources & API keys

**Required (already in `.env`):** `FMP_API_KEY`, `OPENAI_API_KEY`.
**No other key is needed** — news comes from free, keyless RSS feeds.

**Optional upgrades** (placeholders in `.env.example`):
- **FRED** (free) — authoritative macro series (CPI/PCE, payrolls, Fed funds). *Recommended* to
  remove the macro-accuracy caveat.
- **Marketaux** / **Finnhub** (free tiers) — news sentiment + richer company/earnings data.

**FMP free-tier notes:** stable endpoints only (`/api/v3/` → 403); WTI/DXY/`^TNX` are paid, so the
app substitutes Brent, EUR/USD + USD/JPY, and the `treasury-rates` 10Y yield. ~250 calls/day — the
RSS feeds carry most of the news load so you rarely hit the cap.

---

## 7. File map (where each piece lives)

```
src/
  app/
    page.tsx                     Stage A — read cache, render dashboard
    layout.tsx                   metadata, Axi favicon
    globals.css                  Axi light theme (yellow CTA, red accent)
    api/
      alerts/route.ts            GET cached bundle (generate if empty)
      alerts/refresh/route.ts    POST regenerate (Stage B/C)
      teams/route.ts             POST send Adaptive Card (Stage F)
      diagnostics/route.ts       health check per feed
  components/
    Dashboard.tsx                filters, refresh, toast, warnings banner
    AlertCard.tsx                a single card (Stage E)
  lib/
    generate.ts                  the pipeline orchestrator (Stage C)
    rss.ts                       zero-dependency RSS/Atom reader
    sources.ts                   catalog of free public feeds (+ weights)
    fmp.ts                       FMP /stable/ client
    templates.ts                 short templates + fillTemplate()
    llm.ts                       OpenAI refinement (Stage C.4)
    teams.ts                     Adaptive Card builder + webhook post
    cache.ts                     read/write data/cache/alerts.json
    dates.ts, concurrency.ts, types.ts
    builders/
      holidays.ts  macro.ts  ipo.ts  news.ts  shared.ts
data/
  holidays.json                  curated US/Fed holiday calendar
  cache/alerts.json              generated bundle (git-ignored)
public/
  axi-logo-red.svg               brand logo (header + favicon)
```

---

## 8. Extending it (common changes)

- **Add a news source:** add one `FeedDef` to `FEEDS` in `src/lib/sources.ts` (RSS/Atom URL +
  weight + category). Use the `gnews("…")` helper for a targeted Google News topic.
- **Surface more/fewer news / tune dedup:** `MAX_NEWS` and the `0.6` Jaccard threshold in
  `src/lib/builders/news.ts`; broaden capture via the `MAJOR` / `MINOR` keyword lists.
- **Add an alert family:** new builder in `src/lib/builders/`, a template in `templates.ts`, wire it
  into the `Promise.all` in `generate.ts`, extend `AlertFamily` in `types.ts`, add the filter chip
  in `Dashboard.tsx`, and a `.badge.family-<x>` style.
- **Wire FRED (accuracy):** add a `fred.ts` client, fetch the authoritative latest observation in
  `macro.ts`, and drop the forced-review flag once the figure is trustworthy.

---

## 9. Known limitations

- Macro "actual" figures depend on FMP's calendar (hence the forced review); FRED fixes this.
- News relevance is keyword + source-weight based — strong and fast, but not semantic; a sentiment
  API (Marketaux/Finnhub) would add nuance.
- Holiday dates are curated in `data/holidays.json` — verify against the official Fed schedule.
- Refresh is manual; scheduled background refresh (cron) is a roadmap item for when this is deployed
  beyond a local machine.
