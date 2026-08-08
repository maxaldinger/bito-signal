// The permanent RLS isolation gate (MULTI_TENANT_PLAN.md WS2). Run before any
// cutover-adjacent deploy:  node scripts/rls-probe.mjs
//
// Creates two throwaway @bito.ai users, signs both in, and asserts AT THE
// POSTGREST LAYER (not through app code) that:
//   1. a user writes their own bito_user_state rows
//   2. a user CANNOT see another user's rows
//   3. no user JWT can read bito_hubspot_connections (locked table)
//   4. sync events insert as yourself, never as someone else
//   5. anon sees none of the multi-tenant tables
// Cleans up its users and rows afterwards, pass or fail.

import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const g = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
};
const U = g("SUPABASE_URL"), ANON = g("SUPABASE_ANON_KEY"), SVC = g("SUPABASE_SERVICE_ROLE_KEY");
if (!U || !ANON || !SVC) throw new Error("Supabase env missing from .env.local");
const ADMIN = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };

let bad = 0;
const ok = (c, label, got) => {
  if (!c) bad++;
  console.log(`${c ? "ok  " : "FAIL"} ${label}${got !== undefined ? " -> " + got : ""}`);
};

const mkUser = async (tag) => {
  const email = `rls.probe.${tag}.${Date.now()}@bito.ai`;
  const password = "Probe-" + Math.random().toString(36).slice(2) + "!x9long";
  const r = await fetch(`${U}/auth/v1/admin/users`, {
    method: "POST",
    headers: ADMIN,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`create ${tag}: ${r.status} ${JSON.stringify(j)}`);
  const t = await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const tok = await t.json();
  if (!t.ok) throw new Error(`token ${tag}: ${t.status} ${JSON.stringify(tok)}`);
  return { id: j.id, email, jwt: tok.access_token };
};

const rest = (jwt) => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" });

const A = await mkUser("a");
const B = await mkUser("b");

try {
  // 1. A writes their own state row.
  let r = await fetch(`${U}/rest/v1/bito_user_state?on_conflict=user_id,store`, {
    method: "POST",
    headers: { ...rest(A.jwt), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ user_id: A.id, store: "bito-probe.v3", value: { probe: true } }]),
  });
  ok(r.status === 201 || r.status === 200, "A writes own state row", r.status);

  // 1b. A cannot write a row AS B.
  r = await fetch(`${U}/rest/v1/bito_user_state`, {
    method: "POST",
    headers: rest(A.jwt),
    body: JSON.stringify([{ user_id: B.id, store: "bito-forged.v3", value: {} }]),
  });
  ok(r.status === 403 || r.status === 401, "A cannot write a row as B", r.status);

  // 2. B sees zero rows (A's row exists but is invisible).
  r = await fetch(`${U}/rest/v1/bito_user_state?select=store`, { headers: rest(B.jwt) });
  const bRows = await r.json();
  ok(r.status === 200 && bRows.length === 0, "B sees none of A's state", `${r.status}, ${bRows.length} rows`);

  // 2b. A sees exactly their own.
  r = await fetch(`${U}/rest/v1/bito_user_state?select=store`, { headers: rest(A.jwt) });
  const aRows = await r.json();
  ok(r.status === 200 && aRows.length === 1, "A sees exactly their own rows", `${aRows.length} row`);

  // 3. The token table is opaque to every user JWT.
  r = await fetch(`${U}/rest/v1/bito_hubspot_connections?select=user_id`, { headers: rest(A.jwt) });
  const tokRows = r.status === 200 ? await r.json() : [];
  ok(r.status === 200 ? tokRows.length === 0 : r.status === 401 || r.status === 403, "token table opaque to user JWTs", r.status);

  // 4. Sync events: as yourself yes, as someone else no.
  r = await fetch(`${U}/rest/v1/bito_sync_events`, {
    method: "POST",
    headers: rest(A.jwt),
    body: JSON.stringify([{ kind: "company", key: "probe co", user_id: A.id }]),
  });
  ok(r.status === 201, "A logs a sync event as A", r.status);
  r = await fetch(`${U}/rest/v1/bito_sync_events`, {
    method: "POST",
    headers: rest(A.jwt),
    body: JSON.stringify([{ kind: "company", key: "forged", user_id: B.id }]),
  });
  ok(r.status === 403 || r.status === 401, "A cannot log a sync event as B", r.status);

  // 5. anon sees nothing multi-tenant.
  r = await fetch(`${U}/rest/v1/bito_user_state?select=store`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const anonRows = r.status === 200 ? await r.json() : [];
  ok(r.status === 200 ? anonRows.length === 0 : true, "anon sees no per-user state", `${r.status}, ${anonRows.length ?? "-"} rows`);
} finally {
  // Cleanup: users cascade-delete their state + events (FK on delete cascade).
  for (const u of [A, B]) {
    const d = await fetch(`${U}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: ADMIN });
    if (d.status !== 200) console.log(`cleanup warning: delete ${u.email} -> ${d.status}`);
  }
}

console.log(bad === 0 ? "\nRLS PROBE PASS" : `\n${bad} FAILURES — DO NOT DEPLOY`);
process.exit(bad === 0 ? 0 : 1);
