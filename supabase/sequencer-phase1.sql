-- Sequencer Phase 1 — email sequencing tables.
-- See SEQUENCER_ROADMAP.md. Phase 1 is email only; the channel model is left
-- general so LinkedIn drops in later, but nothing here is Unipile-specific.
--
-- RLS posture: enabled with ZERO policies on every table = service-role only,
-- matching bito_hubspot_connections and bito_proposals. pg_cron and the Edge
-- Functions write these; the UI reads through route handlers on adminClient().

-- ---------------------------------------------------------------------------
-- Prospects — the identity spine. Materialized at ENROLLMENT time, not by a
-- crawler: Signal Feed / Signal 2000 / Title Search contacts are live Apollo
-- fetches that were never persisted anywhere before this table.
--
-- company_key is normCompany() (lib/companyKey.ts), which is what joins this
-- to bito_blacklist, bito_briefs, bito_scores and the SWE/spend overrides.
-- ---------------------------------------------------------------------------
create table if not exists public.bito_prospects (
  id uuid primary key default gen_random_uuid(),
  email text,
  first_name text,
  last_name text,
  title text,
  company text,
  company_key text,                       -- normCompany(company) — the join key
  company_domain text,
  country text,
  timezone text,                          -- IANA, e.g. America/Chicago; null = use sequence default
  linkedin_url text,
  linkedin_urn text,                      -- Phase 2 (Unipile); unused in Phase 1

  -- Links OUT to the existing records rather than copying them.
  apollo_person_id text,                  -- → bito_reveal_cache.apollo_id
  github_login text,                      -- → bito_enriched_contacts.login
  hubspot_contact_id text,

  -- SNAPSHOTS taken at enrollment, not sources of truth. The classifier keeps
  -- running live everywhere else; these record why this person was mailed.
  classification text check (classification in ('qualified','router','unresolved')),
  evidence_depth text check (evidence_depth in ('title_only','profile_verified')),
  source_section text check (source_section in ('signal_feed','signal_2000','github','title_search')),

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Identity dedupe. Email is required to enroll in Phase 1, so lower(email) is
-- a reliable natural key; apollo id is the stronger one when present.
--
-- NOT keyed on the existing contact_key convention (apolloId || name) on
-- purpose: that key lowercases a bare name when there is no Apollo id, so two
-- different people called "John Smith" collide. Fine for a "synced by" chip,
-- unacceptable for send dedupe and stop conditions.
create unique index if not exists bito_prospects_email_uniq
  on public.bito_prospects (lower(email)) where email is not null;
create unique index if not exists bito_prospects_apollo_uniq
  on public.bito_prospects (apollo_person_id) where apollo_person_id is not null;
create index if not exists bito_prospects_company_key on public.bito_prospects (company_key);

alter table public.bito_prospects enable row level security;

-- ---------------------------------------------------------------------------
-- Sequences and their steps.
-- ---------------------------------------------------------------------------
create table if not exists public.bito_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id),
  active boolean not null default true,
  -- Fallback for prospects with no resolved timezone (Apollo gives country,
  -- which for "US" spans six zones — too coarse to gate a 9am send on).
  default_timezone text not null default 'America/New_York',
  send_window_start_hour int not null default 8 check (send_window_start_hour between 0 and 23),
  send_window_end_hour int not null default 17 check (send_window_end_hour between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bito_sequences enable row level security;

create table if not exists public.bito_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.bito_sequences(id) on delete cascade,
  step_order int not null check (step_order > 0),
  -- Phase 1 only ever writes 'email'. The other values exist so Phase 2 adds
  -- rows, not a migration.
  channel text not null check (channel in ('email','linkedin_invite','linkedin_message','manual_task')),
  delay_hours int not null default 0 check (delay_hours >= 0),
  branch_condition text check (branch_condition in ('invite_accepted','invite_not_accepted')),
  subject text,                           -- templates only in Phase 1; no AI drafting
  body text,
  created_at timestamptz not null default now(),
  unique (sequence_id, step_order)
);
alter table public.bito_sequence_steps enable row level security;

