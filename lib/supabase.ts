// Thin PostgREST client for the signal cache (public.bito_signals).
//
// One row per (account, type): scans upsert with merge-duplicates so repeat
// sightings refresh title/strength/last_seen_at while history accumulates.
// Server-side only — the anon key never ships to the browser.
//
// Unconfigured deployments degrade gracefully: callers get configured:false
// and the feed falls back to ephemeral (scan-only) mode.

import type { CompanyIntel, DirectoryEntry, Signal, SegmentId, SignalTypeId } from "./types";
import type { RegionId } from "./data";

const TIMEOUT_MS = 10_000;

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function supabaseConfigured(): boolean {
  return config() !== null;
}

interface SignalRow {
  id: string;
  account: string;
  segment: string;
  type: string;
  strength: number;
  title: string;
  description: string;
  tags: unknown;
  source: string;
  url: string | null;
  event_date: string | null;
  swe_estimate: number | null;
  codebase_hint: string | null;
  created_at: string;
  last_seen_at: string;
}

function rowToSignal(r: SignalRow): Signal {
  return {
    id: r.id,
    account: r.account,
    segment: r.segment as SegmentId,
    type: r.type as SignalTypeId,
    strength: r.strength,
    title: r.title,
    description: r.description,
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    source: r.source,
    url: r.url ?? undefined,
    date: r.event_date ?? r.created_at.slice(0, 10),
    sweEstimate: r.swe_estimate ?? undefined,
    codebaseHint: r.codebase_hint ?? undefined,
  };
}

function signalToRow(
  s: Signal,
  region: RegionId,
): Omit<SignalRow, "id" | "created_at"> & { region: RegionId } {
  return {
    region,
    account: s.account,
    segment: s.segment,
    type: s.type,
    strength: s.strength,
    title: s.title,
    description: s.description,
    tags: s.tags,
    source: s.source,
    url: s.url ?? null,
    event_date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : null,
    swe_estimate: s.sweEstimate ?? null,
    codebase_hint: s.codebaseHint ?? null,
    last_seen_at: new Date().toISOString(),
  };
}

/** Upsert scan results; merge on (account, type). Never throws. */
export async function upsertSignals(
  signals: Signal[],
  region: RegionId,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "Supabase not configured" };
  if (signals.length === 0) return { ok: true };

  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_signals?on_conflict=account,type`,
      {
        method: "POST",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(signals.map((s) => signalToRow(s, region))),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `Supabase upsert ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `Supabase upsert failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Persist enriched fields (title/description/url) onto the cached signal
 * row(s) so they show on reload without re-fetching. Scoped to (account, type);
 * never throws. Used by the company-blurb and company-signal enrichment. */
export async function updateSignalRow(
  account: string,
  type: SignalTypeId,
  fields: { title?: string; description?: string; url?: string },
): Promise<void> {
  const cfg = config();
  if (!cfg || !account) return;
  const body: Record<string, string> = {};
  if (fields.title) body.title = fields.title;
  if (fields.description) body.description = fields.description;
  if (fields.url) body.url = fields.url;
  if (Object.keys(body).length === 0) return;
  try {
    await fetch(
      `${cfg.url}/rest/v1/bito_signals?account=eq.${encodeURIComponent(account)}&type=eq.${encodeURIComponent(type)}`,
      {
        method: "PATCH",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    /* non-fatal — the value still returns to the client and caches there */
  }
}

/** Most recently seen account names for one signal type — used to tell the
 * model which companies we already track so each pull hunts NEW ones. */
export async function fetchRecentAccounts(
  type: SignalTypeId,
  region: RegionId,
  limit = 60,
): Promise<string[]> {
  const cfg = config();
  if (!cfg) return [];
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_signals?select=account&type=eq.${encodeURIComponent(type)}&region=eq.${region}&order=last_seen_at.desc&limit=${limit}`,
      {
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as { account: string }[];
    return rows.map((r) => r.account);
  } catch {
    return [];
  }
}

