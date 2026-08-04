"use client";

// Small client-only stores backed by localStorage, shared across components via
// useSyncExternalStore. Two concerns:
//   - prospected: companies/contacts the rep has pushed to HubSpot (a task was
//     created). Used to badge them as "Prospected" everywhere.
//   - deepDiveScores: the authoritative ICP total from a generated brief, keyed
//     by company. Lets the signal cards show the real score (not the rougher
//     per-signal estimate) once a brief has been opened.

import { useSyncExternalStore } from "react";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

// Company names arrive from two sources that spell the SAME company differently:
// the Apollo sweep ("Instabug") and the live-research brief ("Instabug, Inc.").
// Strip punctuation + common legal suffixes so prospected badges and cached
// scores match across both. Applied on read AND write so values stored under
// the old (lowercase-only) rule still resolve.
const COMPANY_SUFFIX =
  /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|gmbh|plc|sa|ag|nv|bv|pte|pvt|private|holdings)\b/g;
function normCompany(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(COMPANY_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------- Cross-device sync ----------------
// Each makeStore registers here so the sync layer can hydrate it from Supabase
// (via /api/state) on load and push changes back — so prospecting from a phone
// and a desktop share the same state. Single-user, no auth.
type SyncEntry = { applyServer: (raw: unknown) => void; current: () => unknown };
const registry = new Map<string, SyncEntry>();
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Debounced upsert of one store's value to the server.
function schedulePush(key: string) {
  if (typeof window === "undefined") return;
  const prev = pushTimers.get(key);
  if (prev) clearTimeout(prev);
  pushTimers.set(
    key,
    setTimeout(() => {
      pushTimers.delete(key);
      const entry = registry.get(key);
      if (!entry) return;
      void fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: key, value: entry.current() }),
      }).catch(() => {});
    }, 700),
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
// Union-merge, used ONCE on first sync so neither device loses pre-existing
// local data. On a key conflict the server (latest) value wins.
function deepMerge(local: unknown, server: unknown): unknown {
  if (isPlainObject(local) && isPlainObject(server)) {
    const out: Record<string, unknown> = { ...local };
    for (const [k, v] of Object.entries(server)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
  }
  return server ?? local;
}

let pulling = false;
// Replace local stores with the server's values (server authoritative). Runs on
// tab focus so a change made on another device shows up here (and deletions —
// unmark / reset — propagate, which a union-merge can't do).
async function pullState() {
  if (typeof window === "undefined" || pulling) return;
  pulling = true;
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { state?: Record<string, unknown> };
    if (!data?.state) return;
    for (const [k, v] of Object.entries(data.state)) registry.get(k)?.applyServer(v);
  } catch {
    /* offline — keep local */
  } finally {
    pulling = false;
  }
}

let synced = false;
/** Start cross-device sync: union-merge with the server once (so nothing is
 * lost on first run), push the merged result up, then re-pull on tab focus.
 * Idempotent — safe to call from a mount effect. */
export function initStateSync() {
  if (synced || typeof window === "undefined") return;
  synced = true;
  void (async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const data = res.ok ? ((await res.json()) as { state?: Record<string, unknown> }) : null;
      const server = data?.state ?? {};
      for (const [key, entry] of registry) {
        const serverVal = server[key];
        if (serverVal === undefined) {
          schedulePush(key); // nothing on the server yet → seed from this device
        } else {
          entry.applyServer(deepMerge(entry.current(), serverVal));
          schedulePush(key); // push the union back up
        }
      }
    } catch {
      /* offline — stay local-only */
    }
  })();
  const onFocus = () => {
    if (!document.hidden) void pullState();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
}

// Generic localStorage-backed store with a stable snapshot reference. An
// optional `coerce` migrates whatever shape is on disk into the current one.
// Every store also registers for cross-device sync (see above).
//
// KEY VERSION: bumping this orphans ALL prior state everywhere at once — old
// localStorage keys are never read again and old bito_state rows never match
// the registry, so a factory reset sticks without a per-device manual clear.
// (A plain server wipe would NOT stick: the load-time union-merge would push
// each device's localStorage right back up.) v2 = 2026-07-16 full reset.
const KEY_VERSION = ".v2";

