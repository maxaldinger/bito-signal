// Day-one cross-project copy: WARM project -> bito-signal project.
//
// Copies the seven bito_* tables verbatim over PostgREST, chunked, then asserts
// per-table row counts source vs destination. Idempotent: every insert is an
// upsert on the table's conflict target, so a partial run can simply be re-run.
//
// Reads from .env.local:
//   OLD_SUPABASE_URL / OLD_SUPABASE_ANON_KEY   (source: the shared WARM project)
//   SUPABASE_URL     / SUPABASE_ANON_KEY       (destination: bito-signal)
//
// Usage:  node scripts/migrate-project.mjs          (dry run: counts only)
//         node scripts/migrate-project.mjs --write  (copy + assert)

import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
};

const SRC = { url: get("OLD_SUPABASE_URL").replace(/\/$/, ""), key: get("OLD_SUPABASE_ANON_KEY") };
const DST = { url: get("SUPABASE_URL").replace(/\/$/, ""), key: get("SUPABASE_ANON_KEY") };
const WRITE = process.argv.includes("--write");

if (!SRC.url || !SRC.key) throw new Error("OLD_SUPABASE_URL / OLD_SUPABASE_ANON_KEY missing from .env.local");
if (!DST.url || !DST.key) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY missing from .env.local");
if (SRC.url === DST.url) throw new Error("Source and destination are the same project — refusing");

/** table -> PostgREST on_conflict target (must match the table's PK/unique). */
const TABLES = {
  bito_briefs: "company_key",
  bito_directory: "company_key",
  bito_enriched_contacts: "login",
  bito_github_signals: "id",
  bito_monitored_repos: "repo_key",
  bito_signals: "id",
  bito_state: "store",
};

const headers = (p, extra = {}) => ({
  apikey: p.key,
  Authorization: `Bearer ${p.key}`,
  "Content-Type": "application/json",
  ...extra,
});

async function count(p, table) {
  const res = await fetch(`${p.url}/rest/v1/${table}?select=*`, {
    method: "HEAD",
    headers: headers(p, { Prefer: "count=exact" }),
  });
  if (!res.ok) throw new Error(`${table}: count HTTP ${res.status} on ${p.url}`);
  const range = res.headers.get("content-range") || "";
  return Number(range.split("/")[1] ?? NaN);
}

async function copyTable(table, conflict) {
  const CHUNK = table === "bito_briefs" ? 25 : 500; // briefs carry large jsonb
  let offset = 0;
  let copied = 0;
  for (;;) {
    const res = await fetch(
      `${SRC.url}/rest/v1/${table}?select=*&order=${encodeURIComponent(conflict)}&offset=${offset}&limit=${CHUNK}`,
      { headers: headers(SRC) },
    );
    if (!res.ok) throw new Error(`${table}: read HTTP ${res.status} at offset ${offset}`);
    const rows = await res.json();
    if (rows.length === 0) break;
    const w = await fetch(`${DST.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: headers(DST, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows),
    });
    if (!w.ok) throw new Error(`${table}: write HTTP ${w.status} at offset ${offset}: ${(await w.text()).slice(0, 300)}`);
    copied += rows.length;
    offset += CHUNK;
    process.stdout.write(`\r  ${table}: ${copied}`);
  }
  process.stdout.write("\n");
  return copied;
}

let failed = false;
for (const [table, conflict] of Object.entries(TABLES)) {
  const src = await count(SRC, table);
  if (!WRITE) {
    let dst = "n/a";
    try {
      dst = String(await count(DST, table));
    } catch {
      dst = "missing";
    }
    console.log(`${table.padEnd(24)} src=${src}  dst=${dst}`);
    continue;
  }
  console.log(`${table} (src=${src}):`);
  await copyTable(table, conflict);
  const dst = await count(DST, table);
  const ok = dst === src;
  if (!ok) failed = true;
  console.log(`  ${ok ? "OK " : "MISMATCH"} src=${src} dst=${dst}`);
}

if (!WRITE) console.log("\nDry run. Re-run with --write to copy.");
else if (failed) {
  console.error("\nROW COUNT MISMATCH — do not flip the env. Re-run to resume, or investigate.");
  process.exit(1);
} else console.log("\nAll tables copied and verified.");
