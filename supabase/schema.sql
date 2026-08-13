-- Multi-tenant schema for bito-signal (nluzkxcwczmrumikqhsv).
-- WS2 of MULTI_TENANT_PLAN.md. Applied 2026-08-08 as migration
-- `multi_tenant_stage_a` — ADDITIVE: the legacy tables (schema-legacy.sql)
-- keep serving the running app until the code that uses these ships.
--
-- Three RLS postures, per the plan:
--   per-user  auth.uid() = user_id            (bito_user_state)
--   shared    any authenticated user          (caches, sync events, profiles)
--   locked    RLS on, NO policies             (bito_hubspot_connections —
--             only the service-role client can touch OAuth tokens; a user's
--             JWT cannot read even their own row)
--
-- anon gets NOTHING here. The legacy tables' anon policies are revoked at the
-- WS2-2 two-client deploy, not before — the running app still uses them.
--
-- The old blob-per-store bito_state is replaced by:
--   bito_user_state  — still blob-per-store, but PER USER. Only that user
--                      writes their rows, so last-writer-wins is back to the
--                      single-writer case it can survive.
--   row-per-entry shared caches — the whole-object push pattern loses
--                      concurrent writes, proven at ONE user; five writers
--                      make it a certainty. Shared data gets real rows.

-- ---------------------------------------------------------------------------
-- Profiles: display names for attribution ("synced by Rohan").
-- ---------------------------------------------------------------------------
create table public.bito_profiles (
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamp with time zone not null default now(),
  constraint bito_profiles_pkey primary key (user_id)
);
alter table public.bito_profiles enable row level security;
create policy bito_profiles_auth_select on public.bito_profiles
  for select to authenticated using (true);
create policy bito_profiles_own_update on public.bito_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Per-user state: favorites, prospected marks, reviewed, collapsed,
-- low-priority, last-due, own-portal hs-presence. Blob per (user, store).
-- ---------------------------------------------------------------------------
create table public.bito_user_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  store text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint bito_user_state_pkey primary key (user_id, store)
);
alter table public.bito_user_state enable row level security;
create policy bito_user_state_own_select on public.bito_user_state
  for select to authenticated using (auth.uid() = user_id);
create policy bito_user_state_own_insert on public.bito_user_state
  for insert to authenticated with check (auth.uid() = user_id);
create policy bito_user_state_own_update on public.bito_user_state
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy bito_user_state_own_delete on public.bito_user_state
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Shared caches, row-per-entry. Any authenticated user reads and writes;
-- delete is allowed because removal (unmark "not a fit", cache invalidation)
-- is a real operation once entries are rows instead of keys in a blob.
-- ---------------------------------------------------------------------------
create table public.bito_reveal_cache (
  apollo_id text not null,
  name text,
  email text,
  email_status text,
  phone text,
  country text,
  linkedin_url text,
  company_domain text,
  revealed_by uuid references auth.users (id) on delete set null,
  updated_at timestamp with time zone not null default now(),
  constraint bito_reveal_cache_pkey primary key (apollo_id)
);

create table public.bito_company_blurbs (
  company_key text not null,
  blurb text not null,
  updated_at timestamp with time zone not null default now(),
  constraint bito_company_blurbs_pkey primary key (company_key)
);

create table public.bito_scores (
  company_key text not null,
  score integer not null,
  updated_at timestamp with time zone not null default now(),
  constraint bito_scores_pkey primary key (company_key)
);

create table public.bito_sweep_cursor (
  cursor_key text not null,
  page integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  constraint bito_sweep_cursor_pkey primary key (cursor_key)
);

create table public.bito_blacklist (
  company_key text not null,
  company text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamp with time zone not null default now(),
  -- /api/cache stamps updated_at on every upsert; this column was missing at
  -- creation and every organic blacklist write 502'd (PGRST204) until the
  -- blacklist_updated_at migration (2026-08-12) added it.
  updated_at timestamp with time zone not null default now(),
  constraint bito_blacklist_pkey primary key (company_key)
);

do $$
declare t text;
begin
  foreach t in array array[
    'bito_reveal_cache','bito_company_blurbs','bito_scores','bito_sweep_cursor','bito_blacklist'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_auth_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_auth_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_auth_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (true)', t || '_auth_delete', t);
  end loop;
end $$;

-- Contact review verdicts — the Stage-6 gate's missing half. UNRESOLVED means
-- "review the profile"; this records that review, shared across the team, so a
-- contact someone already judged doesn't come back locked (or worked) on the
-- next pull. (Migration: contact_reviews, 2026-08-12.)
create table public.bito_contact_reviews (
  key text not null,
  verdict text not null,
  user_id uuid references auth.users (id) on delete set null,
  reviewed_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint bito_contact_reviews_pkey primary key (key),
  constraint bito_contact_reviews_verdict_check check (verdict in ('qualified', 'excluded'))
);
alter table public.bito_contact_reviews enable row level security;
create policy bito_contact_reviews_auth_select on public.bito_contact_reviews
  for select to authenticated using (true);
create policy bito_contact_reviews_auth_insert on public.bito_contact_reviews
  for insert to authenticated with check (true);
create policy bito_contact_reviews_auth_update on public.bito_contact_reviews
  for update to authenticated using (true) with check (true);
create policy bito_contact_reviews_auth_delete on public.bito_contact_reviews
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Sync attribution: who pushed what to their HubSpot, visible to everyone.
-- Insert-only, and only as yourself — history doesn't get edited.
-- ---------------------------------------------------------------------------
create table public.bito_sync_events (
  id uuid not null default gen_random_uuid(),
  kind text not null,
  key text not null,
  company_key text,
  contact_key text,
  user_id uuid not null references auth.users (id) on delete cascade,
  portal_id text,
  task_url text,
  synced_at timestamp with time zone not null default now(),
  constraint bito_sync_events_pkey primary key (id),
  constraint bito_sync_events_kind_check check (kind in ('company', 'contact'))
);
create index bito_sync_events_company_idx on public.bito_sync_events using btree (company_key);
create index bito_sync_events_user_idx on public.bito_sync_events using btree (user_id);
create index bito_sync_events_at_idx on public.bito_sync_events using btree (synced_at desc);
alter table public.bito_sync_events enable row level security;
create policy bito_sync_events_auth_select on public.bito_sync_events
  for select to authenticated using (true);
create policy bito_sync_events_own_insert on public.bito_sync_events
  for insert to authenticated with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- HubSpot OAuth connections. RLS ON with NO policies: default-deny for every
-- user JWT (including the owner's). Only the service-role client — which
-- bypasses RLS — reads or writes tokens. Tokens are ADDITIONALLY encrypted
-- at rest (AES-GCM, TOKEN_ENCRYPTION_KEY env) before they reach this table.
-- ---------------------------------------------------------------------------
create table public.bito_hubspot_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  portal_id text not null,
  hub_domain text,
  hs_user_email text,
  owner_id text,
  access_token_enc text not null,
  refresh_token_enc text not null,
  expires_at timestamp with time zone not null,
  scopes text,
  connected_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint bito_hubspot_connections_pkey primary key (user_id)
);
alter table public.bito_hubspot_connections enable row level security;