function makeStore<T>(baseKey: string, empty: T, coerce?: (raw: unknown) => T) {
  const key = `${baseKey}${KEY_VERSION}`;
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  function get(): T {
    if (cache === null) {
      try {
        const raw = JSON.parse(localStorage.getItem(key) || "null");
        cache = coerce ? coerce(raw) : ((raw as T) ?? empty);
      } catch {
        cache = empty;
      }
    }
    return cache;
  }
  // Update local cache + localStorage + subscribers, WITHOUT echoing to the server.
  function commit(next: T) {
    cache = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode / quota — in-memory only */
    }
    listeners.forEach((l) => l());
  }
  function set(next: T) {
    commit(next);
    schedulePush(key);
  }
  function subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }
  function useStore(): T {
    return useSyncExternalStore(subscribe, get, () => empty);
  }
  // Register for cross-device sync. applyServer writes server data in locally
  // without scheduling a push back (no echo loop).
  registry.set(key, {
    applyServer: (raw) => commit(coerce ? coerce(raw) : ((raw as T) ?? empty)),
    current: () => get(),
  });
  return { get, set, useStore };
}

// ---------------- Prospected ----------------
// Each entry maps a normalized key -> epoch-ms timestamp of when it was sent to
// HubSpot. 0 means "prospected, date unknown" (a legacy entry stored before we
// tracked dates).
type DateMap = Record<string, number>;
type Prospected = { companies: DateMap; contacts: DateMap };

// Coerce the on-disk value into the date-map shape. Older builds stored plain
// string arrays (no dates) — migrate those to timestamp 0.
function asDateMap(raw: unknown): DateMap {
  const out: DateMap = {};
  if (Array.isArray(raw)) {
    for (const k of raw) if (typeof k === "string") out[k] = 0;
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = typeof v === "number" && v > 0 ? v : 0;
    }
  }
  return out;
}

const prospected = makeStore<Prospected>(
  "bito-prospected",
  { companies: {}, contacts: {} },
  (raw) => {
    const r = (raw ?? {}) as { companies?: unknown; contacts?: unknown };
    return { companies: asDateMap(r.companies), contacts: asDateMap(r.contacts) };
  },
);

const normFor = (kind: "company" | "contact", v: string) =>
  kind === "company" ? normCompany(v) : norm(v);

// Find the actual stored key that matches `key` under this kind's normalization.
function matchingKey(map: DateMap, kind: "company" | "contact", key: string): string | undefined {
  const target = normFor(kind, key);
  return Object.keys(map).find((v) => normFor(kind, v) === target);
}

export function markProspected(kind: "company" | "contact", key: string): void {
  if (!key) return;
  const cur = prospected.get();
  const field = kind === "company" ? "companies" : "contacts";
  // Already prospected → keep the original date, don't overwrite it.
  if (matchingKey(cur[field], kind, key)) return;
  const k = normFor(kind, key);
  prospected.set({ ...cur, [field]: { ...cur[field], [k]: Date.now() } });
}

export function unmarkProspected(kind: "company" | "contact", key: string): void {
  if (!key) return;
  const cur = prospected.get();
  const field = kind === "company" ? "companies" : "contacts";
  const k = matchingKey(cur[field], kind, key);
  if (!k) return;
  const next = { ...cur[field] };
  delete next[k];
  prospected.set({ ...cur, [field]: next });
}

/** Wipe every prospected mark (companies + contacts). Used to clear marks left
 * behind by the old buggy "check" that stamped records it merely found. */
export function clearAllProspected(): void {
  prospected.set({ companies: {}, contacts: {} });
}

/** Total number of prospected marks currently stored, across companies + contacts. */
export function useProspectedCount(): number {
  const s = prospected.useStore();
  return Object.keys(s.companies).length + Object.keys(s.contacts).length;
}