/** Exact row count for one signal type — drives Apollo sweep page rotation. */
export async function countSignalsByType(
  type: SignalTypeId,
  region: RegionId,
): Promise<number> {
  const cfg = config();
  if (!cfg) return 0;
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_signals?select=id&type=eq.${encodeURIComponent(type)}&region=eq.${region}&limit=1`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          Prefer: "count=exact",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) return 0;
    const range = res.headers.get("content-range") ?? "";
    return Number(range.split("/")[1]) || 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Intel-brief cache (public.bito_briefs) — one row per company. A generated
// brief persists until the user clicks "Update brief".
// ---------------------------------------------------------------------------

const briefKey = (company: string) => company.trim().toLowerCase();

export async function fetchBrief(company: string): Promise<CompanyIntel | null> {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_briefs?select=intel&company_key=eq.${encodeURIComponent(briefKey(company))}&limit=1`,
      {
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { intel: CompanyIntel }[];
    return rows[0]?.intel ?? null;
  } catch {
    return null;
  }
}

export async function upsertBrief(
  company: string,
  intel: CompanyIntel,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "Supabase not configured" };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/bito_briefs?on_conflict=company_key`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        {
          company_key: briefKey(company),
          company: company.trim(),
          intel,
          generated_at: new Date().toISOString(),
        },
      ]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `Supabase brief upsert ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `Supabase brief upsert failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Cross-device user state (public.bito_state) — one row per client store
// (the localStorage key). Single-user, no auth: a shared document set that
// every device reads on load and writes on change. Never throws.
// ---------------------------------------------------------------------------

/** Fetch all stored state rows as a { store: value } map. */
export async function fetchState(): Promise<{
  configured: boolean;
  ok: boolean;
  state: Record<string, unknown>;
}> {
  const cfg = config();
  if (!cfg) return { configured: false, ok: false, state: {} };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/bito_state?select=store,value`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { configured: true, ok: false, state: {} };
    const rows = (await res.json()) as { store: string; value: unknown }[];
    const state: Record<string, unknown> = {};
    for (const r of rows) state[r.store] = r.value;
    return { configured: true, ok: true, state };
  } catch {
    return { configured: true, ok: false, state: {} };
  }
}

/** Upsert one store's value (merge on `store`). */
export async function upsertState(
  store: string,
  value: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "Supabase not configured" };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/bito_state?on_conflict=store`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{ store, value, updated_at: new Date().toISOString() }]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `Supabase state upsert ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Supabase state upsert failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Signal 2000 directory (public.bito_directory) — one row per company, the
// standing prospecting universe. Short brief pre-populated; full brief on demand.
// ---------------------------------------------------------------------------

interface DirectoryRow {
  company_key: string;
  company: string;
  domain: string | null;
  segment: string | null;
  swe_estimate: number | null;
  short_brief: string | null;
  employee_band: string | null;
  estimated_employees: number | null;
  website_url: string | null;
  linkedin_url: string | null;
  strength: number | null;
  source: string | null;
}

function rowToDirectory(r: DirectoryRow): DirectoryEntry {
  return {
    companyKey: r.company_key,
    company: r.company,
    domain: r.domain ?? undefined,
    segment: (r.segment as SegmentId) || "enterprise",
    sweEstimate: r.swe_estimate ?? undefined,
    shortBrief: r.short_brief ?? "",
    employeeBand: r.employee_band ?? undefined,
    estimatedEmployees: r.estimated_employees ?? undefined,
    websiteUrl: r.website_url ?? undefined,
    linkedinUrl: r.linkedin_url ?? undefined,
    strength: r.strength ?? 0,
    source: r.source ?? "directory",
  };
}

