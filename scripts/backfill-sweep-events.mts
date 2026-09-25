// One-time backfill (Max, Sep 25): existing Apollo "Profile-fit match" rows get
// the same headcount-growth check new sweeps now apply (lib/sweepEvents).
//
// Only rows whose domain is known can be checked — the row's website URL, or
// a Signal 2000 directory match by name (most sweep rows carry a LinkedIn URL
// only). Growth comes from one Apollo search per 100 domains (1 credit each).
// Funding is NOT backfilled: it needs the per-company lookup at 1 credit per
// company; new sweeps get it for free from the call they already make.
//
// Dry run by default. --apply writes, after saving every row it will change to
// a snapshot file so the change can be rolled back.
//
// Usage: npx tsx scripts/backfill-sweep-events.mts [--apply] [snapshotDir]

import fs from "node:fs";
import path from "node:path";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const U = process.env.SUPABASE_URL ?? "";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!U || !SVC) throw new Error("Supabase env missing");
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };

const apply = process.argv.includes("--apply");
const snapshotDir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? ".";

const { sweepEvent } = await import("../lib/sweepEvents");
const { apolloOrgsByDomains } = await import("../lib/enrich/apollo");
const { rootDomain } = await import("../lib/githubProspect/store");

type Row = {
  id: string;
  account: string;
  type: string;
  url: string | null;
  region: string | null;
  strength: number;
  title: string;
  description: string | null;
  tags: string[] | null;
  source: string | null;
};

const get = async <T,>(q: string): Promise<T[]> => {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${U}/rest/v1/${q}&limit=1000&offset=${offset}`, { headers: H });
    const page = (await res.json()) as T[];
    if (!Array.isArray(page)) throw new Error(JSON.stringify(page).slice(0, 300));
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const rows = await get<Row>(
  "bito_signals?select=id,account,type,url,region,strength,title,description,tags,source&type=eq.icp&title=like.Profile-fit%20match*",
);
const directory = await get<{ company: string; domain: string | null }>("bito_directory?select=company,domain&domain=not.is.null");
const dirDomain = new Map(directory.filter((d) => d.domain).map((d) => [norm(d.company), rootDomain(d.domain!)]));

const withDomain: { row: Row; domain: string }[] = [];
for (const r of rows) {
  let domain: string | undefined;
  if (r.url && !/linkedin\.com/i.test(r.url)) {
    try {
      domain = rootDomain(new URL(r.url).hostname.replace(/^www\./, ""));
    } catch {
      /* not a URL */
    }
  }
  domain ??= dirDomain.get(norm(r.account));
  if (domain) withDomain.push({ row: r, domain });
}
console.log(`profile-only rows: ${rows.length}; with a known domain: ${withDomain.length}`);

const apollo = await apolloOrgsByDomains(withDomain.map((w) => w.domain));
console.log(`Apollo domain search: ${apollo.orgs.length} matched (${Math.ceil(new Set(withDomain.map((w) => w.domain)).size / 100)} credit(s))${apollo.error ? `, error: ${apollo.error}` : ""}`);
const byDomain = new Map(apollo.orgs.map((o) => [rootDomain(o.domain), o]));

// Existing rows of the target types, so a conversion never collides with the
// UNIQUE (account, type) constraint.
const existing = new Set(
  (await get<{ account: string; type: string }>("bito_signals?select=account,type&type=in.(hiring,layoffs)")).map(
    (r) => `${r.account}\u0000${r.type}`,
  ),
);

const changes: { before: Row; patch: Partial<Row> }[] = [];
let conflicts = 0;
for (const { row, domain } of withDomain) {
  const org = byDomain.get(domain);
  if (!org) continue;
  const ev = sweepEvent({ growth6m: org.growth6m, growth12m: org.growth12m });
  if (!ev) continue;
  if (existing.has(`${row.account}\u0000${ev.type}`)) {
    conflicts += 1;
    continue;
  }
  changes.push({
    before: row,
    patch: {
      type: ev.type,
      title: ev.title,
      description: [ev.detail, row.description ?? ""].filter(Boolean).join(" "),
      tags: [...ev.facts, ...(row.tags ?? [])].slice(0, 6),
      strength: Math.max(40, Math.min(95, row.strength + ev.bump)),
      source: ev.source,
    },
  });
}

const byType = changes.reduce<Record<string, number>>((m, c) => ((m[c.patch.type!] = (m[c.patch.type!] ?? 0) + 1), m), {});
console.log(`would convert: ${changes.length} ${JSON.stringify(byType)}; skipped (row of that type already exists): ${conflicts}`);
for (const c of changes.slice(0, 12)) console.log(`  ${c.before.account} [${c.before.region ?? "us"}] → ${c.patch.type}: ${c.patch.title}`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}

const snap = path.join(snapshotDir, `sweep-events-backfill-${Date.now()}.json`);
fs.writeFileSync(snap, JSON.stringify(changes.map((c) => c.before), null, 2));
console.log(`snapshot of ${changes.length} rows: ${snap}`);

let written = 0;
for (const c of changes) {
  const res = await fetch(`${U}/rest/v1/bito_signals?id=eq.${encodeURIComponent(c.before.id)}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify(c.patch),
  });
  if (res.ok) written += 1;
  else console.log(`  write failed for ${c.before.account}: ${res.status} ${(await res.text()).slice(0, 160)}`);
}
console.log(`written: ${written} of ${changes.length}`);
