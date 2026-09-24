// Positioning evaluator for intel briefs — is a Governor brief about Governor?
//
// Scores a stored brief (bito_briefs) on two term families across every
// narrative field, then reports the balance and a handful of hard checks:
//   GOVERNOR terms  — routing / model policy / price per token / cost per task
//                     / task time / tool calls / turns / task success / harness
//                     / base URL / gateway / provider
//   CONTEXT terms   — cross-repo / pre-index / context layer / knowledge graph
//                     / rediscover / service boundary / grounded / flying blind
// A context-lever mention is legitimate in a Governor brief (it is one of the
// two levers); the failure mode is a brief that is ONLY context terms with
// routing absent, which is what the Sep 22 Capital One brief looked like.
//
// Usage: npx tsx scripts/brief-positioning-eval.mts "capital one" [beforeSnapshot.json]
//   beforeSnapshot.json = the REST row(s) captured before regeneration; when
//   given, the report shows before → after side by side.

import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const U = process.env.SUPABASE_URL ?? "";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!U || !SVC) throw new Error("Supabase env missing");
const H = { apikey: SVC, Authorization: `Bearer ${SVC}` };

const companyKey = process.argv[2] ?? "capital one";
const beforePath = process.argv[3];

type Intel = Record<string, unknown>;

const MODEL_ROUTING =
  /\b(?:model rout(?:ing|er)|rout(?:e|es|ed|ing) (?:each |every |the |that |those |it |them )?(?:requests?|work|calls?|tasks?|prompts?|traffic)|routed to|lowest[- ]cost model|right model|appropriate model)\b/gi;

const GOVERNOR_TERMS = [
  MODEL_ROUTING,
  /\bmodel polic(?:y|ies)\b/gi,
  /\bprice per token\b/gi,
  /\bcost per (?:successful )?task\b/gi,
  /\btask time\b/gi,
  /\btool calls?\b/gi,
  /\b(?:reasoning )?turns\b/gi,
  /\btask success\b/gi,
  /\bharness(?:es)?\b/gi,
  /\bbase url\b/gi,
  /\bgateway\b/gi,
  /\bmodel providers?\b/gi,
  /\blowest[- ]cost model\b/gi,
  /\bgovernor\b/gi,
];
const CONTEXT_TERMS = [
  /\bcross-?repo\b/gi,
  /\bpre-?index(?:es|ed|ing)?\b/gi,
  /\bcontext layer\b/gi,
  /\bknowledge graph\b/gi,
  /\brediscover(?:s|ing|y)?\b/gi,
  /\bservice boundar(?:y|ies)\b/gi,
  /\bgrounded\b/gi,
  /\bflying blind\b/gi,
  /\bai architect\b/gi,
  /\barchitectural context\b/gi,
];

const count = (text: string, res: RegExp[]) => res.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0);

/** Every narrative string in the brief, joined, plus a per-field map. */
function narrative(intel: Intel): { all: string; fields: Record<string, string> } {
  const g = (p: string): string => {
    const v = p.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Intel)[k] : undefined), intel);
    if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    return typeof v === "string" ? v : "";
  };
  const fields: Record<string, string> = {
    summary: g("summary"),
    callHook: g("callHook"),
    icpRationale: g("icp.rationale"),
    firstMove: g("motion.firstMove"),
    outreachHook: g("outreach.hook"),
    outreachDraft: g("outreach.draftMessage"),
    connect: g("linkedinOutreach.connect"),
    inmail: g("linkedinOutreach.inmail.body"),
    followup2: g("linkedinOutreach.followup2.body"),
    followup3: g("linkedinOutreach.followup3.body"),
    emailOpener: g("emailOpener"),
    whyBito: g("whyBito"),
    painPoints: g("painPoints"),
  };
  return { all: Object.values(fields).join("\n"), fields };
}