export function useIsProspected(kind: "company" | "contact", key: string): boolean {
  const s = prospected.useStore();
  if (!key) return false;
  return matchingKey(kind === "company" ? s.companies : s.contacts, kind, key) !== undefined;
}

/** Epoch-ms when this was sent to HubSpot, or undefined if not prospected / date unknown. */
export function useProspectedAt(kind: "company" | "contact", key: string): number | undefined {
  const s = prospected.useStore();
  if (!key) return undefined;
  const map = kind === "company" ? s.companies : s.contacts;
  const k = matchingKey(map, kind, key);
  const ts = k ? map[k] : 0;
  return ts && ts > 0 ? ts : undefined;
}

// ---------------- Deep-dive ICP scores ----------------
type Scores = Record<string, number>;
const scores = makeStore<Scores>("bito-deepdive-scores", {});

export function setDeepDiveScore(company: string, score: number): void {
  if (!company) return;
  const cur = scores.get();
  const k = normCompany(company);
  if (cur[k] === score) return;
  scores.set({ ...cur, [k]: score });
}

export function useDeepDiveScore(company: string): number | undefined {
  const s = scores.useStore();
  if (!company) return undefined;
  const target = normCompany(company);
  // Match across normalization so a card ("Instabug") finds a brief score
  // stored under its canonical name ("Instabug, Inc.").
  for (const [k, v] of Object.entries(s)) {
    if (normCompany(k) === target) return v;
  }
  return undefined;
}

// ---------------- Low priority (minimized cards) ----------------
// Companies the rep has minimized on the feed — collapsed to just the name so
// they're out of the way without being hidden. Keyed by normalized company.
type LowPriority = Record<string, number>;
const lowPriority = makeStore<LowPriority>("bito-lowpriority", {}, (raw) => {
  const out: LowPriority = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const k of Object.keys(raw as Record<string, unknown>)) out[normCompany(k)] = 1;
  }
  return out;
});

export function toggleLowPriority(company: string): void {
  if (!company) return;
  const cur = lowPriority.get();
  const target = normCompany(company);
  const existing = Object.keys(cur).find((k) => normCompany(k) === target);
  if (existing) {
    const next = { ...cur };
    delete next[existing];
    lowPriority.set(next);
  } else {
    lowPriority.set({ ...cur, [target]: 1 });
  }
}

export function useIsLowPriority(company: string): boolean {
  const s = lowPriority.useStore();
  if (!company) return false;
  const target = normCompany(company);
  return Object.keys(s).some((k) => normCompany(k) === target);
}

// ---------------- Collapsed (minimized, but NOT deprioritized) ----------------
// A plain visual collapse: the card shrinks to a slim row but KEEPS its place in
// the sort. (Low-priority also collapses, but additionally sinks to the bottom.)
type Collapsed = Record<string, number>;
const collapsed = makeStore<Collapsed>("bito-collapsed", {}, (raw) => {
  const out: Collapsed = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const k of Object.keys(raw as Record<string, unknown>)) out[normCompany(k)] = 1;
  }
  return out;
});

export function collapseCard(company: string): void {
  if (!company) return;
  const cur = collapsed.get();
  const target = normCompany(company);
  if (Object.keys(cur).some((k) => normCompany(k) === target)) return;
  collapsed.set({ ...cur, [target]: 1 });
}

export function useIsCollapsed(company: string): boolean {
  const s = collapsed.useStore();
  if (!company) return false;
  const target = normCompany(company);
  return Object.keys(s).some((k) => normCompany(k) === target);
}

// Restore a card to full size, clearing BOTH collapse and low-priority state.
export function restoreCard(company: string): void {
  if (!company) return;
  const target = normCompany(company);
  const clear = (store: { get: () => Record<string, number>; set: (v: Record<string, number>) => void }) => {
    const cur = store.get();
    const k = Object.keys(cur).find((kk) => normCompany(kk) === target);
    if (k) {
      const next = { ...cur };
      delete next[k];
      store.set(next);
    }
  };
  clear(collapsed);
  clear(lowPriority);
}

