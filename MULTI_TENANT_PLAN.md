# Implementation Plan: Multi-tenant Bito Signal

Owner: Max Aldinger · Plan date: Aug 4, 2026 · Produced via bito-build-plan (Medium ceremony)

## 1. Executive Summary

**Ceremony Level**: Medium
**Selected Approach**: Platform rebuild — Supabase Auth + RLS + per-user HubSpot OAuth
**One-line summary**: Give Rohan, Amar and the India team individual logins and their own HubSpot connections while briefs, reveal spend, and sync history stay shared — with isolation enforced by the database, not by route code.

**Effort (Traditional)**: 22–29 eng-days (~5–6 weeks solo)
**Effort (Agentic)**: 9.5–12 eng-days (~2 weeks of sessions)
**Top Risk**: The auth swap regresses a working app that has no test suite — accepted: until the team onboards the only user is Max, every step ships as an ordinary incremental deploy, and rollback is one `vercel rollback` (plus the frozen old project for catastrophe).

**Decisions locked at checkpoints:**
- Each user has their **own HubSpot portal** → per-user OAuth; "in HubSpot" is a shared, *attributed* fact ("synced by Rohan · Aug 3"), while live presence checks run against your own portal.
- **Individual username/password per person** (Supabase Auth, signups disabled, users created by Max).
- Store split confirmed: per-user = prospected (orange), favorites, reviewed, collapsed, low-priority, last-due, own-portal presence. Shared = reveal cache, company blurbs, deep-dive scores, sweep cursor, blacklist ("Not a fit" is not a fit for anyone).
- **New, separate Supabase project — same gowarm.org account** (settled after Checkpoint 3): production currently lives in "max@gowarm.org's Project" (ref `lfyldhhlpviiqdaosnpb`), which also serves WARM. The separation is PROJECT-level, not account-level: Max keeps owning the infrastructure and bills Bito for it, and copies the project over if he ever leaves. Organizing a Bito-controlled account was judged more overhead than it's worth. The project move happens on DAY ONE (data copied old-shape, env flipped, zero code change), and everything after ships incrementally to production — Max's explicit call: "we can ship in prod, not enough people for it to matter." The old project stays frozen as catastrophic fallback.

## 2. Context Summary

One repo (`bito-signal`), one Next.js app on Vercel, one Supabase project. Current state, verified in code:

- **Auth**: one shared username/password; the cookie is a signed *constant* — "a bearer proof-of-login, not a bearer of identity" (`lib/auth.ts:18`). Enforced in `middleware.ts` on every route incl. `/api`, with a `CRON_SECRET` carve-out for `/api/github-prospect/sync`.
- **User state**: 12 client stores (`lib/clientStore.ts`) → localStorage working copy + `bito_state` in Supabase, **one row per store, no user column**, whole-object push, last-writer-wins. This shape has already destroyed data twice at a single user (server-side backfills clobbered within minutes) — it cannot survive five writers.
- **HubSpot**: one `HUBSPOT_TOKEN` private-app token + one `HUBSPOT_OWNER_ID` (Max) from env (`lib/hubspot.ts:82,625`). Every task lands in Max's portal owned by Max.
- **Shared data**: `bito_signals`, `bito_briefs`, `bito_directory`, `bito_github_*` already have no user identity — effectively shared today. RLS policies currently grant `anon` full access; the anon key is server-only.
- **Closest analogue**: the password-gate rollout (`8688a0e`) — env-gated, Web-Crypto/Edge-compatible, deploy-then-enable. Its commit message recorded "NOT multi-tenant — per-user isolation would be a data-layer rebuild." This plan is that rebuild.

