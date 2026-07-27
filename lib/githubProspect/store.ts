// Thin PostgREST client for the GitHub prospecting tables:
//   public.bito_monitored_repos   — curated watchlist (~15-25 repos)
//   public.bito_github_signals    — one row per (person, repo, action, timestamp)
//   public.bito_enriched_contacts — resolved + enriched people for the dashboard
//
// Same contract as lib/supabase.ts: server-side only, never throws, and an
// unconfigured deployment degrades to { configured: false } results.

import { supabaseRestConfig } from "../supabase";
import {
  isGitHubAction,
  type GitHubAction,
  type GitHubSignalEvent,
  type MonitoredRepo,
  type Prospect,
  type ProspectSignal,
  type ProspectStatus,
} from "./types";

const TIMEOUT_MS = 10_000;

function headers(key: string, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// --------- Watchlist ---------

interface RepoRow {
  repo_key: string;
  owner: string;
  name: string;
  category: string;
  why_matters: string;
  active: boolean;
  stars: number | null;
  poll_cursor: unknown;
  last_polled_at: string | null;
}

function rowToRepo(r: RepoRow): MonitoredRepo {
  const cursor = (r.poll_cursor ?? {}) as Record<string, unknown>;
  const iso = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    repoKey: r.repo_key,
    owner: r.owner,
    name: r.name,
    category: r.category,
    whyMatters: r.why_matters,
    active: r.active,
    stars: r.stars ?? undefined,
    pollCursor: {
      starsAt: iso(cursor.starsAt),
      forksAt: iso(cursor.forksAt),
      commitsAt: iso(cursor.commitsAt),
      prsAt: iso(cursor.prsAt),
    },
    lastPolledAt: r.last_polled_at ?? undefined,
  };
}

