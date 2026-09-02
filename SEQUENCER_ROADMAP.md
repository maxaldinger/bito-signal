# Sequencer — Build Roadmap

Owner: Max Aldinger · Roadmap date: Aug 28, 2026 · Status: not started (reference doc)

Multi-channel outbound sequencing built into the existing Signal Intel dashboard. Target: 2 weeks, nights and weekends.

## Context

The Signal Intel dashboard (Next.js on Vercel, Supabase backend, multi-user auth) already sources and classifies prospects across five sections: Signal Feed, Signal 2000, GitHub Prospecting, Title Search, Signal favorites. Contacts are enriched through Apollo, classified against a rubric (QUALIFIED / ROUTER / UNRESOLVED), and pushed to HubSpot as tasks.

What's missing is execution. Manual outreach dies at touch two. This build adds the sequencing layer so touches three through eight run on schedule across email and LinkedIn, which is where most replies actually live.

Users: Max (4 mailboxes, manual review before enrollment), Amar (automated queue, no review), India team (optional, later).

## Decisions already made

Do not relitigate these. They were argued out before the build started.

- **Unipile for LinkedIn execution, not for research.** Unipile is a send primitive: invitations, messages, webhooks, on behalf of each connected user. ~€49/mo covers up to 10 linked accounts. Profile fetches consume the same daily action budget as sends (~80-100/account/day), so bulk research through Unipile is economically dead. Apollo employment history is the evidence layer instead.
- **Build the sequencer, don't buy it.** Amplemarket ($7,200/yr) is a sequencer, a database, and a signal feed. The dashboard already beats their targeting for this ICP — theirs is title-only, which is the exact failure mode that matters for Wells Fargo, Boomi, Intel, and every hardware-adjacent account. The only piece worth buying is LinkedIn action execution, and Unipile sells that as infrastructure for 1/10th the price.
- **Email is server-side.** Outlook/Graph, not a browser. Bito is on M365. No MV3 extension, no Playwright, no headless anything.
- **Coded automation, not n8n.** This is a stateful scheduler with per-prospect timers, branch conditions, and idempotency requirements. n8n splits state (Supabase) from execution logic (nodes), which means two places to look when a sequence stalls. `pg_cron` + Edge Functions keeps the scheduler next to the data.
- **No sticky sender.** Every send is a new email with its own subject, not a threaded reply. Mailbox rotates freely per send across the sending user's pool. Record which mailbox sent each action in `action_log` for reputation tracing.
- **Messaging is not split by product.** AI Architect and Governor are converging. One sequence library, pivot on the call.
- **Cost routing splits on public vs confidential input, not jurisdiction.** Classification runs on name, title, employment history — all public, route it to whatever is cheapest. Drafting that carries deal context from call notes or HubSpot stays on a model you'd be comfortable naming out loud.

## Schema

```
prospect
  id, linkedin_urn, linkedin_url, email, first_name, last_name,
  company, company_domain, title, country,
  classification            -- qualified | router | unresolved
  evidence_depth            -- title_only | profile_verified
  source_section            -- signal_feed | signal_2000 | github | title_search
  apollo_id, hubspot_contact_id, created_at

sequence
  id, name, owner_user_id, active, created_at

sequence_step
  id, sequence_id, step_order, channel,     -- email | linkedin_invite |
                                            -- linkedin_message | manual_task
  delay_hours, branch_condition,            -- null | invite_accepted |
                                            -- invite_not_accepted
  template_id

enrollment
  id, prospect_id, sequence_id, enrolled_by_user_id,
  current_step, state,                      -- active | paused | stopped |
                                            -- completed | failed
  stop_reason, next_action_at, created_at

action_log                                  -- append-only
  id, enrollment_id, step_id, channel,
  idempotency_key UNIQUE,                   -- non-negotiable
  sent_from_mailbox, sent_from_linkedin_account,
  status, provider_message_id, error, executed_at

event
  id, prospect_id, enrollment_id, type,     -- reply | bounce |
                                            -- invite_accepted | profile_view |
                                            -- manual_stop
  channel, payload_jsonb, occurred_at

account_action_budget
  user_id, linkedin_account_id, date, actions_used, daily_cap
```

Indexes that matter:

- `enrollment (next_action_at) WHERE state = 'active'` — the scheduler's only hot path
- `UNIQUE (prospect_id) WHERE state = 'active'` — global dedupe, enforced in the DB, not the UI
- `UNIQUE (idempotency_key)` on action_log — retry safety

## Phase 1 — Email sequencer (the whole value)

Ships first, runs live on Max's contacts before anything else starts.

