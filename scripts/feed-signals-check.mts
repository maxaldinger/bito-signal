// Feed signal sources check — run after touching lib/sweepEvents.ts,
// lib/githubIntent.ts, the Apollo sweep, or the layoffs bucket.
//
//   1. sweepEvent rules on synthetic inputs (no network).
//   2. Live Apollo lookups for a few domains → the event each would become
//      (1 Apollo credit per domain).
//   3. The GitHub intent roll-up per region (Supabase read + 1 Apollo credit;
//      nothing is written).
//   4. Raw layoffs-bucket candidates from the free sources (the Haiku grading
//      step runs in production on Pull More).
//
// Usage: npx tsx scripts/feed-signals-check.mts [--no-live]

import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const live = !process.argv.includes("--no-live");

const { sweepEvent } = await import("../lib/sweepEvents");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------- 1. rules
const NOW = Date.parse("2026-09-25T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const f = sweepEvent({ funding: { date: day(100), type: "Series F", amount: "115M", investors: "Advent International" }, growth12m: 0.09 }, NOW);
check(f?.type === "funding" && f.title === "Raised $115M Series F · Jun 2026", "recent round becomes a funding signal", f?.title);
check(f?.url === undefined && f?.date === day(100).slice(0, 10), "funding carries the round date");

const stale = sweepEvent({ funding: { date: day(298), type: "Series E", amount: "200M" }, growth12m: 0.212 }, NOW);
check(stale?.type === "hiring" && stale.title === "Headcount up 21% in 12 months", "a round older than 180 days falls through to growth", stale?.title);

const ma = sweepEvent({ acquisition: { date: day(40), type: "Merger / Acquisition", investors: "Thoma Bravo" }, funding: { date: day(20), type: "Series C" } }, NOW);
check(ma?.type === "ma" && ma.title.startsWith("Merger / acquisition with Thoma Bravo"), "a recent M&A outranks a recent round", ma?.title);

const shrink = sweepEvent({ growth12m: -0.14, growth6m: -0.03, engineering: 240 }, NOW);
check(shrink?.type === "layoffs" && shrink.title === "Headcount down 14% in 12 months", "12-month shrinkage becomes a layoffs signal", shrink?.title);
check(/not confirmed to include engineering/.test(shrink?.detail ?? "") && /240 in engineering/.test(shrink?.detail ?? ""),
  "a shrinkage row says company-wide, never confirmed engineering cuts", shrink?.detail);

const shrink6 = sweepEvent({ growth12m: -0.02, growth6m: -0.09 }, NOW);
check(shrink6?.type === "layoffs" && shrink6.title.endsWith("in 6 months"), "6-month shrinkage qualifies on its own", shrink6?.title);

const flat = sweepEvent({ growth12m: 0.005, growth6m: 0.0017, acquisition: { date: day(1400), type: "Merger / Acquisition" } }, NOW);
check(flat === null, "flat headcount and an old M&A stay a profile match");

const grow6 = sweepEvent({ growth6m: 0.12 }, NOW);
check(grow6?.type === "hiring" && grow6.title === "Headcount up 12% in 6 months", "6-month growth qualifies on its own", grow6?.title);

const both = sweepEvent({ growth12m: -0.12, growth6m: 0.15 }, NOW);
check(both?.type === "layoffs", "shrinkage wins over growth when both windows qualify");

check((f?.facts ?? []).includes("Series F Jun 2026"), "facts carry the round for the tags", JSON.stringify(f?.facts));

if (!live) {
  console.log(failures === 0 ? "\nALL CHECKS PASSED (offline)" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- 2. Apollo
const { apolloOrgFacts } = await import("../lib/enrich/apollo");
console.log("\nLive Apollo lookups (1 credit each):");
for (const d of ["coralogix.com", "harness.io", "usertesting.com"]) {
  const facts = await apolloOrgFacts(d);
  const ev = facts ? sweepEvent({ ...facts, engineering: facts.engineering }) : null;
  console.log(`  ${d}: growth12m=${facts?.growth12m?.toFixed(3)} funding=${facts?.funding?.type} ${facts?.funding?.date?.slice(0, 10)} ma=${facts?.acquisition?.date?.slice(0, 10) ?? "-"} → ${ev ? `${ev.type}: ${ev.title}` : "profile match"}`);
  if (d === "coralogix.com") check(ev?.type === "funding", "coralogix.com (Series F, Jun 2026) becomes a funding signal", ev?.title);
  if (d === "harness.io") check(ev?.type === "hiring", "harness.io (+21% in 12 months, Dec 2025 round) becomes a hiring-growth signal", ev?.title);
}

// ---------------------------------------------------------------- 3. GitHub
const { githubIntentSignals } = await import("../lib/githubIntent");
console.log("\nGitHub intent roll-up (reads only):");
let totalGh = 0;
for (const region of ["us", "in", "global"] as const) {
  const gh = await githubIntentSignals(region);
  totalGh += gh.signals.length;
  console.log(`  ${region}: ok=${gh.ok} ${gh.signals.length} signals of ${gh.qualifying} qualifying companies${gh.error ? ` (${gh.error})` : ""}`);
  for (const s of gh.signals.slice(0, 6)) console.log(`     ${s.strength}  ${s.account} — ${s.title}`);
  if (region === "us") {
    check(gh.ok, "GitHub roll-up runs");
    check(!gh.signals.some((s) => /zep|upstash|cognee|oraios|llamaindex/i.test(s.account)), "repo maintainers are excluded from their own repos");
    check(!gh.signals.some((s) => /universit|college|institut/i.test(s.account)), "schools are excluded");
  }
}
check(totalGh > 0, "the roll-up produces signals in at least one region", String(totalGh));

// ---------------------------------------------------------------- 4. layoffs sources
const { fetchGdeltItems } = await import("../lib/sources/gdelt");
const { fetchRssItems } = await import("../lib/sources/rss");
const { fetchHNItems } = await import("../lib/sources/hn");
console.log("\nLayoffs bucket raw candidates (before Haiku grading):");
const tc = await fetchRssItems("https://techcrunch.com/tag/layoffs/feed/", { limit: 20 });
check(tc.ok && tc.items.length > 0, "TechCrunch layoffs feed returns items", `${tc.items.length}`);
for (const it of tc.items.slice(0, 5)) console.log(`   TC   ${it.title}`);
const hn = await fetchHNItems("layoffs", { minPoints: 20, days: 30, limit: 8 });
console.log(`   HN   ${hn.ok ? hn.items.length : `error: ${hn.error}`} items`);
for (const it of hn.items.slice(0, 3)) console.log(`   HN   ${it.title}`);
const gd = await fetchGdeltItems('(layoffs OR "laid off" OR "job cuts" OR "cutting jobs") (engineers OR engineering OR developers OR software)', { limit: 25 });
console.log(`   GDELT ${gd.ok ? gd.items.length : `error: ${gd.error}`} items`);
for (const it of gd.items.slice(0, 3)) console.log(`   GDELT ${it.title}`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
