// Resolve the ~438 domain-less US Signal-2000 rows (the market-cap seed half
// that shipped as bare names — IBM among them) so they get real domains and
// MEASURED SWE estimates like every other row.
//
// Method = the India build's safe path, tightened further:
//   1. Apollo mixed_companies/search by the row's exact name, US-located.
//   2. Accept ONLY an exact normalized-name match — NEVER the top result.
//      (The 2026-07-28 domain backfill's fallback matching is what produced
//      Zoom→zoomcommunications.co.uk and the rest of the data debt.)
//   3. Verify via free organizations/enrich on the returned domain; REJECT
//      matches under 500 employees — every row here is a large-cap US
//      company, so a tiny org is a name collision, not a resolution.
//   4. Write domain (null-only), measured swe_estimate (engineering dept
//      count when >= 5), and estimated_employees (null-only).
// Names that don't resolve are logged and left untouched — dropped, never
// guessed. All Apollo calls are FREE (search + enrich consume no credits).
//
// Usage: node scripts/resolve-domainless-us.mjs [--write]

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
const AH = { "x-api-key": APOLLO, Accept: "application/json", "Content-Type": "application/json" };
const APOLLO_BASE = "https://api.apollo.io/api/v1";
const WRITE = process.argv.includes("--write");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// JS twin of lib/companyKey.ts normCompany — must normalize identically.
const COMPANY_SUFFIX =
  /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|gmbh|plc|sa|ag|nv|bv|pte|pvt|private|holdings)\b/g;
const normCompany = (s) =>
  s.toLowerCase().replace(/[.,]/g, " ").replace(COMPANY_SUFFIX, " ").replace(/[^a-z0-9]+/g, " ").trim();

const rootDomain = (d) => {
  const parts = String(d).toLowerCase().trim().replace(/^www\./, "").split(".").filter(Boolean);
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
};

// Name matching, two tiers. Exact normalized equality first; else a TOKEN-SET
// tier for the legal-decoration mismatches the strict dry run surfaced
// ("Zillow Group Inc." vs Apollo's "Zillow", "Williams Companies Inc. (The)"
// vs "The Williams Companies"): token-set equality, or an anchored subset
// (same first token, one side's tokens contained in the other's). Token-level
// containment cannot produce the substring collisions of the old backfill —
// "wex" is not a token of "wexford lots" — and the employee floor still
// backstops whatever gets through.
const tokens = (s) => normCompany(s).split(" ").filter(Boolean);
const nameMatch = (seedName, candName) => {
  const a = tokens(seedName), b = tokens(candName);
  if (a.length === 0 || b.length === 0) return false;
  const A = new Set(a), B = new Set(b);
  const subset = (x, Y) => x.every((t) => Y.has(t));
  if (A.size === B.size && subset(a, B)) return true; // set equality (order-free)
  if (a[0] !== b[0]) return false; // anchored: first tokens must agree
  return subset(a, B) || subset(b, A);
};

// Collision guard: a "largest US companies" row matching a sub-500-employee
// org is a wrong company wearing the right name (the exact failure mode of
// the old backfill: Essential Utilities→essentialsantafe.com, 1 employee).
const MIN_EMPLOYEES = 500;

async function apolloSearch(name) {
  const qs = new URLSearchParams({ q_organization_name: name, page: "1", per_page: "5" });
  qs.append("organization_locations[]", "United States");
  const res = await fetch(`${APOLLO_BASE}/mixed_companies/search?${qs}`, { method: "POST", headers: AH });
  if (res.status === 429) { console.log("  rate limited — pausing 30s"); await sleep(30_000); return apolloSearch(name); }
  if (!res.ok) return null;
  return res.json();
}

