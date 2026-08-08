// WS3 data migration: assign the legacy single-user state to a real user.
//
// Copies the PER-USER stores from legacy bito_state (one shared row per store,
// "<base>.v2" keys) into bito_user_state under the given user's id, as
// "<base>.v3" keys (the KEY_VERSION the per-user client code uses). Shared
// caches are NOT touched — they stay on the legacy path until WS4 moves them
// to row-per-entry tables.
//
// Idempotent upserts; legacy rows are left in place for rollback.
//
// Usage: node scripts/migrate-user-state.mjs <email> [--write]

import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const g = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
};
const U = g("SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
if (!U || !SVC) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };

const email = process.argv[2]?.toLowerCase();
const WRITE = process.argv.includes("--write");
if (!email || !email.includes("@")) throw new Error("Pass the user's email as the first argument");

/** The stores that are per-user under the multi-tenant split. */
const PER_USER = [
  "bito-prospected",
  "bito-favorites",
  "bito-reviewed",
  "bito-collapsed",
  "bito-lowpriority",
  "bito-last-due",
  "bito-hs-presence",
];

const users = await (await fetch(`${U}/auth/v1/admin/users?per_page=100`, { headers: H })).json();
const user = (users.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
if (!user) throw new Error(`No auth user with email ${email}`);
console.log(`user: ${user.email} -> ${user.id}`);

const legacy = await (await fetch(`${U}/rest/v1/bito_state?select=store,value,updated_at`, { headers: H })).json();
const byBase = new Map(legacy.map((r) => [r.store.replace(/\.v\d+$/, ""), r]));

for (const base of PER_USER) {
  const row = byBase.get(base);
  if (!row) {
    console.log(`  ${base}: no legacy row — skipped`);
    continue;
  }
  const size = JSON.stringify(row.value).length;
  if (!WRITE) {
    console.log(`  ${base}: would copy ${size} bytes -> bito_user_state(${user.id}, ${base}.v3)`);
    continue;
  }
  const res = await fetch(`${U}/rest/v1/bito_user_state?on_conflict=user_id,store`, {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ user_id: user.id, store: `${base}.v3`, value: row.value, updated_at: row.updated_at }]),
  });
  if (!res.ok) throw new Error(`${base}: HTTP ${res.status} ${await res.text()}`);
  console.log(`  ${base}: copied ${size} bytes`);
}

if (WRITE) {
  const check = await (
    await fetch(`${U}/rest/v1/bito_user_state?user_id=eq.${user.id}&select=store`, { headers: H })
  ).json();
  console.log(`bito_user_state rows for ${user.email}: ${check.length} (${check.map((r) => r.store).join(", ")})`);
} else {
  console.log("\nDry run. Re-run with --write to copy.");
}