export async function fetchMonitoredRepos(): Promise<{
  configured: boolean;
  ok: boolean;
  error?: string;
  repos: MonitoredRepo[];
}> {
  const cfg = supabaseRestConfig();
  if (!cfg) return { configured: false, ok: false, error: "Supabase not configured", repos: [] };
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_monitored_repos?select=*&order=last_polled_at.asc.nullsfirst`,
      {
        headers: headers(cfg.key),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { configured: true, ok: false, error: `Supabase repos read ${res.status}: ${detail}`, repos: [] };
    }
    const rows = (await res.json()) as RepoRow[];
    return { configured: true, ok: true, repos: rows.map(rowToRepo) };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: `Supabase repos read failed: ${e instanceof Error ? e.message : String(e)}`,
      repos: [],
    };
  }
}

/** Persist a repo's incremental cursor + metadata after a poll. Never throws. */
export async function updateRepoCursor(
  repoKey: string,
  fields: { pollCursor?: MonitoredRepo["pollCursor"]; stars?: number; active?: boolean },
): Promise<void> {
  const cfg = supabaseRestConfig();
  if (!cfg) return;
  const body: Record<string, unknown> = { last_polled_at: new Date().toISOString() };
  if (fields.pollCursor) body.poll_cursor = fields.pollCursor;
  if (typeof fields.stars === "number") body.stars = fields.stars;
  if (typeof fields.active === "boolean") body.active = fields.active;
  try {
    await fetch(
      `${cfg.url}/rest/v1/bito_monitored_repos?repo_key=eq.${encodeURIComponent(repoKey)}`,
      {
        method: "PATCH",
        headers: headers(cfg.key, { Prefer: "return=minimal" }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    /* non-fatal — the cursor just replays a little history next run */
  }
}

// --------- Raw signals ---------

/** Insert collected events; duplicates (same person/repo/action/timestamp) are
 * silently ignored so incremental runs stay idempotent. Never throws. */
export async function insertGitHubSignals(
  events: GitHubSignalEvent[],
): Promise<{ ok: boolean; error?: string }> {
  const cfg = supabaseRestConfig();
  if (!cfg) return { ok: false, error: "Supabase not configured" };
  if (events.length === 0) return { ok: true };
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_github_signals?on_conflict=login,repo_key,action,action_at`,
      {
        method: "POST",
        headers: headers(cfg.key, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
        body: JSON.stringify(
          events.map((e) => ({
            login: e.login,
            repo_key: e.repoKey,
            action: e.action,
            action_at: e.actionAt,
            weight: e.weight,
            detail: e.detail ?? null,
            url: e.url ?? null,
          })),
        ),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `Supabase signals insert ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `Supabase signals insert failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

interface SignalRow {
  login: string;
  repo_key: string;
  action: string;
  action_at: string;
  weight: number;
  detail: string | null;
  url: string | null;
}

/** All stored signal rows for a set of logins (for score re-aggregation).
 * Returns null when any read fails or truncates — callers must NOT overwrite
 * existing aggregates from a partial read. */
export async function fetchSignalsForLogins(
  logins: string[],
): Promise<GitHubSignalEvent[] | null> {
  const cfg = supabaseRestConfig();
  if (!cfg) return null;
  if (logins.length === 0) return [];
  const out: GitHubSignalEvent[] = [];
  const chunkRows = 1000;
  const maxOffset = 20_000; // hard backstop, far above any real per-chunk volume
  try {
    // PostgREST in-lists get unwieldy — chunk logins to keep URLs sane, and
    // page each chunk past the ~1000-row response cap so scores never
    // silently undercount.
    for (let i = 0; i < logins.length; i += 40) {
      const chunk = logins.slice(i, i + 40);
      const list = chunk.map((l) => `"${l.replace(/"/g, "")}"`).join(",");
      let drained = false;
      for (let offset = 0; offset < maxOffset; offset += chunkRows) {
        const res = await fetch(
          `${cfg.url}/rest/v1/bito_github_signals?select=*&login=in.(${encodeURIComponent(list)})&order=action_at.desc&limit=${chunkRows}&offset=${offset}`,
          {
            headers: headers(cfg.key),
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: "no-store",
          },
        );
        if (!res.ok) return null;
        const rows = (await res.json()) as SignalRow[];
        for (const r of rows) {
          if (!isGitHubAction(r.action)) continue;
          out.push({
            login: r.login,
            repoKey: r.repo_key,
            action: r.action,
            actionAt: r.action_at,
            weight: r.weight,
            detail: r.detail ?? undefined,
            url: r.url ?? undefined,
          });
        }
        if (rows.length < chunkRows) {
          drained = true;
          break;
        }
      }
      if (!drained) return null;
    }
    return out;
  } catch {
    return null;
  }
}

/** Exact row count in bito_github_signals (dashboard metric). */
export async function countGitHubSignals(): Promise<number> {
  const cfg = supabaseRestConfig();
  if (!cfg) return 0;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/bito_github_signals?select=id&limit=1`, {
      headers: headers(cfg.key, { Prefer: "count=exact" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const range = res.headers.get("content-range") ?? "";
    return Number(range.split("/")[1]) || 0;
  } catch {
    return 0;
  }
}

// --------- Prospects ---------

interface ProspectRow {
  login: string;
  name: string | null;
  avatar_url: string | null;
  github_url: string | null;
  location: string | null;
  company: string | null;
  company_domain: string | null;
  resolution_source: string | null;
  status: string;
  suppressed_reason: string | null;
  email: string | null;
  title: string | null;
  seniority: string | null;
  linkedin_url: string | null;
  headcount: number | null;
  hubspot_contact_id: string | null;
  hubspot_company_id: string | null;
  score: number;
  best_action: string | null;
  best_repo: string | null;
  signal_summary: unknown;
  opener: string | null;
  last_signal_at: string | null;
  updated_at: string;
}

const VALID_STATUSES: ProspectStatus[] = ["new", "resolved", "enriched", "no_match", "suppressed"];

function rowToProspect(r: ProspectRow): Prospect {
  const summary: ProspectSignal[] = Array.isArray(r.signal_summary)
    ? (r.signal_summary as unknown[])
        .map((s) => s as Record<string, unknown>)
        .filter((s) => typeof s.repo === "string" && isGitHubAction(s.action))
        .map((s) => ({
          repo: String(s.repo),
          action: s.action as GitHubAction,
          at: typeof s.at === "string" ? s.at : "",
          url: typeof s.url === "string" ? s.url : undefined,
        }))
    : [];
  return {
    login: r.login,
    name: r.name ?? undefined,
    avatarUrl: r.avatar_url ?? undefined,
    githubUrl: r.github_url ?? undefined,
    location: r.location ?? undefined,
    company: r.company ?? undefined,
    companyDomain: r.company_domain ?? undefined,
    resolutionSource: r.resolution_source ?? undefined,
    status: (VALID_STATUSES as string[]).includes(r.status) ? (r.status as ProspectStatus) : "new",
    suppressedReason: r.suppressed_reason ?? undefined,
    email: r.email ?? undefined,
    title: r.title ?? undefined,
    seniority: r.seniority ?? undefined,
    linkedinUrl: r.linkedin_url ?? undefined,
    headcount: r.headcount ?? undefined,
    hubspotContactId: r.hubspot_contact_id ?? undefined,
    hubspotCompanyId: r.hubspot_company_id ?? undefined,
    score: r.score,
    bestAction: isGitHubAction(r.best_action) ? r.best_action : undefined,
    bestRepo: r.best_repo ?? undefined,
    signals: summary,
    opener: r.opener ?? undefined,
    lastSignalAt: r.last_signal_at ?? undefined,
    updatedAt: r.updated_at,
  };
}

/** Fetch prospects, contribution-weighted first, paged through PostgREST's
 * ~1000-row cap up to `cap`. */
export async function fetchProspects(cap = 3000): Promise<{
  configured: boolean;
  ok: boolean;
  error?: string;
  prospects: Prospect[];
}> {
  const cfg = supabaseRestConfig();
  if (!cfg)
    return { configured: false, ok: false, error: "Supabase not configured", prospects: [] };
  const chunk = 1000;
  const all: Prospect[] = [];
  try {
    for (let offset = 0; offset < cap; offset += chunk) {
      const res = await fetch(
        `${cfg.url}/rest/v1/bito_enriched_contacts?select=*&order=score.desc,last_signal_at.desc.nullslast&limit=${chunk}&offset=${offset}`,
        {
          headers: headers(cfg.key),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        return {
          configured: true,
          ok: false,
          error: `Supabase prospects read ${res.status}: ${detail}`,
          prospects: [],
        };
      }
      const rows = (await res.json()) as ProspectRow[];
      all.push(...rows.map(rowToProspect));
      if (rows.length < chunk) break;
    }
    return { configured: true, ok: true, prospects: all };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: `Supabase prospects read failed: ${e instanceof Error ? e.message : String(e)}`,
      prospects: [],
    };
  }
}

/** Highest-score prospects awaiting a pipeline step (contributors first, so
 * merged-PR people always enrich before stargazers). */
/** Registrable root of a domain ("us.experian.com" → "experian.com") so a
 *  prospect on a regional subdomain still matches the directory's root entry. */
export function rootDomain(d: string): string {
  const parts = String(d || "").toLowerCase().trim().replace(/^www\./, "").split(".").filter(Boolean);
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

export interface DirectoryMatch {
  company: string;
  employees?: number;
  sweEstimate?: number;
  segment?: string;
}

/** Root-domain → Signal 2000 entry. Built from bito_directory so a GitHub
 *  prospect whose corporate domain matches a target account can be surfaced
 *  first — and sized for free, without an Apollo call. */
export async function fetchDirectoryDomainIndex(): Promise<Map<string, DirectoryMatch>> {
  const cfg = supabaseRestConfig();
  const index = new Map<string, DirectoryMatch>();
  if (!cfg) return index;
  try {
    // Only rows that HAVE a domain are useful here; ask PostgREST to filter so
    // we transfer ~half the table.
    for (let offset = 0; offset < 4000; offset += 1000) {
      const res = await fetch(
        `${cfg.url}/rest/v1/bito_directory?select=company,domain,estimated_employees,swe_estimate,segment` +
          `&domain=not.is.null&limit=1000&offset=${offset}`,
        { headers: headers(cfg.key), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" },
      );
      if (!res.ok) break;
      const rows = (await res.json()) as {
        company: string;
        domain: string | null;
        estimated_employees: number | null;
        swe_estimate: number | null;
        segment: string | null;
      }[];
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const r of rows) {
        if (!r.domain) continue;
        const key = rootDomain(r.domain);
        // First write wins — the directory is ordered by strength, so the more
        // significant company keeps the key if two share a root domain.
        if (key && !index.has(key)) {
          index.set(key, {
            company: r.company,
            employees: typeof r.estimated_employees === "number" ? r.estimated_employees : undefined,
            sweEstimate: typeof r.swe_estimate === "number" ? r.swe_estimate : undefined,
            segment: r.segment ?? undefined,
          });
        }
      }
      if (rows.length < 1000) break;
    }
  } catch {
    // Index is an enhancement — an empty map just means no boosting this run.
  }
  return index;
}

/** People suppressed ONLY for company size who now clear `floor` — the set to
 *  re-queue when the size bar drops (e.g. an enterprise → mid-market pivot).
 *  Matched on the size reason prefix so HubSpot-dedupe and active-sequence
 *  suppressions are never resurrected by a threshold change. */
export async function fetchSizeSuppressedAbove(
  floor: number,
  limit: number,
): Promise<Prospect[]> {
  const cfg = supabaseRestConfig();
  if (!cfg) return [];
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_enriched_contacts?select=*&status=eq.suppressed&headcount=gte.${floor}` +
        `&suppressed_reason=like.${encodeURIComponent("Company size*")}` +
        `&order=score.desc,last_signal_at.desc.nullslast&limit=${limit}`,
      {
        headers: headers(cfg.key),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as ProspectRow[];
    return rows.map(rowToProspect);
  } catch {
    return [];
  }
}

export async function fetchProspectsByStatus(
  statuses: ProspectStatus[],
  limit: number,
): Promise<Prospect[]> {
  const cfg = supabaseRestConfig();
  if (!cfg || statuses.length === 0) return [];
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_enriched_contacts?select=*&status=in.(${statuses.join(",")})&order=score.desc,last_signal_at.desc.nullslast&limit=${limit}`,
      {
        headers: headers(cfg.key),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as ProspectRow[];
    return rows.map(rowToProspect);
  } catch {
    return [];
  }
}

/** Upsert per-login signal aggregates. Only aggregate columns are written, so
 * enrichment fields on existing rows survive; brand-new rows get status "new"
 * from the column default. Never throws. */
export async function upsertProspectAggregates(
  aggregates: {
    login: string;
    score: number;
    bestAction: GitHubAction;
    bestRepo: string;
    signals: ProspectSignal[];
    lastSignalAt: string;
  }[],
): Promise<{ ok: boolean; error?: string }> {
  const cfg = supabaseRestConfig();
  if (!cfg) return { ok: false, error: "Supabase not configured" };
  if (aggregates.length === 0) return { ok: true };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/bito_enriched_contacts?on_conflict=login`, {
      method: "POST",
      headers: headers(cfg.key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(
        aggregates.map((a) => ({
          login: a.login,
          github_url: `https://github.com/${a.login}`,
          score: a.score,
          best_action: a.bestAction,
          best_repo: a.bestRepo,
          signal_summary: a.signals,
          last_signal_at: a.lastSignalAt,
          updated_at: new Date().toISOString(),
        })),
      ),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `Supabase aggregate upsert ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `Supabase aggregate upsert failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Patch one prospect's pipeline fields (resolution / enrichment / opener). */
export async function updateProspect(
  login: string,
  fields: Partial<{
    name: string;
    avatarUrl: string;
    githubUrl: string;
    location: string;
    company: string;
    companyDomain: string;
    resolutionSource: string;
    status: ProspectStatus;
    suppressedReason: string;
    email: string;
    title: string;
    seniority: string;
    linkedinUrl: string;
    headcount: number;
    hubspotContactId: string;
    hubspotCompanyId: string;
    opener: string;
  }>,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = supabaseRestConfig();
  if (!cfg) return { ok: false, error: "Supabase not configured" };
  const map: Record<string, string> = {
    name: "name",
    avatarUrl: "avatar_url",
    githubUrl: "github_url",
    location: "location",
    company: "company",
    companyDomain: "company_domain",
    resolutionSource: "resolution_source",
    status: "status",
    suppressedReason: "suppressed_reason",
    email: "email",
    title: "title",
    seniority: "seniority",
    linkedinUrl: "linkedin_url",
    headcount: "headcount",
    hubspotContactId: "hubspot_contact_id",
    hubspotCompanyId: "hubspot_company_id",
    opener: "opener",
  };
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && map[k]) body[map[k]] = v;
  }
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_enriched_contacts?login=eq.${encodeURIComponent(login)}`,
      {
        method: "PATCH",
        headers: headers(cfg.key, { Prefer: "return=minimal" }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `Supabase prospect update ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `Supabase prospect update failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
