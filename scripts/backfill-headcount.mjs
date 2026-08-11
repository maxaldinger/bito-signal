// One-off: backfill company headcount for GitHub prospects enriched before the
// size gate persisted it. Every "ready" row predates that fix, so the UI's
// company-size floor matched zero of them while "relax the filter" showed 28 —
// the bug Max hit on 2026-08-11.
//
// Free: organizations/enrich consumes no Apollo credits and is domain-keyed
// (no fuzzy-name mismatches). Targets every row that has a company_domain and
// no headcount, whatever its status, so the size filter works on the
// suppressed/no-match views too. Dry-run by default.
//
// Usage: node scripts/backfill-headcount.mjs [--write]

import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const g = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
};
const U = g("SUPABASE_URL"), SVC = g("SUPABASE_SERVICE_ROLE_KEY"), APOLLO = g("APOLLO_API_KEY");
if (!U || !SVC) throw new Error("Supabase env missing");
if (!APOLLO) throw new Error("APOLLO_API_KEY missing");
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };
const WRITE = process.argv.includes("--write");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = await (
  await fetch(
    `${U}/rest/v1/bito_enriched_contacts?select=login,company,company_domain,status` +
      `&headcount=is.null&company_domain=not.is.null&limit=2000`,
    { headers: H },
  )
).json();
if (!Array.isArray(rows)) throw new Error(`unexpected read: ${JSON.stringify(rows).slice(0, 200)}`);

// One Apollo call per domain; rows keep their stored login for the PATCH so
// mixed-case domain spellings can't dodge the update.
const byDomain = new Map();
for (const r of rows) {
  const d = r.company_domain.toLowerCase().trim();
  if (!byDomain.has(d)) byDomain.set(d, []);
  byDomain.get(d).push(r);
}
console.log(
  `${rows.length} rows missing headcount across ${byDomain.size} domains` +
    (WRITE ? "" : " (dry run — pass --write to apply)"),
);

let filled = 0;
let unknown = 0;
for (const [domain, group] of byDomain) {
  let hc;
  try {
    const res = await fetch(
      `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`,
      { headers: { "x-api-key": APOLLO, Accept: "application/json", "Cache-Control": "no-cache" } },
    );
    if (res.ok) {
      const emp = (await res.json())?.organization?.estimated_num_employees;
      if (typeof emp === "number" && Number.isFinite(emp)) hc = emp;
    } else if (res.status === 429) {
      console.log("  rate limited — pausing 30s");
      await sleep(30_000);
    }
  } catch {
    // treated as unknown below
  }
  if (hc === undefined) {
    unknown += 1;
    console.log(`  ${domain}: no headcount from Apollo (${group.length} row(s) untouched)`);
  } else {
    if (WRITE) {
      const logins = group.map((r) => r.login).join(",");
      const res = await fetch(
        `${U}/rest/v1/bito_enriched_contacts?login=in.(${encodeURIComponent(logins)})&headcount=is.null`,
        { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ headcount: hc }) },
      );
      if (!res.ok) throw new Error(`${domain}: PATCH ${res.status} ${await res.text()}`);
    }
    filled += group.length;
    console.log(
      `  ${domain}: ~${hc.toLocaleString()} employees -> ${group.length} row(s) (${group[0].company ?? domain})`,
    );
  }
  await sleep(250);
}
console.log(`${WRITE ? "Backfilled" : "Would backfill"} ${filled} rows; ${unknown} domains unknown.`);
