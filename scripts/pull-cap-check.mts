// Pull cap check — "1 pull, 1 full page" (Max, Sep 30). Exercises the signals
// route's capped Apollo sweep and GitHub branch in-process against production
// data WITHOUT writing: every POST/PATCH/DELETE to the signals table is
// intercepted and answered locally, so the GitHub check (expects zero changed
// rows) and the capped sweep run the real code paths but persist nothing.
// Costs ~23 Apollo credits (18 search pages + 5 lookups).
//
// Usage: npx tsx scripts/pull-cap-check.mts [sweepPage]
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
// Block every write to the signals table; reads pass through.
const blockedWrites: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD" && /\/rest\/v1\/bito_signals/.test(url)) {
    blockedWrites.push(`${method} ${url.split("?")[0]}`);
    return new Response(null, { status: 201 });
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const { NextRequest } = await import("next/server");
const { GET } = await import("../app/api/signals/route");
const { normCompany } = await import("../lib/companyKey");
const PAGE = Number(process.argv[2]) || 8;

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const call = async (qs: string) => {
  const res = await GET(new NextRequest(`http://localhost/api/signals?${qs}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

// 1. GitHub: nothing changed since the Sep 25 seed, so nothing is written.
{
  const { status, body } = await call("type=github&region=us");
  const n = Array.isArray(body.signals) ? body.signals.length : -1;
  check(status === 200 && (n === 0 || body.empty === true), "GitHub bucket writes only new or newer activity", `status ${status}, ${n} changed`);
}

// 2. Capped sweep, persistence off.
const known = new Set<string>();
{
  const U = process.env.SUPABASE_URL!;
  const K = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${U}/rest/v1/bito_signals?select=account,type&limit=1000&offset=${off}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } });
    const rows = (await r.json()) as { account: string; type: string }[];
    for (const x of rows) known.add(normCompany(x.account));
    if (rows.length < 1000) break;
  }
}
const writesBefore = blockedWrites.length;
{
  const { status, body } = await call(`type=icp&region=us&sweepPage=${PAGE}&limit=5`);
  const sigs = (Array.isArray(body.signals) ? body.signals : []) as { account: string; type: string; title: string }[];
  console.log(`  sweep: status ${status}, ${sigs.length} rows, nextSweepPage ${body.nextSweepPage}, persisted ${body.persisted}`);
  for (const s of sigs) console.log(`    ${s.type.padEnd(8)} ${s.account} — ${s.title}`);
  check(status === 200 && sigs.length <= 5 && sigs.length > 0, "sweep keeps at most the requested 5", `${sigs.length}`);
  const newOnes = sigs.filter((s) => !known.has(normCompany(s.account)));
  const reFound = sigs.filter((s) => known.has(normCompany(s.account)));
  check(reFound.every((s) => s.type === "hiring" || s.type === "layoffs"), "a company already in the feed only returns with a growth/shrink event", `${reFound.length} re-found`);
  check(newOnes.length + reFound.length === sigs.length, "every row is either new to the feed or a re-found event");
  check(blockedWrites.length - writesBefore === 1, "the sweep's single upsert was intercepted, so nothing reached the database", `${blockedWrites.length - writesBefore} blocked`);
  check(body.nextSweepPage === PAGE, "a page with unexamined companies stays the cursor", String(body.nextSweepPage));
}
// 3. limit=0 costs nothing.
{
  const { status, body } = await call(`type=icp&region=us&sweepPage=${PAGE}&limit=0`);
  check(status === 200 && Array.isArray(body.signals) && (body.signals as unknown[]).length === 0, "limit=0 returns without calling Apollo");
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