// ---------------- Bulk lookups (for sorting the whole feed) ----------------
// Hooks return the raw store map (stable reference between writes, so they're
// safe useMemo deps). The pure helpers do normalized membership/value lookups
// against those maps — used to sort a list without one hook per row.
export function useDeepDiveScores(): Record<string, number> {
  return scores.useStore();
}
export function useProspectedCompanies(): Record<string, number> {
  return prospected.useStore().companies;
}
export function useLowPriorityCompanies(): Record<string, number> {
  return lowPriority.useStore();
}

export function companyInMap(map: Record<string, unknown>, company: string): boolean {
  if (!company) return false;
  const target = normCompany(company);
  for (const k in map) if (normCompany(k) === target) return true;
  return false;
}
export function companyValue(map: Record<string, number>, company: string): number | undefined {
  if (!company) return undefined;
  const target = normCompany(company);
  for (const k in map) if (normCompany(k) === target) return map[k];
  return undefined;
}

// ---------------- HubSpot live presence ----------------
// Filled by the card's HubSpot auto-check: 1 = found in HubSpot, 0 = checked &
// not found, absent = not checked yet. Lets the feed sort by the LIVE result
// (not just the local prospected flag). Re-checks on each card mount keep it
// fresh, so persisting it only avoids a flash on reload.
type Presence = Record<string, number>;
const hubspotPresence = makeStore<Presence>("bito-hs-presence", {});

export function setHubspotPresence(company: string, found: boolean): void {
  if (!company) return;
  const cur = hubspotPresence.get();
  const k = normCompany(company);
  const v = found ? 1 : 0;
  if (cur[k] === v) return;
  hubspotPresence.set({ ...cur, [k]: v });
}

export function useHubspotPresence(): Record<string, number> {
  return hubspotPresence.useStore();
}

// ---------------- Blacklist (not-a-fit) ----------------
// Companies the rep marked as not a fit (e.g. an OSS project, not a buyer).
// Hidden from the feed entirely and kept hidden across pulls. Stores the display
// name (value) keyed by normalized name (key) for a restore list.
const blacklist = makeStore<Record<string, string>>("bito-blacklist", {});

export function toggleBlacklist(company: string): void {
  if (!company) return;
  const cur = blacklist.get();
  const k = normCompany(company);
  if (cur[k] !== undefined) {
    const next = { ...cur };
    delete next[k];
    blacklist.set(next);
  } else {
    blacklist.set({ ...cur, [k]: company });
  }
}

export function removeFromBlacklist(company: string): void {
  if (!company) return;
  const cur = blacklist.get();
  const k = normCompany(company);
  if (cur[k] === undefined) return;
  const next = { ...cur };
  delete next[k];
  blacklist.set(next);
}

export function useIsBlacklisted(company: string): boolean {
  const s = blacklist.useStore();
  return company ? companyInMap(s, company) : false;
}

export function useBlacklist(): Record<string, string> {
  return blacklist.useStore();
}

// ---------------- Reviewed ----------------
// Companies the rep has triaged. Auto-set when a brief is opened, and toggleable
// per card — drives the "reviewed / not reviewed" filter so you can work through
// the feed without re-covering the same accounts.
const reviewed = makeStore<Record<string, number>>("bito-reviewed", {});

export function markReviewed(company: string): void {
  if (!company) return;
  const cur = reviewed.get();
  const k = normCompany(company);
  if (Object.keys(cur).some((kk) => normCompany(kk) === k)) return;
  reviewed.set({ ...cur, [k]: 1 });
}

export function toggleReviewed(company: string): void {
  if (!company) return;
  const cur = reviewed.get();
  const k = normCompany(company);
  const existing = Object.keys(cur).find((kk) => normCompany(kk) === k);
  if (existing) {
    const next = { ...cur };
    delete next[existing];
    reviewed.set(next);
  } else {
    reviewed.set({ ...cur, [k]: 1 });
  }
}