- **Outlook OAuth.** Check whether all four sending domains are accepted domains in one Bito M365 tenant. If yes: client credentials flow, one app registration, `Mail.Send` application permission, admin consent once. Then lock it with `New-ApplicationAccessPolicy` in Exchange Online PowerShell so the app can only touch named mailboxes — without it, app-only `Mail.Send` is tenant-wide and that is a real finding in any security review. If domains span tenants: delegated flow per mailbox with refresh token storage.
- **Scheduler:** `pg_cron` every minute → Edge Function → query `next_action_at <= now()`, small batches to stay inside serverless timeouts.
- **Reply detection:** Graph change notification subscriptions, not polling. They expire in ~3 days. A renewal cron is mandatory or replies silently stop registering and sequences keep running at people who already answered. Match on `conversationId`.
- **Bounce handling:** hard bounce stops the email channel, LinkedIn steps continue if the sequence has them.
- **Stop conditions** evaluated before every action, not just on reply: replied any channel, bounced, manually excluded, account suppression, sequence deactivated.
- **Business hours + prospect timezone gating.** No weekend sends.
- **UI:** "Add to sequence" button on the contact card next to "Create HubSpot task". Sequence picker, not a single button. Active enrollments list under Pipeline.

**Acceptance:** 20 real prospects enrolled, full sequence runs to completion or stops correctly on reply. Zero double-sends under forced retry.

**Gate before Phase 2:** run it for two weeks. If sequenced email reply rate doesn't beat the manual baseline, the LinkedIn build is answering the wrong question. Pull the manual baseline (connection acceptance rate, reply rate, last 60 days) before Phase 1 goes live or there's nothing to compare against.

## Phase 2 — LinkedIn via Unipile

- Connect accounts (Max, Amar). Store `unipile_account_id` per user.
- Invite, message, and profile-fetch endpoints wired as channels.
- Webhooks → Vercel route handler → write to `event` → drive state transitions. Nothing else mutates enrollment state.
- Per-account daily action budget with a hard stop. Counter in `account_action_budget`, checked before every LinkedIn action. Invites, messages, and profile fetches all draw from the same pool.
- Reconnection flow. Sessions drop. When one does, surface it as a task in the dashboard, don't let sequences fail silently for a week.
- Watch acceptance rate against the manual baseline. LinkedIn throttles invite allowance based on acceptance, silently. Falling acceptance is the real cost of bad targeting, not a ban.

## Phase 3 — Cross-channel branching

- `invite_accepted` → path A (LinkedIn message). No accept after 3 days → path B (email). Reply on either channel stops both.
- Small amount of code, disproportionate testing. Every bug here is visible to a prospect.

## Phase 4 — Amar's automated queue

- Apollo person enrichment → employment history → classifier. Resolves generic "VP of Engineering" titles by what the last three roles actually were.
- Route on evidence depth, not the classification badge alone. Amar's automated queue takes `qualified AND profile_verified`. `qualified AND title_only` goes to Max's review queue.
- ROUTERs go to Amar as manual tasks, not sequences. Naga Chandrasekaran (CTO/EVP Intel Foundry) and Anil Rao (VP&GM, Office of the CTO) are peer-level asks. A CEO auto-sequencing a CTO is the failure mode. The routing ask is one paragraph anyway.
- Agreement test before it runs unsupervised: push 50 through automated profile-verification, review by hand, count overrules. Under 5% and Amar's queue runs without Max in the loop. Above that and Max is the bottleneck and the automation isn't real.
- Cache profile data aggressively. A profile fetched in March is fine for a title check in September.

## Phase 5 — Cost routing (after volume exists)

- Deterministic exclusion pass before any model call. Intel run excluded 22 of 60 as not-engineering and 8 as exec IT/security org — those are keyword matches, not judgments, and should never reach a model.
- Prompt caching on the rubric prefix. Batch pricing for classification, which is not latency-sensitive. Both together often beat a model swap.
- Split by task: classification down-routes, drafting does not. Drafting quality is customer-visible and Max's voice is the asset.
- Measure classification agreement between cheap and current model on the ambiguous bucket specifically. That bucket is the entire point of the layer.

## Suppression logic (three states, not binary)

Prospecting into open accounts is by design — Amar runs Wells Fargo while Max opens parallel threads; Guidewire is in POC and still gets multi-threaded.

- **Block:** contact is an active participant in a live thread.
- **Warn:** net-new contact at an account with an open opp. Show owner and stage, let the user proceed.
- **Allow:** everything else.

Pull activity from HubSpot at enrollment, not just the dashboard's worked-by flag. Amar sends manually and isn't in the dashboard, so his touches are only visible through HubSpot.

## Recall audit (ongoing, cheap, high value)

"Excluded 42 of 60" measures precision and says nothing about recall. False negatives all sit in the excluded bucket. "Director Information Technology Infrastructure" is correctly excluded at Intel and might be exactly right at Wells Fargo, where developer platform often lives under IT. Pull ten exclusions a week and check by hand. That's how the rubric gets tuned.