function report(label: string, intel: Intel) {
  const { all, fields } = narrative(intel);
  const gov = count(all, GOVERNOR_TERMS);
  const ctx = count(all, CONTEXT_TERMS);
  const routing = (all.match(MODEL_ROUTING) ?? []).length;
  const aa = (all.match(/\bai architect\b/gi) ?? []).length;
  const govName = (all.match(/\bgovernor\b/gi) ?? []).length;
  const words = all.split(/\s+/).filter(Boolean).length;
  console.log(`\n${label}`);
  console.log(`  productFocus: ${String(intel.productFocus ?? "(none — pre-positioning brief)")}${intel.focusReason ? ` — ${intel.focusReason}` : ""}`);
  console.log(`  narrative words: ${words}`);
  console.log(`  Governor-lever terms: ${gov}   context-pitch terms: ${ctx}   balance (gov/(gov+ctx)): ${gov + ctx ? Math.round((100 * gov) / (gov + ctx)) : 0}%`);
  console.log(`  "Governor" named: ${govName}   "AI Architect" named: ${aa}   routing mentions: ${routing}`);
  console.log(`  per field (gov/ctx): ${Object.entries(fields)
    .filter(([, t]) => t)
    .map(([k, t]) => `${k} ${count(t, GOVERNOR_TERMS)}/${count(t, CONTEXT_TERMS)}`)
    .join(" · ")}`);
  console.log(`  callHook: ${fields.callHook.slice(0, 220)}`);
  console.log(`  inmail ¶2-3: ${fields.inmail.split(/\n\n/).slice(1, 3).join(" | ").slice(0, 420)}`);
  return { gov, ctx, routing, aa, govName, all };
}

// Hard checks on the AFTER brief.
function checks(intel: Intel, m: ReturnType<typeof report>) {
  let failures = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures += 1;
  };
  const focus = String(intel.productFocus ?? "");
  check(focus === "governor" || focus === "ai_architect", "productFocus recorded", focus || "missing");
  if (focus === "governor") {
    check(m.routing >= 2, "routing appears in the narrative (both levers present)", `${m.routing} mentions`);
    check(m.gov >= m.ctx, "Governor-lever terms at least match context-pitch terms", `${m.gov} vs ${m.ctx}`);
    check(m.govName >= 1, "Governor is named", `${m.govName}`);
    const inmail = String((intel as { linkedinOutreach?: { inmail?: { body?: string } } }).linkedinOutreach?.inmail?.body ?? "");
    check(MODEL_ROUTING.test(inmail), "InMail mechanism includes model routing, not context alone");
    MODEL_ROUTING.lastIndex = 0;
    // Attribution: a published figure must not sit in the same sentence as routing.
    const misattributed = m.all
      .split(/(?<=[.!?])\s+/)
      .filter((s) => {
        MODEL_ROUTING.lastIndex = 0;
        return MODEL_ROUTING.test(s) && /(\$4\.12|\$2\.14|\$6\.81|\$1\.13|53%|47%|83%|70\.1%|51\.9%)/.test(s);
      });
    check(misattributed.length === 0, "no published figure attributed to routing", misattributed[0]?.slice(0, 160) ?? "");
    const cpt = /\bcost per (?:successful )?task\b|\btask time\b|\btool calls?\b|\btask success\b/i.test(m.all);
    check(cpt, "business case uses cost-per-task / task-time / tool-calls / task-success language");
  }
  return failures;
}

const res = await fetch(
  `${U}/rest/v1/bito_briefs?select=company,generated_at,intel&company_key=eq.${encodeURIComponent(companyKey)}&limit=1`,
  { headers: H },
);
const rows = (await res.json()) as { company: string; generated_at: string; intel: Intel }[];
if (!Array.isArray(rows) || rows.length === 0) throw new Error(`no brief for "${companyKey}"`);
const after = rows[0];

let beforeMetrics: ReturnType<typeof report> | undefined;
if (beforePath && fs.existsSync(beforePath)) {
  const b = JSON.parse(fs.readFileSync(beforePath, "utf8")) as { generated_at: string; intel: Intel }[];
  beforeMetrics = report(`BEFORE  (${b[0].generated_at})`, b[0].intel);
}
const afterMetrics = report(`AFTER   (${after.generated_at})`, after.intel);
if (beforeMetrics && beforeMetrics.all === afterMetrics.all) {
  console.log("\nNOTE: the stored brief is unchanged since the snapshot — it has not been regenerated yet.");
}
console.log("");
const failures = checks(after.intel, afterMetrics);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
