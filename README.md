# Bito Signal

Live sales-intelligence dashboard for [Bito](https://bito.ai) — AI code review for
SWE-heavy companies with large, complex codebases.

Every signal and every intel brief is generated **live** by Anthropic
`claude-sonnet-4-20250514` with the `web_search` server tool. There is no static
data, no seeded companies, no canned briefs. An optional enrichment layer adds
firmographics, contacts and real codebase stats from Apollo, Hunter, GitHub,
Proxycurl and Crunchbase.

## What's inside

| Tab | What it does |
| --- | --- |
| **Signal Feed** | Live buying signals across five buckets: engineering hiring, major OSS/GitHub activity, M&A creating codebase complexity, funding rounds with eng build-out language, AI-tooling spend commentary. Each signal carries a 0-99 ICP-fit estimate. |
| **Intel Brief** | Click any account (or search one): live research producing ICP score breakdown (SWE headcount 50-500, codebase complexity, multi-repo, scaling activity, AI-tooling spend), stakeholder map (who feels the pain vs who signs), estimated token-cost exposure, onboarding-friction score, suggested motion (PLG / Top-Down / Champion-Led / Land-and-Expand) with reasoning, a specific outreach angle with a copy-ready draft, and full source citations. |
| **Sales Assist** | Chat helper for reps: ask anything, cold emails, objection handling, live account research — all grounded with web search. |
| **Live Enrichment** | Inside each brief: merged data from the configured enrichment providers — headcount, tech stack (AI dev tools highlighted), top repos, commit velocity, contributors, funding, contacts with emails. |

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/signals?type=X` | GET | Bucket scan. Default: FREE discovery — structured sources (GDELT, Hacker News, GitHub, TechCrunch RSS, Apollo) fetch raw candidates, one no-search Claude call grades them (zero billed searches). `&deep=1` opts into the claude-sonnet-4 + web_search deep scan. |
| `/api/intel?company=X` | GET | Full intel brief for one company |
| `/api/assist` | POST | Sales assist chat (`{mode, tone, persona, messages}`) |
| `/api/enrich?company=X[&domain=Y][&github=org][&linkedin=url]` | GET | Orchestrator — fans out to all configured providers, merges a rollup |
| `/api/enrich/apollo?company=X[&domain=Y]` | GET | Apollo firmographics + people + tech stack |
| `/api/enrich/hunter?domain=Y[&email=Z]` | GET | Hunter email pattern / finder / verifier |
| `/api/enrich/github?company=X[&org=Y]` | GET | GitHub org stats: repos, stars, languages, commit velocity, contributors |
| `/api/enrich/proxycurl?company=X[&domain=Y][&linkedin=url]` | GET | LinkedIn company data (see status note below) |
| `/api/enrich/crunchbase?company=X` | GET | Funding rounds, employee range, categories |

Provider routes return `200` on success, `501` when the API key isn't configured,
and `502` on upstream failure — always with an honest `error` string, never mock data.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in keys
npm run dev
```

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | **Yes** | Web search must be enabled for the workspace (Anthropic Console → Settings → Privacy). |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-sonnet-4-20250514`. |
| `ANTHROPIC_WEB_SEARCH_MAX` | No | Searches per request (default 5). |
| `APOLLO_API_KEY` | No | Firmographics, tech stack, people. People search requires a **master** API key on current Apollo plans; with a scoped key you still get org data. |
| `HUNTER_API_KEY` | No | Email pattern + finder + verification. |
| `GITHUB_TOKEN` | No | Works keyless at 60 req/h; any classic PAT (no scopes) raises limits to 5,000 req/h. |
| `PROXYCURL_API_KEY` | No | ⚠️ See status note below. |
| `CRUNCHBASE_API_KEY` | No | Basic-tier keys return summary fields only; funding fields need a higher tier (the client falls back gracefully). |

### ⚠️ Proxycurl status

Proxycurl **shut down in July 2025** (settlement of *LinkedIn Corp. v. Nubela Pte.
Ltd.*). Its endpoints now return HTTP 410 `API_SUNSET`, and old keys were migrated
to Nubela's successor product (NinjaPear), which is a different API. The client is
implemented against the last documented Proxycurl API and reports the shutdown
honestly at runtime. For LinkedIn-grade headcount data, consider alternatives like
Coresignal, People Data Labs, or Bright Data — or rely on Apollo's
`estimatedEmployees`, which the rollup already uses.

## Deploy (Vercel)

Zero-config Next.js 15 deploy:

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

Then set the env vars (at minimum `ANTHROPIC_API_KEY`) in the Vercel project →
Settings → Environment Variables, and redeploy. Long-running routes declare
`maxDuration` (up to 180s for `/api/intel`), within the platform's 300s default.

## Notes on honesty

- ICP scores, token-cost figures, and stakeholder maps are **model estimates
  grounded in cited sources** — the UI labels them as such and links every source.
- Token-cost exposure uses public per-seat anchors (Copilot Business ~$19,
  Copilot Enterprise ~$39, Cursor Business ~$40 per seat/month) multiplied by an
  evidenced seat estimate; assumptions are disclosed in each brief.
- Enrichment providers never fabricate fields: missing key → "not configured",
  upstream gap → omitted field.