**External research** ([HubSpot token management](https://developers.hubspot.com/blog/oauth-token-management-hubspot-integrations), [public app OAuth guide](https://www.mergeyourdata.com/blog/technical-guide-how-to-create-a-hubspot-public-app-with-oauth-2-0-and-token-refresh), [RLS guide](https://blog.starmorph.com/blog/row-level-security-supabase-tables-nextjs)):
- HubSpot access tokens live **30 minutes**; refresh tokens are long-lived, must be stored encrypted, and should only be replaced when HubSpot returns a new one. Refresh-on-demand with a single-flight lock is the standard pattern.
- A public app (unlisted, no marketplace review) is required for OAuth; private-app tokens don't do multi-portal.
- Supabase RLS is default-deny once enabled: a missed filter returns zero rows, never someone else's rows.

## 3. Approach Selection

### Selected: Platform rebuild — Supabase Auth + RLS

Adopt Supabase Auth (GoTrue) as the identity system and make the database enforce isolation. All data access stays server-mediated (no browser PostgREST), but server routes carry the user's JWT so `auth.uid()` applies at the DB. Chosen by Max over app-level scoping as "the proper way": DB-level enforcement, platform session management, and a clean path to growth.

### Architecture Sketch

```
Browser (each user) ──sb JWT cookies──▶ middleware (@supabase/ssr refresh + CRON carve-out)
                                          │
                                          ▼
                              /api/* routes (shapes unchanged)
                              ├─ user-scoped client (forwards JWT → RLS as auth.uid())
                              └─ service-role client (cron, signal cache, migration)
                                          │
    ┌─────────────────────────────────────┼──────────────────────────────┐
    ▼ per-user (RLS: uid = user_id)       ▼ shared (RLS: authenticated)  ▼ server-only (service role)
  bito_state(user_id, store):         bito_signals, bito_briefs,      bito_hubspot_connections
  prospected, favorites, reviewed,    bito_directory, bito_github_*,  (AES-GCM-encrypted access +
  collapsed, lowpriority, last-due,   bito_reveal_cache (row/person), refresh tokens, portal_id,
  hs-presence (own-portal checks)     bito_company_blurbs,            owner_id, expires_at)
                                      bito_scores, bito_sweep_cursor,
                                      bito_blacklist,
                                      bito_sync_events, bito_profiles

  Each user ── "Connect HubSpot" ──▶ /api/hubspot/oauth/install ─▶ their portal ─▶ /callback
```

### Alternatives Considered

- **App-level identity on the existing HMAC gate** (recommended in review, not chosen): smallest distance from a codebase whose Supabase access is entirely server-side; rejected by Max in favor of DB-enforced isolation and platform auth.
- **Per-user pasted private-app tokens instead of OAuth**: cuts the HubSpot workstream ~4 days; rejected — Max explicitly wants OAuth (one-click connect, no HubSpot admin skills required of the team).
- **NextAuth/Clerk/Auth0**: a third identity system to operate for five users; Supabase Auth is already in the stack being adopted.
- **Separate Vercel deployments per user**: forks every shared cache, multiplies Apollo/Anthropic spend, makes "who synced it" impossible.

## 4. Workstream Detail

### WS0 — New, separate Supabase project (revised at Checkpoint 3)
**Why**: verified via the Supabase API — the current project (`lfyldhhlpviiqdaosnpb`) is shared with WARM. Bito Signal data moves to its own project so the two products never mix at the data layer. Ownership stays with Max (gowarm.org account); he bills Bito for infrastructure and copies the project if he leaves.
**What**: Max creates ONE new project in the existing account (suggested name: "bito-signal"). Day one: copy all tables OLD-shape (a pure infra move — the running code doesn't change), flip Vercel + local env to the new project, verify, freeze the old one. From then on the new project IS production and every workstream ships to it incrementally, with small additive schema steps landing alongside the code that needs them (user_id on bito_state with WS1/WS3; row-per-entry cache tables with WS4; RLS + anon revocation flip on with the WS2 two-client deploy).
**Rollout philosophy (Max's call)**: ship in prod. Until the team onboards, the only user is Max; there is no separate staging environment and no big-bang cutover day. Each deploy is the same commit-push-verify loop this repo already runs daily.
**Note**: move the project to a paid tier before the team onboards (free tier pauses after ~1 week idle; fine while it's Max only).

### WS1 — Auth platform swap
**Repos**: `bito-signal`
**Key code changes**: `middleware.ts` → `@supabase/ssr` session refresh (keep `CRON_SECRET` carve-out verbatim); `app/login/page.tsx` → email+password sign-in; retire `lib/auth.ts` + `/api/auth/*`; new `bito_profiles` (user_id, display_name) seeded by Max.
**Config**: Supabase Auth — signups disabled, email confirmation off, users created in dashboard.
**Testing**: wrong-password rejection, session survives refresh, cron path passes with bearer, logout.

### WS2 — Schema + RLS
**Database changes**: `supabase/schema.sql` committed to the repo as record-of-truth (still hand-run in the dashboard, now written down): all new tables + policies; per-user tables `auth.uid() = user_id`; shared tables `authenticated` read/write; **`anon` revoked everywhere**; `bito_hubspot_connections` service-role only (no user JWT can read tokens, not even their own).
**Key code changes**: `lib/supabase.ts` + `lib/githubProspect/store.ts` gain the two-client split (user-JWT client per request; service-role client for cron/system writes). ~14 files thread through it.
**Testing**: permanent `scripts/rls-probe.mjs` — two real user JWTs + service role; asserts A cannot read B's `bito_state` or any token row; run before every cutover-adjacent deploy.

### WS3 — Per-user state
**Database changes**: `bito_state` → composite key `(user_id, store)`; Max's existing rows migrate to his uid.
**Key code changes**: `/api/state` scopes by session user; `lib/clientStore.ts` bumps `KEY_VERSION` to `.v3` **with the uid in the localStorage key** (a shared laptop must not leak one rep's marks into another's).
**Per-user stores**: prospected, favorites, reviewed, collapsed, low-priority, last-due, hs-presence.

### WS4 — Shared caches become real tables
**Why**: blob-per-store with whole-object push loses concurrent writes — proven at one user, guaranteed at five.
**Key code changes**: reveal cache moves server-side into `/api/enrich/apollo/person` itself — check `bito_reveal_cache` (row per Apollo person id) before spending a credit, write after. Rohan never re-pays for a reveal Max already bought, and the 2,696-entry blob disappears. Blurbs, deep-dive scores, sweep cursor, blacklist get row-per-entry tables with small GET/upsert endpoints; client keeps a session memory cache only.

### WS5 — HubSpot OAuth
**External setup**: HubSpot developer account + unlisted public app. Scopes: `crm.objects.contacts.read/write`, `crm.objects.companies.read/write`, `crm.objects.owners.read`, `oauth`. Redirect: `https://bito-new-customer-intel.vercel.app/api/hubspot/oauth/callback` (+ staging/localhost).
**API changes**: `GET /api/hubspot/oauth/install` (signed state), `GET /api/hubspot/oauth/callback` (code exchange → portal id via token introspection → resolve the user's own owner id → encrypt + store), `POST /api/hubspot/oauth/disconnect`.
**Key code changes**: `lib/hubspot.ts` `resolveAccessToken()` → `resolveAccessToken(userId)`: decrypt, refresh when <5 min to expiry behind a **single-flight lock**, store a new refresh token only when HubSpot returns one. All call sites (`/api/hubspot/search`, `/api/hubspot/task`) thread the session user. Task owner id comes from the connection; `HUBSPOT_OWNER_ID` env retired. Weekly cron keeps the env private-app token (Max's portal) for dedupe.
**Config**: `TOKEN_ENCRYPTION_KEY` (AES-GCM), `HS_CLIENT_ID`, `HS_CLIENT_SECRET`.
**UI**: sidebar connect-status chip → install flow.

### WS6 — Sync attribution
**Database changes**: `bito_sync_events` (kind company|contact, key, company_key, contact_key/email, user_id, portal_id, synced_at, task_url) — written server-side on every successful task create; Max's existing prospected marks seed it at cutover with original dates.
**Key code changes**: cards + collapsed rows show your own orange mark *plus* a shared chip "synced by Rohan · Aug 3" (name via `bito_profiles`); "In HubSpot first" sort = own-portal checks ∪ sync events.

### WS7 — Day-one project move + incremental data migrations + cleanup
**Data continuity guarantee (explicit requirement from Max)**: at every stage, Max's current working state stays current — nothing resets, nothing is regenerated, no credit is re-spent. Concretely: (1) day one copies everything verbatim, so the app is indistinguishable before/after the env flip; (2) when per-user state lands, ALL existing `bito_state` rows are assigned to Max's uid — orange marks, favorites, reviewed, collapsed, low-priority, with original timestamps; (3) briefs, Signal 2000, signals, GitHub prospects, and the 2,696-entry reveal cache carry over as-is into shared tables; (4) Max's prospected marks additionally seed `bito_sync_events` with their original dates, so when the team joins they see "synced by Max · <original date>" on every account he has already worked. Each migration step's AC includes a before/after spot-check of Max's marks, favorites, and a known cached reveal.
**Day one (with WS0)**: scripted cross-project copy, old project → new, OLD shapes as-is (all tables are small: ~170 briefs, 2,000 directory rows, a few thousand signals, 2,696 reveals — minutes over PostgREST with both service keys; per-table row counts asserted). Flip env, verify the app works unchanged, freeze the old project.
**Per-workstream migrations, shipped with the code that needs them**: Max's `bito_state` rows → his uid (lands with WS1/WS3); blob stores → row-per-entry tables (lands with WS4); prospected marks → `bito_sync_events` with original dates (lands with WS6).
**Team onboarding**: once WS3 + WS5 are live, create the 4–5 auth users + profiles and invite the team — a normal deploy, not an event.
**Cleanup, after a clean week**: export a final snapshot of the old project's Bito tables for the record, then delete them from the shared WARM project to complete the separation. Retire `AUTH_USERNAME/PASSWORD/SECRET` and `HUBSPOT_OWNER_ID`. `RUNBOOK.md`: add a user, rotate `TOKEN_ENCRYPTION_KEY`, reconnect HubSpot, tier upgrade.

## 5. Task Breakdown

### STORY: Multi-tenant Bito Signal

| # | Task | WS | Trad | Agentic | Blocked By | AC |
|---|---|---|---|---|---|---|
| 1 | Max creates the new project; day-one copy (old shapes) + env flip + freeze old | 0/7 | 1d | 0.5d | none | app runs unchanged on the new project; old project frozen; row counts match |
| 2 | `supabase/schema.sql`: all tables, RLS policies, anon revocation | 2 | 2d | 1d | 1 | applies cleanly to a fresh project; anon returns zero rows everywhere |
| 3 | Auth config + create users + `bito_profiles` | 1 | 1d | 0.5d | 2 | signup disabled; 5 users exist; profiles seeded |
| 4 | `@supabase/ssr` middleware + `/login` swap; retire HMAC gate | 1 | 2d | 1d | 3 | wrong password rejected; session survives refresh; cron bearer passes |
| 5 | Two-client split in `lib/supabase.ts` + `githubProspect/store.ts` | 2 | 2d | 1d | 4 | `scripts/rls-probe.mjs` proves cross-user isolation + token-table opacity |
| 6 | `bito_state(user_id, store)` + scoped `/api/state` + `.v3` uid keys | 3 | 2d | 1d | 5 | two logged-in users hold disjoint marks; shared laptop shows only the signed-in user's state |
| 7 | Reveal cache server-side in the person route | 4 | 1.5d | 0.5d | 5 (parallel-safe) | second user revealing a cached contact spends zero credits |
| 8 | Blurbs/scores/cursor/blacklist row-per-entry + endpoints | 4 | 2d | 1d | 5 (parallel-safe) | concurrent writes from two users both persist |
| 9 | HubSpot public app + install/callback/disconnect routes | 5 | 2d | 1d | 4 | connect flow completes from the sidebar; portal id + owner id stored |
| 10 | Encrypted token store + refresh-on-demand w/ single-flight | 5 | 2d | 1d | 9 | forced-expired token refreshes transparently; two parallel calls refresh once |
| 11 | Thread userId through search/task call sites + owner resolution | 5 | 1.5d | 0.5d | 10 | a task created by Rohan lands in Rohan's portal, owned by Rohan |
| 12 | `bito_sync_events` + attribution chip + sort union | 6 | 2d | 1d | 11 | Amar sees "synced by Rohan · date" on a card Rohan pushed |
| 13 | Team onboarding + old-project snapshot & cleanup + `RUNBOOK.md` | 7 | 1.5d | 1d | 6, 11 | team logged in and connected; old project Bito tables snapshotted then cleared |

**Total (Traditional)**: 22.5–29 eng-days · **Total (Agentic)**: 9.5–12 eng-days
**Basis**: file-level footprint measured in-repo (12 stores in `clientStore.ts`, ~14 Supabase call sites, 2 HubSpot entry routes); HubSpot token mechanics from vendor docs. Low compression: WS5 token/encryption/race work. High compression: schema, CRUD endpoints, threading.

## 6. Sequencing

Critical path: **1 → 2 → 3 → 4 → 5 → 6 → 9 → 10 → 11 → 12 → 13**, with 7–8 parallel after task 5.
Every task ships to production as it completes — the same commit-push-verify loop this repo runs daily. Max live-tests each step as the only user; the India team onboards at task 13, which is a normal deploy rather than a cutover event. Agentic timeline ≈ 2 weeks of working sessions.

## 7. Cross-Cutting Concerns

- **Data migration**: day-one cross-project copy in old shapes (row-count-asserted), then small per-workstream migrations shipped with the code that needs them.
- **Backward compatibility**: not needed — single-user production until onboarding, shipping incrementally by explicit decision.
- **Rollback**: per step, `vercel rollback` (schema steps are additive); catastrophically, flip env back to the frozen old project.
- **Security**: signups disabled; anon fully revoked; tokens AES-GCM at rest, unreadable by any user JWT; RLS default-deny converts missed filters into empty results, not leaks; `SUPABASE_SERVICE_ROLE_KEY` is a new secret confined to server env.
- **Observability**: log OAuth refresh failures + disconnects with user id; log sync-event writes; Vercel runtime logs remain the venue.
- **Performance**: no material change — server-mediated PostgREST as today; reveal-cache lookups replace a client blob with an indexed point read.
- **Testing**: `scripts/rls-probe.mjs` becomes the permanent isolation gate (this repo has no test suite; the probe is the one non-negotiable check).
- **Docs**: `supabase/schema.sql`, `RUNBOOK.md`.
- **Skipped**: load testing (5 users), API versioning (single client).

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Auth swap regresses a suite-less app | Med | High | Build on staging; old gate env retained; rollback = one command |
| Refresh-token race corrupts a HubSpot connection | Med | High | Single-flight lock; replace refresh token only when HubSpot returns one |
| Missed user-JWT plumbing in one of ~14 files | Med | Med | RLS default-deny → symptom is empty view, never leaked data; probe script |
| `.v3` bump reads as "my data vanished" | High | Low | Server migrated first; localStorage rehydrates on first load |
| Cron dedupe scope (runs as Max's portal only) | Low | Low | Accepted default; revisit if India-side GitHub prospecting starts |
| Free-tier project pauses when idle during build | Med | Low | One-click restore; move to paid tier at cutover |
| Cross-project copy misses a table or truncates | Low | High | Script asserts per-table row counts source vs dest before cutover proceeds |

## 9. Open Questions

- **Cron token**: weekly GitHub-prospect dedupe keeps using Max's env private-app token — accepted default, revisit if the team works that tab.
- **Display names**: Max seeds `bito_profiles` at cutover (accepted).
- **Sync events store contact email/key**: yes (accepted default) — makes person-level attribution precise.
- **Regions**: India users get the same region toggle as today; no per-user defaults (accepted default).
- **Infrastructure ownership** (settled): Max owns the account, bills Bito, copies the project on departure. The GitHub repo and Vercel team follow the same model — no further action.

## 10. Scope Boundary

**In scope (MVP)**: everything in §4–5 — individual logins, per-user state, shared caches as tables, per-user HubSpot OAuth, sync attribution, migration.
**Out of scope (follow-on)**: role/permission tiers (everyone is equal); per-user Apollo/Anthropic budgets; HubSpot-synced outcome tracking (roadmap item 2); India-region per-user defaults; password self-service reset (Max resets via dashboard); marketplace listing of the HubSpot app.

## Context Handoff (for downstream skills)

- **Repos confirmed indexed**: `bito-signal` ❌ not indexed in BitoAIArchitect — all exploration was direct local code search (paths verified Aug 4, 2026)
- **Closest analogues**: `bito-signal:lib/auth.ts` (env-gated auth rollout pattern), `bito-signal:lib/clientStore.ts` (store sync machinery being replaced), `bito-signal:lib/hubspot.ts:82` (`resolveAccessToken` — becomes per-user), `bito-signal:app/api/state/route.ts` (ALLOWED store list), `bito-signal:middleware.ts` (CRON carve-out to preserve)
- **Service topology snapshot**: one Next.js app (Vercel) → Supabase PostgREST (server-only anon key today; splits into user-JWT + service-role clients) → external: Apollo, Anthropic, HubSpot (env token today → per-user OAuth), GitHub. Weekly Vercel cron → `/api/github-prospect/sync`.
- **Active-work collisions detected**: same-day work on this repo included the Aug 4 contact-classification spec (`af19b66`) touching `lib/enrich/apollo.ts` + `components/CompanyIntel.tsx` — rebase carefully around those files.
- **Domain glossary terms resolved**: "prospected mark" → per-user orange badge, key→timestamp map, normalized via `normCompany()`; "sync event" → NEW shared attributed record of a HubSpot task push (this plan introduces it); "shared cache" → reveal/blurb/score/cursor/blacklist data any user may read and all benefit from; "presence" → per-user own-portal live check result, distinct from sync events.
- **Open architectural decisions deferred to coding task author**: exact single-flight lock mechanism for token refresh (in-memory per-lambda vs DB advisory lock — recommend DB row lock given serverless); whether `bito_scores` reads derive live from `bito_briefs.intel` instead of a table (either acceptable).
