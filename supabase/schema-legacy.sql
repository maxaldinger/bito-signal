-- Day-one schema for the bito-signal Supabase project (nluzkxcwczmrumikqhsv).
--
-- This is an EXACT replica of the bito_* tables as they existed in the shared
-- WARM project (lfyldhhlpviiqdaosnpb) on 2026-08-07 — captured from the live
-- catalogs (information_schema.columns, pg_constraint, pg_indexes,
-- pg_policies), not from memory. The running app must be indistinguishable
-- before/after the project flip, so nothing here is "improved": RLS is enabled
-- with the same anon select/insert/update policies (no delete — the app never
-- deletes), same defaults, same indexes.
--
-- The multi-tenant schema (schema.sql, WS2 of MULTI_TENANT_PLAN.md) lands as
-- ADDITIVE migrations on top of this baseline.

create table public.bito_briefs (
  company_key text not null,
  company text not null,
  intel jsonb not null,
  generated_at timestamp with time zone not null default now(),
  constraint bito_briefs_pkey primary key (company_key)
);

create table public.bito_directory (
  company_key text not null,
  company text not null,
  domain text,
  segment text,
  swe_estimate integer,
  short_brief text,
  employee_band text,
  estimated_employees integer,
  website_url text,
  linkedin_url text,
  strength integer default 0,
  source text default 'directory'::text,
  created_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  constraint bito_directory_pkey primary key (company_key)
);
create index bito_directory_segment_idx on public.bito_directory using btree (segment);
create index bito_directory_strength_idx on public.bito_directory using btree (strength desc);

create table public.bito_enriched_contacts (
  login text not null,
  name text,
  avatar_url text,
  github_url text,
  location text,
  company text,
  company_domain text,
  resolution_source text,
  status text not null default 'new'::text,
  suppressed_reason text,
  apollo_person_id text,
  email text,
  title text,
  seniority text,
  linkedin_url text,
  headcount integer,
  hubspot_contact_id text,
  hubspot_company_id text,
  score integer not null default 0,
  best_action text,
  best_repo text,
  signal_summary jsonb not null default '[]'::jsonb,
  opener text,
  last_signal_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint bito_enriched_contacts_pkey primary key (login)
);
create index bito_enriched_contacts_status_idx on public.bito_enriched_contacts using btree (status);
create index bito_enriched_contacts_score_idx on public.bito_enriched_contacts using btree (score desc);

create table public.bito_github_signals (
  id uuid not null default gen_random_uuid(),
  login text not null,
  repo_key text not null,
  action text not null,
  action_at timestamp with time zone not null,
  weight integer not null default 0,
  detail text,
  url text,
  created_at timestamp with time zone not null default now(),
  constraint bito_github_signals_pkey primary key (id),
  constraint bito_github_signals_login_repo_key_action_action_at_key unique (login, repo_key, action, action_at)
);
create index bito_github_signals_login_idx on public.bito_github_signals using btree (login);
create index bito_github_signals_repo_idx on public.bito_github_signals using btree (repo_key);

create table public.bito_monitored_repos (
  repo_key text not null,
  owner text not null,
  name text not null,
  category text not null default 'context-layer'::text,
  why_matters text not null default ''::text,
  active boolean not null default true,
  stars integer,
  poll_cursor jsonb not null default '{}'::jsonb,
  last_polled_at timestamp with time zone,
  added_at timestamp with time zone not null default now(),
  constraint bito_monitored_repos_pkey primary key (repo_key)
);

create table public.bito_signals (
  id uuid not null default gen_random_uuid(),
  account text not null,
  segment text not null,
  type text not null,
  strength integer not null,
  title text not null,
  description text not null default ''::text,
  tags jsonb not null default '[]'::jsonb,
  source text not null default ''::text,
  url text,
  event_date date,
  swe_estimate integer,
  codebase_hint text,
  created_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  region text not null default 'us'::text,
  constraint bito_signals_pkey primary key (id),
  constraint bito_signals_account_type_key unique (account, type),
  constraint bito_signals_strength_check check (((strength >= 0) and (strength <= 99)))
);
create index bito_signals_last_seen_idx on public.bito_signals using btree (last_seen_at desc);
create index bito_signals_region_seen_idx on public.bito_signals using btree (region, last_seen_at desc);

create table public.bito_state (
  store text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint bito_state_pkey primary key (store)
);

-- RLS: enabled on every table, with the same anon policies as the source
-- project (select/insert/update, never delete). These are replaced by real
-- per-user + authenticated policies in WS2 of the multi-tenant build.
do $$
declare t text;
begin
  foreach t in array array[
    'bito_briefs','bito_directory','bito_enriched_contacts','bito_github_signals',
    'bito_monitored_repos','bito_signals','bito_state'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to anon using (true)', t || '_anon_select', t);
    execute format('create policy %I on public.%I for insert to anon with check (true)', t || '_anon_insert', t);
    execute format('create policy %I on public.%I for update to anon using (true) with check (true)', t || '_anon_update', t);
  end loop;
end $$;
