# Bito Signal — Session Handoff (2026-06-16)

Single-tenant prospecting tool for Bito (AI code review). Next.js, deploys from `main`
to Vercel (`bito-new-customer-intel.vercel.app`, portal/HubSpot id `39485798`).
This doc covers everything changed in this session and what's needed to run it.

---

## 0. MUST-DO before using (operational)

These are required for the app to actually work in prod/local — not optional.

| Env var | Value | Where |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` (or unset) | `.env.local` + Vercel |
| `ANTHROPIC_MODEL_FAST` | `claude-haiku-4-5` (optional; defaults to this) | — |
| `APOLLO_API_KEY` | (already set) | both |
| `HUBSPOT_TOKEN` | **Private App** token `pat-na1-…` (NOT the CLI Personal Access Key) | `.env.local` + Vercel |
| `HUBSPOT_OWNER_ID` | `93697991` (the rep's HubSpot owner id) | `.env.local` + Vercel |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | (already set) | both |

Then:
1. **Re-pull the signal feed** ("Pull More Signals") — all grader/scoring fixes only apply to
   newly graded signals; the cached feed is stale (no SWE estimates, old account quality).
2. After any env change: restart the dev server (local) / redeploy (Vercel). Env vars are
   read at startup/deploy, not live.

---

## 1. What changed, by area

### Deep-dive "Suggested people to contact" → real Apollo people
- Replaced the LLM-invented stakeholder cards with **real engineering leaders from Apollo
  people-by-title search** (`/api/enrich/apollo/people` → `apolloPeopleByTitle`). Free, no credits.
- Cards split into two columns by Apollo `seniority` (decision-makers vs practitioners).
- **Apollo email / Apollo phone** reveal buttons per card: match by Apollo **person id**
  (exact, un-obfuscates the last name), via `/api/enrich/apollo/person?id=…&reveal=email|phone`.
  Reveal consumes 1 Apollo credit; search does not.
- **Draft email** button per card → personalized cold email via `/api/assist` (ask mode).

### Deep-dive restructure
- **Removed** sections: live enrichment (`EnrichmentPanel`, now dead code), onboarding friction,
  competitive context, live sources.
- **Outreach angle** moved to sit directly under the people section.
- **ICP score breakdown** sub-scores now show **percentages** (bar + number agree), not bare
  `/20` integers. Headline stays `/99`.

### ICP score consistency + prospected markers
- Signal-feed card score: once a deep-dive brief is generated, its **real ICP total is cached**
  (localStorage, `lib/clientStore.ts`) and shown on the card; pre-brief shows the rough per-signal
  estimate with a `~`. Fixes "card says 72, brief says 25."
- **Prospected** badges: creating a HubSpot task badges the company/contact across signal cards,
  brief header, and contact cards. localStorage-backed (`lib/clientStore.ts`), **per-browser, not
  synced from HubSpot**.

### Signal feed quality
- **Model retirement fix:** `claude-sonnet-4-20250514` is retired (404) → `claude-sonnet-4-6`.
- **Model split for cost:** `FAST_MODEL` (Haiku 4.5) for the no-search **signal grader** and the
  **assist structured tool modes** (LOU/MEDDPICC/threading/proposal/deck). Sonnet stays on the
  intel brief, the deep web-search scan, and the assist "ask" chat.
- **SWE-size filter:** now inclusive of unknown-size signals (don't hide what we can't size).
  Empty-state bug fixed so an over-filtered page never renders blank.
- **Grader SWE estimate:** always emits a best-effort engineer-headcount estimate. (Key bug: the
  grader prompt literally said "never guess sweEstimate," overriding the rule — fixed.)
- **Grader account quality:** real org, ~50+ engineer floor (drops solo devs). NOTE: an earlier
  commit wrongly banned AI-tool vendors (GitHub/Cursor) as accounts — **reverted**; they're valid
  prospects, the size estimate sorts them into the right band.
- **OSS bucket:** "no qualifying signals" is now a soft empty result (200), not a red "scan failed"
  — OSS sources (GitHub Trending, Show HN) are structurally indie-biased and often legitimately
  empty. Added `hnWithRetry` for HN Algolia 4xx/429 bursts.

### Sidebar / layout
- Pull + pagination + sort controls moved out of the feed into a compact **`PullControls`** at the
  top of a now-**collapsible filters** sidebar. Sort state lifted to `page.tsx`. Mobile keeps a copy.

### HubSpot integration (`lib/hubspot.ts`, `app/api/hubspot/*`, `components/HubSpotActions.tsx`)
- **Check** (search company by domain/name, contact by email/name) + **Create task** buttons on the
  brief header (company) and every contact card.
- **Auto-check** on populate — runs the lookup automatically when a deep dive loads; contact checks
  are **staggered 300ms apart** to respect HubSpot's ~4 req/s search limit; re-checks when an Apollo
  reveal sharpens the name/email.
- **Task modal:** due-date picker, type (Call/To-do/Email), editable subject + body. Rendered via a
  **React portal to `document.body`** (escapes the animated section's transform containing-block, so
  it overlays the viewport, not the section). Header/scroll-body/footer layout capped at 88vh.
- **Complete records:** a contact task resolves/creates the parent company, resolves/creates the
  contact writing email+phone+jobtitle, links contact↔company, and creates the task associated to
  BOTH. Missing email/phone is revealed from Apollo (by id) at task time.
- **Task body** (per contact) includes WHO (title/seniority), COMPANY line, the SIGNAL (exec
  summary), and SUGGESTED OUTREACH (company-level by default; **"Personalize outreach"** button in
  the modal swaps in a per-individual AI draft).
- **Owner:** tasks set `hubspot_owner_id` from `HUBSPOT_OWNER_ID` so they land in the rep's queue.
- **Em dashes stripped** from all generated outreach (`stripEmDashes` in `lib/format.ts`) — em→comma,
  en→hyphen — applied deterministically at every display/use point.

---

## 2. Key gotchas / decisions (read before changing things)

- **HubSpot auth:** the client accepts a `pat-na1-…` Private App token (used directly) OR a CLI
  Personal Access Key (auto-exchanged via `localdevauth`). A **Personal Access Key carries read
  scopes only** — search works but task/record CREATE 403s with `MISSING_SCOPES` ("not available for
  public use" = wrong credential type). **Writes require a Private App token** with
  `crm.objects.contacts` + `crm.objects.companies` read+write. There is **no separate "tasks" scope**
  (tasks are engagements covered by `contacts.write`). Webhooks are NOT needed.
- **Unassigned tasks are hidden:** a task with no owner is created fine but doesn't show in the
  default "Assigned to me" view → hence `HUBSPOT_OWNER_ID`.
- **ICP estimates are model estimates**, and the per-signal strength vs deep-dive total are two
  separate passes (will diverge). Useful for triage, not forecasting.
- **Apollo ICP-sweep signals carry no SWE estimate** (generated without the model) — they stay
  visible under any size filter via the inclusive rule.
- **Commit messages:** use `git commit -F <file>` for multi-line messages — the PowerShell
  `@'…'@` here-string breaks in the Bash tool (an apostrophe truncates it; leaves a stray `@`).

---

## 3. Known limitations / "sharpen later" roadmap

1. **Signal trust is the weak link.** Free sources are fragile; Apollo sweep is thin/no-intent. It's
   a strong triage layer, not yet "these accounts are in-market." → add a verification/intent layer.
2. **No feedback loop.** Prospected state is per-browser localStorage, not synced from HubSpot; no
   outcome tracking back into scoring. → HubSpot-synced state + outcome capture.
3. **Compliance unaddressed** (GDPR/CAN-SPAM, personal phone reveal, India mode).
4. **Optional:** per-route effort tuning (Sonnet runs at default `effort: high`; deep scan could be
   `medium`). No `output_config` is set today.

---

## 4. Commit reference (this session, oldest→newest)

```
92ab8bc Apollo email/phone reveal buttons on stakeholder cards
557c5ba Apollo reveal: require a named person, fix misleading error
894d23c Drive stakeholder cards from Apollo people search (real names)
35df5ac Restructure deep dive: trim sections, per-person drafts, raw ICP
aa5bb72 HubSpot: complete contact records + richer per-contact task body
96a0739 Add HubSpot integration: check record + create task
b122d56 HubSpot: accept a Personal Access Key (auto-exchange)
0b1c161 Move pull/pagination controls into a collapsible sidebar
ee4702c Fix ICP score display + add prospected markers
d323a66 Fix retired model: claude-sonnet-4-20250514 -> claude-sonnet-4-6
a84467f Route high-volume structured calls to Haiku 4.5
bb75cc1 Fix SWE-size filter nuking the feed on sizeless signals
f220856 Grader: always emit a best-effort SWE headcount estimate
d2a7174 Grader quality: drop AI-tool vendors, enforce buyer + 50-eng floor (PARTLY REVERTED next)
d5fd925 Revert vendor exclusion: GitHub/Cursor are valid prospects, size sorts them
5e928ef OSS: stop flagging "no qualifying signals" as a failed scan
ba959ff HubSpot task modal: wider, taller notes, nothing clipped
873019e HubSpot task modal: portal to body so it overlays the viewport
563ee90 HubSpot: auto-check company + contacts on populate (staggered)
b79da4d Strip em dashes from generated outreach
2b82a22 HubSpot task: "Personalize outreach" button (contacts)
dd17fb5 HubSpot 403: clearer error — Personal Access Key can't write, use a Private App
3d63e3b HubSpot tasks: assign to HUBSPOT_OWNER_ID so they show in "my tasks"
```