export function useIsReviewed(company: string): boolean {
  const s = reviewed.useStore();
  return company ? companyInMap(s, company) : false;
}

export function useReviewedCompanies(): Record<string, number> {
  return reviewed.useStore();
}

// ---------------- Favorites ----------------
// Companies the rep starred for quick access ("hot caching"). Surfaced in the
// dedicated "Signal favorites" tab. Stores display name keyed by normalized name.
const favorites = makeStore<Record<string, string>>("bito-favorites", {});

export function toggleFavorite(company: string): void {
  if (!company) return;
  const cur = favorites.get();
  const k = normCompany(company);
  if (cur[k] !== undefined) {
    const next = { ...cur };
    delete next[k];
    favorites.set(next);
  } else {
    favorites.set({ ...cur, [k]: company });
  }
}

export function useIsFavorite(company: string): boolean {
  const s = favorites.useStore();
  return company ? companyInMap(s, company) : false;
}

export function useFavorites(): Record<string, string> {
  return favorites.useStore();
}

// ---------------- Last task due date ----------------
// Remembers the due date last picked in a HubSpot task, so scheduling across
// several contacts stays on that date instead of resetting each time.
const lastDue = makeStore<{ date?: string }>("bito-last-due", {});

export function getLastDueDate(): string | undefined {
  return lastDue.get().date;
}

export function setLastDueDate(date: string): void {
  if (date) lastDue.set({ date });
}

// ---------------- Apollo sweep cursor ----------------
// The page the next Apollo ICP sweep should fetch, per region. Persisted so the
// cursor marches forward across pulls instead of restarting (which would
// re-fetch page 1 and return only duplicates).
const sweepCursor = makeStore<Record<string, number>>("bito-sweep-cursor", {});

export function getSweepPage(region: string): number | undefined {
  const v = sweepCursor.get()[region];
  return typeof v === "number" && v >= 1 ? v : undefined;
}

export function setSweepPage(region: string, page: number): void {
  if (!region || !(page >= 1)) return;
  sweepCursor.set({ ...sweepCursor.get(), [region]: Math.min(100, Math.floor(page)) });
}

// ---------------- Company blurb cache ----------------
// Caches the generated "what the company does" blurb per company so a card that
// already fetched one doesn't re-fetch (Apollo/web) on re-render or re-page.
const companyBlurbs = makeStore<Record<string, string>>("bito-company-blurbs", {});

export function getCompanyBlurb(company: string): string | undefined {
  if (!company) return undefined;
  const s = companyBlurbs.get();
  const target = normCompany(company);
  for (const [k, v] of Object.entries(s)) if (normCompany(k) === target) return v;
  return undefined;
}

export function setCompanyBlurb(company: string, blurb: string): void {
  if (!company || !blurb) return;
  const cur = companyBlurbs.get();
  companyBlurbs.set({ ...cur, [normCompany(company)]: blurb });
}

// ---------------- Apollo reveal cache ----------------
// Caches revealed email/phone/name per Apollo person id so the auto-reveal on a
// stakeholder card doesn't re-spend a credit every time a brief is reopened.
export type ApolloReveal = {
  name?: string;
  email?: string;
  emailStatus?: string;
  phone?: string;
  country?: string;
  /** The real profile URL. people/match returns it; the people SEARCH usually
   *  does not, which is why task notes read "PROFILE: UNRESOLVED" for people
   *  whose email had already been revealed. */
  linkedinUrl?: string;
};
const apolloReveals = makeStore<Record<string, ApolloReveal>>("bito-apollo-reveals", {});

export function getReveal(apolloId: string): ApolloReveal | undefined {
  return apolloId ? apolloReveals.get()[apolloId] : undefined;
}

export function mergeReveal(apolloId: string, patch: ApolloReveal): void {
  if (!apolloId) return;
  const cur = apolloReveals.get();
  const next = { ...(cur[apolloId] ?? {}), ...patch };
  apolloReveals.set({ ...cur, [apolloId]: next });
}
