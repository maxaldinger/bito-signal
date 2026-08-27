// Tighter SWE estimates for the Signal 2000 directories (all regions):
// replace the 35%/3% share-model swe_estimate with Apollo's LinkedIn-derived
// ENGINEERING department headcount wherever one exists — a measured figure
// with provenance instead of a guess. Also fills estimated_employees where
// missing (same free call carries it). organizations/enrich consumes no
// credits. Dry-run by default.
//
// Usage: node scripts/backfill-swe-dept.mjs [--write]

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

// All domained rows, paged past PostgREST's cap.
const rows = [];
for (let off = 0; ; off += 1000) {
  const page = await (
    await fetch(
      `${U}/rest/v1/bito_directory?select=company_key,company,domain,region,swe_estimate,estimated_employees` +
        `&domain=not.is.null&order=company_key.asc&limit=1000&offset=${off}`,
      { headers: H },
    )
  ).json();
  if (!Array.isArray(page)) throw new Error(`read failed: ${JSON.stringify(page).slice(0, 200)}`);
  rows.push(...page);
  if (page.length < 1000) break;
}
console.log(`${rows.length} domained directory rows${WRITE ? "" : " (dry run — pass --write to apply)"}`);

async function enrich(domain) {
  const res = await fetch(
    `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`,
    { headers: { "x-api-key": APOLLO, Accept: "application/json" } },
  );
  if (res.status === 429) {
    console.log("  rate limited — pausing 30s");
    await sleep(30_000);
    return enrich(domain);
  }
  if (!res.ok) return null;
  return (await res.json())?.organization ?? null;
}

let sweSet = 0, empFilled = 0, noDept = 0, failed = 0, done = 0, qi = 0;
async function worker() {
  for (;;) {
    const r = rows[qi++];
    if (!r) return;
    done += 1;
    if (done % 500 === 0) console.log(`  ${done}/${rows.length}… (swe set ${sweSet}, employees filled ${empFilled})`);
    const org = await enrich(r.domain);
    await sleep(120);
    if (!org) { failed += 1; continue; }
    const dept = org.departmental_head_count ?? {};
    const eng = typeof dept.engineering === "number" && dept.engineering >= 5 ? Math.round(dept.engineering) : null;
    const emp =
      typeof org.estimated_num_employees === "number" && org.estimated_num_employees > 0
        ? Math.round(org.estimated_num_employees)
        : null;
    const patch = {};
    if (eng && eng !== r.swe_estimate) patch.swe_estimate = eng;
    if (emp && !r.estimated_employees) patch.estimated_employees = emp;
    if (!eng) noDept += 1;
    if (Object.keys(patch).length === 0) continue;
    if (WRITE) {
      const res = await fetch(
        `${U}/rest/v1/bito_directory?company_key=eq.${encodeURIComponent(r.company_key)}&region=eq.${r.region}`,
        { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(patch) },
      );
      if (!res.ok) { failed += 1; continue; }
    }
    if (patch.swe_estimate) sweSet += 1;
    if (patch.estimated_employees) empFilled += 1;
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()));
console.log(
  `${WRITE ? "Applied" : "Would apply"}: measured engineering SWE on ${sweSet} rows, ` +
    `employees filled on ${empFilled}; ${noDept} rows had no usable engineering dept count (share model kept); ${failed} lookups failed.`,
);