/** Upsert directory rows, merging on company_key. Never throws. */
export async function upsertDirectory(
  entries: DirectoryEntry[],
): Promise<{ ok: boolean; error?: string }> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "Supabase not configured" };
  if (entries.length === 0) return { ok: true };
  const rows = entries.map((e) => ({
    company_key: e.companyKey,
    company: e.company,
    domain: e.domain ?? null,
    segment: e.segment,
    swe_estimate: e.sweEstimate ?? null,
    short_brief: e.shortBrief || null,
    employee_band: e.employeeBand ?? null,
    estimated_employees: e.estimatedEmployees ?? null,
    website_url: e.websiteUrl ?? null,
    linkedin_url: e.linkedinUrl ?? null,
    strength: e.strength,
    source: e.source,
    last_seen_at: new Date().toISOString(),
  }));
  try {
    const res = await fetch(`${cfg.url}/rest/v1/bito_directory?on_conflict=company_key`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `Supabase directory upsert ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Supabase directory upsert failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Fetch the whole directory (strongest-fit first), paged through PostgREST's
 * ~1000-row cap up to `cap`. */
export async function fetchDirectory(
  cap = 2500,
): Promise<{ configured: boolean; ok: boolean; error?: string; entries: DirectoryEntry[]; total: number }> {
  const cfg = config();
  if (!cfg) return { configured: false, ok: false, error: "Supabase not configured", entries: [], total: 0 };
  const chunk = 1000;
  const all: DirectoryEntry[] = [];
  let total = 0;
  try {
    for (let offset = 0; offset < cap; offset += chunk) {
      const res = await fetch(
        `${cfg.url}/rest/v1/bito_directory?select=*&order=strength.desc,company.asc&limit=${chunk}&offset=${offset}`,
        {
          headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Prefer: "count=exact" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        return { configured: true, ok: false, error: `Supabase directory read ${res.status}: ${detail}`, entries: [], total: 0 };
      }
      const rows = (await res.json()) as DirectoryRow[];
      const range = res.headers.get("content-range") ?? "";
      total = Number(range.split("/")[1]) || total || all.length + rows.length;
      all.push(...rows.map(rowToDirectory));
      if (rows.length < chunk) break;
    }
    return { configured: true, ok: true, entries: all, total };
  } catch (e) {
    return { configured: true, ok: false, error: `Supabase directory read failed: ${e instanceof Error ? e.message : String(e)}`, entries: [], total: 0 };
  }
}

/** Exact directory row count (for the empty-state / populate UI). */
export async function countDirectory(): Promise<number> {
  const cfg = config();
  if (!cfg) return 0;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/bito_directory?select=company_key&limit=1`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Prefer: "count=exact" },
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

export interface SignalPage {
  configured: boolean;
  ok: boolean;
  error?: string;
  signals: Signal[];
  total: number;
  /** True when the cache exceeded `cap` and only the most-recent rows loaded. */
  capped?: boolean;
}

/**
 * Fetch the whole cache for a region (newest-seen first), so the client can
 * sort/filter/paginate GLOBALLY rather than per server page. PostgREST caps a
 * single response at ~1000 rows, so we page through in chunks up to `cap`.
 */
export async function fetchAllSignals(region: RegionId, cap = 5000): Promise<SignalPage> {
  const cfg = config();
  if (!cfg) {
    return { configured: false, ok: false, error: "Supabase not configured", signals: [], total: 0 };
  }
  const chunk = 1000;
  const all: Signal[] = [];
  let total = 0;
  try {
    for (let offset = 0; offset < cap; offset += chunk) {
      const res = await fetch(
        `${cfg.url}/rest/v1/bito_signals?select=*&region=eq.${region}&order=last_seen_at.desc,strength.desc&limit=${chunk}&offset=${offset}`,
        {
          headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Prefer: "count=exact" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        return { configured: true, ok: false, error: `Supabase read ${res.status}: ${detail}`, signals: [], total: 0 };
      }
      const rows = (await res.json()) as SignalRow[];
      const range = res.headers.get("content-range") ?? "";
      total = Number(range.split("/")[1]) || total || all.length + rows.length;
      all.push(...rows.map(rowToSignal));
      if (rows.length < chunk) break; // reached the end
    }
    return { configured: true, ok: true, signals: all, total, capped: total > all.length };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: `Supabase read failed: ${e instanceof Error ? e.message : String(e)}`,
      signals: [],
      total: 0,
    };
  }
}

/** Fetch one page of cached signals, newest-seen first, with an exact total. */
export async function fetchSignalPage(
  page: number,
  pageSize: number,
  region: RegionId,
): Promise<SignalPage> {
  const cfg = config();
  if (!cfg) {
    return { configured: false, ok: false, error: "Supabase not configured", signals: [], total: 0 };
  }

  const p = Math.max(1, Math.floor(page));
  const size = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const from = (p - 1) * size;

  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/bito_signals?select=*&region=eq.${region}&order=last_seen_at.desc,strength.desc&limit=${size}&offset=${from}`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          Prefer: "count=exact",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return {
        configured: true,
        ok: false,
        error: `Supabase read ${res.status}: ${detail}`,
        signals: [],
        total: 0,
      };
    }
    const rows = (await res.json()) as SignalRow[];
    // Content-Range: "0-49/137" — the slash-suffix is the exact total.
    const range = res.headers.get("content-range") ?? "";
    const total = Number(range.split("/")[1]) || rows.length;
    return {
      configured: true,
      ok: true,
      signals: rows.map(rowToSignal),
      total,
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: `Supabase read failed: ${e instanceof Error ? e.message : String(e)}`,
      signals: [],
      total: 0,
    };
  }
}
