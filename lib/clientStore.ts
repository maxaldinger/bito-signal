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

// Generic localStorage-backed store with a stable snapshot reference. An
// optional `coerce` migrates whatever shape is on disk into the current one.
function makeStore<T>(key: string, empty: T, coerce?: (raw: unknown) => T) {
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
  function set(next: T) {
    cache = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode / quota — in-memory only */
    }
    listeners.forEach((l) => l());
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

export function companyInMap(map: Record<string, number>, company: string): boolean {
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

// ---------------- Apollo reveal cache ----------------
// Caches revealed email/phone/name per Apollo person id so the auto-reveal on a
// stakeholder card doesn't re-spend a credit every time a brief is reopened.
export type ApolloReveal = {
  name?: string;
  email?: string;
  emailStatus?: string;
  phone?: string;
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