async function apolloEnrich(domain) {
  const res = await fetch(`${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, { headers: AH });
  if (res.status === 429) { console.log("  rate limited — pausing 30s"); await sleep(30_000); return apolloEnrich(domain); }
  if (!res.ok) return null;
  return (await res.json())?.organization ?? null;
}

// All domain-less US rows.
const rows = [];
for (let off = 0; ; off += 1000) {
  const page = await (
    await fetch(
      `${U}/rest/v1/bito_directory?select=company_key,company,swe_estimate,estimated_employees` +
        `&region=eq.us&domain=is.null&order=company_key.asc&limit=1000&offset=${off}`,
      { headers: H },
    )
  ).json();
  if (!Array.isArray(page)) throw new Error(`read failed: ${JSON.stringify(page).slice(0, 200)}`);
  rows.push(...page);
  if (page.length < 1000) break;
}
console.log(`${rows.length} domain-less US rows${WRITE ? "" : " (dry run — pass --write to apply)"}`);

// Ticker-list junk that is a SECURITY, not a company — preferred shares,
// subordinated notes, closed-end funds ("BlackRock Enhanced Large Cap Core
// Fund", "Unum Group 6.250% Junior Subordinated Notes due 2058"). Resolving
// these would stamp a real company's domain onto a junk row and mint a
// duplicate prospect. Skipped, counted, and reported — deletion is Max's call.
const SECURITY_LISTING =
  /\d+(\.\d+)?\s*%|\bnotes due\b|fixed.to.floating|fixed.rate reset|\bperpetual\b|\bpreferred\b|\bdepositary\b|\bfund\b/i;

let resolved = 0, noMatch = 0, collision = 0, thinDept = 0, failed = 0, listings = 0, done = 0, qi = 0;
const samples = [];
async function worker() {
  for (;;) {
    const r = rows[qi++];
    if (!r) return;
    done += 1;
    if (done % 50 === 0) console.log(`  ${done}/${rows.length}… (resolved ${resolved}, no-match ${noMatch}, collision ${collision})`);

    if (SECURITY_LISTING.test(r.company)) {
      listings += 1;
      console.log(`  security listing, not a company (skipped): ${r.company}`);
      continue;
    }

    // QUERY LADDER — recall only; precision stays with the matcher + floor.
    // Apollo's name search returns NOTHING for full legal strings ("Zillow
    // Group Inc.", "YETI Holdings Inc.") and shadow records without domains
    // for others ("Verizon Communications, Inc."|no domain) — but the plain
    // brand query surfaces the real org, and the two-tier matcher safely
    // rejects the squatters that ride along (Zillow Hotel, Yeti Distillery,
    // "The Williams Companies, Washington D.C.").
    const toks = tokens(r.company);
    const QUERY_STOP = new Set(["the", "first", "national", "american", "united", "general", "new", "global", "north", "south", "west", "east"]);
    const queries = [r.company];
    const cleaned = toks.join(" ");
    if (cleaned && cleaned !== r.company.toLowerCase()) queries.push(cleaned);
    if (toks.length > 1 && toks[0].length >= 4 && !QUERY_STOP.has(toks[0])) queries.push(toks[0]);

    const target = normCompany(r.company);
    let hit = null;
    for (const q of queries) {
      const body = await apolloSearch(q);
      await sleep(250);
      const orgs = [...(body?.organizations ?? []), ...(body?.accounts ?? [])];
      // Exact normalized match preferred; token-set tier next. NEVER a plain
      // top-result fallback.
      hit =
        orgs.find((o) => normCompany(String(o.name ?? "")) === target && o.primary_domain) ??
        orgs.find((o) => nameMatch(r.company, String(o.name ?? "")) && o.primary_domain) ??
        null;
      if (hit) break;
    }
    if (!hit) { noMatch += 1; console.log(`  no name match: ${r.company}`); continue; }
    const dom = rootDomain(hit.primary_domain);

    const org = await apolloEnrich(dom);
    await sleep(250);
    if (!org) { failed += 1; console.log(`  enrich failed: ${r.company} -> ${dom}`); continue; }
    const emp = typeof org.estimated_num_employees === "number" && org.estimated_num_employees > 0
      ? Math.round(org.estimated_num_employees)
      : null;
    if (!emp || emp < MIN_EMPLOYEES) {
      collision += 1;
      console.log(`  REJECTED (${emp ?? "?"} employees — likely name collision): ${r.company} -> ${dom}`);
      continue;
    }
    const eng = typeof org.departmental_head_count?.engineering === "number" && org.departmental_head_count.engineering >= 5
      ? Math.round(org.departmental_head_count.engineering)
      : null;
    if (!eng) thinDept += 1;

    const patch = { domain: dom };
    if (eng) patch.swe_estimate = eng;
    if (emp && !r.estimated_employees) patch.estimated_employees = emp;
    if (samples.length < 25) samples.push(`${r.company} -> ${dom} (${emp.toLocaleString()} emp, eng ${eng ?? "n/a"})`);

    if (WRITE) {
      const res = await fetch(
        `${U}/rest/v1/bito_directory?company_key=eq.${encodeURIComponent(r.company_key)}&region=eq.us`,
        { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(patch) },
      );
      if (!res.ok) { failed += 1; console.log(`  patch failed: ${r.company}`); continue; }
    }
    resolved += 1;
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()));

console.log(`\nSample matches:\n  ${samples.join("\n  ")}`);
console.log(
  `\n${WRITE ? "Applied" : "Would apply"}: ${resolved} rows resolved (domain + measured data), ` +
    `${noMatch} no exact Apollo name match (left untouched), ${collision} rejected as likely collisions, ` +
    `${listings} security-listing junk rows skipped, ` +
    `${thinDept} resolved without a usable engineering dept count, ${failed} lookups failed.`,
);
