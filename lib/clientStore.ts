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

// Generic localStorage-backed store with a stable snapshot reference.
function makeStore<T>(key: string, empty: T) {
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  function get(): T {
    if (cache === null) {
      try {
        cache = (JSON.parse(localStorage.getItem(key) || "null") as T) ?? empty;
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
type Prospected = { companies: string[]; contacts: string[] };
const prospected = makeStore<Prospected>("bito-prospected", { companies: [], contacts: [] });

export function markProspected(kind: "company" | "contact", key: string): void {
  if (!key) return;
  const cur = prospected.get();
  const field = kind === "company" ? "companies" : "contacts";
  const k = kind === "company" ? normCompany(key) : norm(key);
  // Compare with the same normalization so legacy values don't duplicate.
  const exists = cur[field].some((v) =>
    kind === "company" ? normCompany(v) === k : norm(v) === k,
  );
  if (exists) return;
  prospected.set({ ...cur, [field]: [...cur[field], k] });
}

export function useIsProspected(kind: "company" | "contact", key: string): boolean {
  const s = prospected.useStore();
  if (!key) return false;
  if (kind === "company") {
    const target = normCompany(key);
    return s.companies.some((v) => normCompany(v) === target);
  }
  const target = norm(key);
  return s.contacts.some((v) => norm(v) === target);
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
