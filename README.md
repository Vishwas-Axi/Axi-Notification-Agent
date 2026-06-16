# Axi · Market Alert Center

An automated **alert / partner-notification command center** for Axi. Open the page and it
immediately shows ready-to-use alert drafts — US market holidays, macro events (NFP / CPI / FOMC),
IPOs, and breaking-news / volatility watches — built from **many free public sources** and tightened
by **OpenAI**, with source links and the underlying data attached for audit.

A human stays in the loop: drafts are displayed for review, with **Copy** and **Send to Teams**
buttons rather than auto-publishing. Cards are short and carry **no legal disclaimer** — the desk
adds approved disclaimers at distribution time.

---

## What's new in this version

- **Multi-source news (no extra API key).** News is no longer dependent on FMP. It is aggregated
  from free public RSS feeds — **Yahoo Finance, CNBC, MarketWatch, the Federal Reserve**, and
  **targeted Google News topic queries** (Fed/rates, inflation, jobs, oil, geopolitics, IPOs, FX).
  Headlines are de-duplicated across sources (token-similarity), filtered for recency (last ~48h),
  and ranked by impact + source quality so the highest-value items always surface first.
- **More, fresher, less-repetitive alerts** — typically ~20 per refresh vs a handful before.
- **Light, Axi-branded UI**; short cards; disclaimer footer removed.
- **Macro accuracy guardrail** — released macro figures (e.g. CPI) are flagged **Needs review**
  because calendar feeds can mix units (MoM vs YoY); each links to the authoritative source (BLS/Fed).

---

## Tech stack

- **Next.js 14 (App Router) + TypeScript** — one app, frontend + API routes together.
- **Free public RSS** (`src/lib/rss.ts` + `src/lib/sources.ts`) — breaking news, zero keys, zero deps.
- **Financial Modeling Prep (`/stable/`)** — economic calendar, IPO calendar, treasury rates, quotes (+ news as one more source).
- **OpenAI** — tightens each deterministic template draft (strict "use only the payload" prompt, short output).
- **Disk cache** (`data/cache/alerts.json`) — the page loads instantly; **Refresh** regenerates.
- No database. No secrets in the browser — all FMP/OpenAI calls happen server-side.

---

## Setup

### 1. Prerequisites
- Node.js 18.18+ (you have v22 ✓)

### 2. Environment variables
Your keys live in `.env` (already present). Required:

```
FMP_API_KEY=...
OPENAI_API_KEY=...
```

Optional (see `.env.example`):

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o-mini` | Model used to refine drafts |
| `TEAMS_WEBHOOK_URL` | _(empty)_ | Enables the "Send to Teams" button |
| `ALERT_AUDIENCE` | Axi desks/RMs/partners | Tone/audience in the AI prompt |

> `.env` and `.env.local` are git-ignored — never commit them.

### 3. Install & run

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. First load generates the alert bundle (~20–40s) and caches it.
After that it's instant; click **↻ Refresh alerts** to pull fresh data.

See **`HOW_TO_RUN.md`** for the day-to-day start/stop guide (PowerShell), and
**`HOW_IT_WORKS.md`** for a full walkthrough of the architecture and the journey each
notification takes from raw data to the screen.

### 4. Health check
Visit **http://localhost:3000/api/diagnostics** to confirm every feed works with your key.

---

## Do I need any more API keys?

**No.** Everything works today with just your existing `FMP_API_KEY` and `OPENAI_API_KEY`.
News comes from free, keyless RSS feeds. The following are **optional** upgrades only:

| Service | Free tier | Why you might add it |
|---|---|---|
| [FRED](https://fred.stlouisfed.org/docs/api/api_key.html) | free key | Authoritative macro series (CPI/PCE, payrolls, Fed funds) → fixes the macro-number accuracy caveat |
| [Marketaux](https://www.marketaux.com/) | 100 req/day | News **sentiment** + entity tagging |
| [Finnhub](https://finnhub.io/) | 60 req/min | Richer company news + earnings/IPO data |

Drop any of these into `.env` (placeholders are in `.env.example`) and they can be wired into the
builders as a future enhancement. The recommended next add is **FRED**, purely for macro accuracy.

---

## Connecting Microsoft Teams (optional)

The "Send to Teams" button posts an Adaptive Card to a Teams **Incoming Webhook** created
with the **Workflows** app (the modern replacement for O365 connectors — fits your Power Automate setup):

1. In the target Teams channel: **••• → Workflows → "Post to a channel when a webhook request is received"**.
2. Complete the flow; copy the generated **HTTP POST URL**.
3. Put it in `.env`: `TEAMS_WEBHOOK_URL=https://...`
4. Restart `npm run dev`. The button appears on every card.

---

## Alert families

| Family | Source | Notes |
|---|---|---|
| **Holiday** (T-2 / T / T+1) | `data/holidays.json` | Verify dates against the [Fed schedule](https://www.frbservices.org/about/holiday-schedules/) before live use |
| **Macro** (NFP / CPI / FOMC) | FMP economic calendar | Pre-release is reliable (dates); **results flagged for review** (verify figure vs BLS/Fed) |
| **IPO** (preview / pricing) | FMP IPO calendar + SEC EDGAR link | Instrument-live alert deferred — needs internal platform status |
| **News / volatility** | Free RSS (Yahoo, CNBC, MarketWatch, Google News, Fed) + FMP | Always flagged **Needs review** before external send |

### Content guardrails
- Deterministic template fill flags any missing field as `NEEDS_REVIEW`.
- The LLM may only use facts in the payload; if a `[placeholder]` survives it returns `NEEDS_REVIEW`.
- News and released macro figures are force-flagged for human review.

## Data-source notes (FMP free tier)
- WTI (`CLUSD`), DXY, and `^TNX` are **paid-only** on your FMP key — the app uses **Brent (`BZUSD`)**,
  **EUR/USD + USD/JPY**, and the **`treasury-rates`** 10Y yield instead.
- FMP free tier is ~250 calls/day; the RSS feeds carry most of the news load so you rarely hit it.

## Project structure

```
src/
  app/
    page.tsx                # reads cache, renders dashboard
    api/alerts/route.ts     # GET cached bundle
    api/alerts/refresh/...  # POST regenerate
    api/teams/route.ts      # POST send to Teams
    api/diagnostics/route.ts
  components/               # Dashboard, AlertCard (client)
  lib/
    rss.ts                  # RSS/Atom reader (no deps, no key)
    sources.ts              # catalog of free public feeds
    fmp.ts                  # FMP /stable/ client
    builders/               # holidays, macro, ipo, news, shared
    templates.ts            # short templates + fill
    llm.ts                  # OpenAI refinement
    generate.ts             # orchestrator
    cache.ts, teams.ts, dates.ts, concurrency.ts, types.ts
data/
  holidays.json
  cache/alerts.json         # generated (git-ignored)
.claude/skills/market-alert-center/SKILL.md   # reusable project skill (see below)
```

## The project skill

A Claude Code skill lives at **`.claude/skills/market-alert-center/SKILL.md`**. Next time you open
this folder in Claude Code, type **`/market-alert-center`** to load the full context (how to run,
the architecture, how to add a news source or alert family, and the known caveats) without
re-explaining anything.

## Roadmap
- Wire **FRED** for authoritative macro numbers (removes the result-accuracy caveat).
- Approval workflow + delivery log / audit trail (every message: source, rule, template, status).
- Scheduled background refresh (cron) once deployed.
- Optional news **sentiment** (Marketaux/Finnhub) to auto-prioritise negative/high-impact stories.
