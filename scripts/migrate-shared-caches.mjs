// WS4 data migration: legacy shared-cache blobs -> row-per-entry tables.
//
//   bito_state "bito-apollo-reveals.v2"  -> bito_reveal_cache   (row per apollo id)
//   bito_state "bito-deepdive-scores.v2" -> bito_scores         (row per company)
//   bito_state "bito-company-blurbs.v2"  -> bito_company_blurbs (row per company)
//   bito_state "bito-sweep-cursor.v2"    -> bito_sweep_cursor   (row per region)
//   bito_state "bito-blacklist.v2"       -> bito_blacklist      (row per company)
//
// Idempotent upserts; legacy rows left in place for rollback.
// Usage: node scripts/migrate-shared-caches.mjs [--write]

import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const g = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
};
const U = g("SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
if (!U || !SVC) throw new Error("Supabase env missing");
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };
const WRITE = process.argv.includes("--write");

const legacy = await (await fetch(`${U}/rest/v1/bito_state?select=store,value`, { headers: H })).json();
const blob = (base) => legacy.find((r) => r.store === `${base}.v2`)?.value ?? {};

async function upsertRows(table, conflict, rows, label) {
  if (rows.length === 0) return console.log(`  ${label}: nothing to migrate`);
  if (!WRITE) return console.log(`  ${label}: would upsert ${rows.length} rows -> ${table}`);
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await fetch(`${U}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: "POST",
      headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + CHUNK)),
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
  }
  const count = await fetch(`${U}/rest/v1/${table}?select=*`, { method: "HEAD", headers: { ...H, Prefer: "count=exact" } });
  console.log(`  ${label}: upserted ${rows.length} -> table now has ${count.headers.get("content-range")?.split("/")[1]} rows`);
}

// Reveals: {apolloId: {name?, email?, emailStatus?, phone?, country?, linkedinUrl?}}
const reveals = blob("bito-apollo-reveals");
await upsertRows(
  "bito_reveal_cache",
  "apollo_id",
  Object.entries(reveals).map(([id, r]) => ({
    apollo_id: id,
    name: r?.name ?? null,
    email: r?.email ?? null, // "" already means attempted-none in the blob
    email_status: r?.emailStatus ?? null,
    phone: r?.phone ?? null,
    country: r?.country ?? null,
    linkedin_url: r?.linkedinUrl ?? null,
    company_domain: r?.companyDomain ?? null,
  })),
  "reveal cache",
);

const scores = blob("bito-deepdive-scores");
await upsertRows(
  "bito_scores",
  "company_key",
  Object.entries(scores)
    .filter(([, v]) => Number.isFinite(v))
    .map(([k, v]) => ({ company_key: k, score: Math.round(v) })),
  "deep-dive scores",
);

const blurbs = blob("bito-company-blurbs");
await upsertRows(
  "bito_company_blurbs",
  "company_key",
  Object.entries(blurbs)
    .filter(([, v]) => typeof v === "string" && v)
    .map(([k, v]) => ({ company_key: k, blurb: v })),
  "company blurbs",
);

const cursor = blob("bito-sweep-cursor");
await upsertRows(
  "bito_sweep_cursor",
  "cursor_key",
  Object.entries(cursor)
    .filter(([, v]) => Number.isFinite(v))
    .map(([k, v]) => ({ cursor_key: k, page: Math.floor(v) })),
  "sweep cursor",
);

const blacklist = blob("bito-blacklist");
await upsertRows(
  "bito_blacklist",
  "company_key",
  Object.entries(blacklist)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => ({ company_key: k, company: v || k })),
  "blacklist",
);

console.log(WRITE ? "\nDone." : "\nDry run. Re-run with --write.");