-- ---------------------------------------------------------------------------
-- Enrollments — one live run of one sequence against one prospect.
-- ---------------------------------------------------------------------------
create table if not exists public.bito_enrollments (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.bito_prospects(id) on delete restrict,
  sequence_id uuid not null references public.bito_sequences(id) on delete restrict,
  enrolled_by_user_id uuid not null references auth.users(id),
  current_step int not null default 0,
  state text not null default 'active'
    check (state in ('active','paused','stopped','completed','failed')),
  stop_reason text check (stop_reason in (
    'replied','bounced','manually_excluded','account_suppressed',
    'sequence_deactivated','no_mailbox','send_failed'
  )),
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- GLOBAL DEDUPE, enforced by Postgres and not by application code: a prospect
-- may have many finished enrollments but only one active. The same person
-- surfaces in Signal 2000, Title Search and GitHub Prospecting in one week, and
-- two browser tabs can submit at once — this makes that a write failure rather
-- than a race.
create unique index if not exists bito_enrollments_one_active
  on public.bito_enrollments (prospect_id) where state = 'active';

-- The scheduler's only hot path: due work, active rows only.
create index if not exists bito_enrollments_due
  on public.bito_enrollments (next_action_at) where state = 'active';

alter table public.bito_enrollments enable row level security;

-- ---------------------------------------------------------------------------
-- Action log — APPEND ONLY. One row per attempted send.
--
-- idempotency_key is the single most important constraint in the build: the
-- worker claims the key BEFORE calling Graph, so a retry (timeout, redeploy
-- mid-send, pg_cron overlap) hits a unique violation instead of sending twice.
-- Format: <enrollment_id>:<step_id>:<attempt_window>.
-- ---------------------------------------------------------------------------
create table if not exists public.bito_action_log (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.bito_enrollments(id) on delete restrict,
  step_id uuid references public.bito_sequence_steps(id) on delete set null,
  channel text not null,
  idempotency_key text not null unique,
  sent_from_mailbox text,                 -- which of the rotating mailboxes sent it
  sent_to_email text,                     -- recipient AS SENT — reputation tracing needs both ends
  sent_from_linkedin_account text,        -- Phase 2
  status text not null check (status in ('claimed','sent','failed','skipped')),
  provider_message_id text,               -- Graph message id
  provider_conversation_id text,          -- Graph conversationId — how replies match back
  error text,
  claimed_at timestamptz not null default now(),
  executed_at timestamptz
);
create index if not exists bito_action_log_enrollment on public.bito_action_log (enrollment_id);
create index if not exists bito_action_log_conversation
  on public.bito_action_log (provider_conversation_id) where provider_conversation_id is not null;
alter table public.bito_action_log enable row level security;

-- ---------------------------------------------------------------------------
-- Events — the ONLY thing that mutates enrollment state. Webhooks and Graph
-- notifications write here; a state machine reads and transitions. No route
-- handler writes bito_enrollments.state directly.
-- ---------------------------------------------------------------------------
create table if not exists public.bito_sequence_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references public.bito_prospects(id) on delete restrict,
  enrollment_id uuid references public.bito_enrollments(id) on delete restrict,
  type text not null check (type in (
    'reply','bounce','invite_accepted','profile_view','manual_stop','send_failed'
  )),
  channel text,
  payload jsonb not null default '{}'::jsonb,
  -- Graph can redeliver a change notification; this makes reprocessing a no-op.
  dedupe_key text,
  processed_at timestamptz,               -- null = the state machine hasn't consumed it yet
  occurred_at timestamptz not null default now()
);
create unique index if not exists bito_sequence_events_dedupe
  on public.bito_sequence_events (dedupe_key) where dedupe_key is not null;
create index if not exists bito_sequence_events_unprocessed
  on public.bito_sequence_events (occurred_at) where processed_at is null;
alter table public.bito_sequence_events enable row level security;

-- ---------------------------------------------------------------------------
-- M365 mailboxes — modeled on bito_hubspot_connections: AES-GCM encrypted
-- tokens, single-flight refresh (lib/hubspotOAuth.ts pattern). Delegated OAuth,
-- so each mailbox's own owner consents and no tenant-wide grant is involved.
--
-- subscription_* back the Graph change-notification subscription for reply
-- detection. They expire in ~3 days; the renewal cron reads expires_at.
-- ---------------------------------------------------------------------------
create table if not exists public.bito_m365_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  email text not null,
  display_name text,
  access_token_enc text not null,
  refresh_token_enc text not null,
  expires_at timestamptz not null,
  scopes text,
  active boolean not null default true,
  -- Set false when a consent/refresh failure needs the user to reconnect; the
  -- dashboard surfaces it as a task instead of failing sends silently.
  needs_reconnect boolean not null default false,
  subscription_id text,
  subscription_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists bito_m365_mailboxes_email_uniq
  on public.bito_m365_mailboxes (lower(email));
create index if not exists bito_m365_mailboxes_sub_renewal
  on public.bito_m365_mailboxes (subscription_expires_at)
  where active and subscription_id is not null;
alter table public.bito_m365_mailboxes enable row level security;
