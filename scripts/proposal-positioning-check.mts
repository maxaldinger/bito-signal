// Positioning check for personalized proposals — run after touching
// lib/proposalGen.ts or lib/proposalDoc.ts.
//
//   1. Generates BOTH narratives for one account from its cached brief (two
//      real model calls) and renders both documents. With --render-only (or
//      when the local ANTHROPIC key is dead) it renders deterministic sample
//      fields instead, which still proves layout, ordering and the guards.
//   2. Asserts the two are materially different: headline, executive
//      summary, section order; that OPERATIONAL never leads with a dollar
//      figure; that COST still carries the quantified ROI.
//   3. Re-renders stored proposals (legacy, no mode) and compares their
//      structure against baseline HTML captured before the change, so links
//      already in prospects' inboxes are proven unchanged.
//
// Usage: npx tsx scripts/proposal-positioning-check.mts [company_key] [baselineDir] [--render-only]
//   company_key  default "extreme networks" (must have a row in bito_briefs)
//   baselineDir  optional dir of <token>.html files captured from /p/<token>
//                BEFORE the change; each is re-rendered and compared.

import fs from "node:fs";
import path from "node:path";

// Load .env.local into process.env BEFORE the app modules are imported.
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const U = process.env.SUPABASE_URL ?? "";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!U || !SVC) throw new Error("Supabase env missing");
const H = { apikey: SVC, Authorization: `Bearer ${SVC}` };

const { generateProposalFields, computeRoi } = await import("../lib/proposalGen.ts");
const { buildProposalHtml } = await import("../lib/proposalDoc.ts");
type Fields = import("../lib/proposalDoc.ts").ProposalFields;
type Mode = import("../lib/proposalDoc.ts").PositioningMode;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const renderOnlyFlag = process.argv.includes("--render-only");
const companyKey = args[0] ?? "extreme networks";
const baselineDir = args[1];
const outDir = path.join(process.cwd(), ".proposal-check");
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Structure extraction — what a reader would notice, not byte equality.
// ---------------------------------------------------------------------------
const h1 = (html: string) => html.match(/<h1 class="title">([\s\S]*?)<\/h1>/)?.[1].trim() ?? "";
const h2s = (html: string) => [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
const bigCells = (html: string) => [...html.matchAll(/<td class="num big">([^<]*)<\/td>/g)].map((m) => m[1]);
const bodyParas = (html: string) => [...html.matchAll(/<p class="body">([\s\S]*?)<\/p>/g)].map((m) => m[1]);
const carriesMoneyOrPct = (t: string) => /\$|\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?[MK]\b/i.test(t);

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------------------
// 1. Both narratives from the same brief.
// ---------------------------------------------------------------------------
const briefRes = await fetch(
  `${U}/rest/v1/bito_briefs?select=company,intel&company_key=eq.${encodeURIComponent(companyKey)}&limit=1`,
  { headers: H },
);
const briefRows = (await briefRes.json()) as { company: string; intel: Record<string, unknown> }[];
if (!Array.isArray(briefRows) || briefRows.length === 0) throw new Error(`no brief for "${companyKey}"`);
const intel = briefRows[0].intel as {
  name?: string; domain?: string; summary?: string; callHook?: string; oneLiner?: string; hq?: string;
  employeeBand?: string; sweEstimate?: number;
  segment?: { label?: string };
  icp?: { total?: number; rationale?: string; kubernetes?: { detected?: boolean; evidence?: string } };
  onboarding?: { drivers?: string[] };
  painPoints?: { title: string; evidence?: string }[];
  whyBito?: string[];
  citations?: { title: string }[];
};
const company = intel.name ?? briefRows[0].company;
const swe = intel.sweEstimate && intel.sweEstimate >= 20 ? intel.sweEstimate : undefined;
console.log(`\nAccount: ${company} (brief has ${swe ?? "no"} SWE estimate)`);

const base = {
  company,
  domain: intel.domain,
  research: {
    summary: intel.summary,
    signal: intel.callHook,
    oneLiner: intel.oneLiner,
    segment: intel.segment?.label,
    hq: intel.hq,
    employeeBand: intel.employeeBand,
    icpRationale: intel.icp?.rationale,
    kubernetesEvidence: intel.icp?.kubernetes?.detected ? intel.icp.kubernetes.evidence : undefined,
    onboardingDrivers: intel.onboarding?.drivers,
    painPoints: intel.painPoints,
    whyBito: intel.whyBito,
    citations: (intel.citations ?? []).map((c) => c.title),
  },
  swe,
  sweConfirmed: false,
  allowanceMo: 500,
  spendConfirmed: false,
  icpTotal: intel.icp?.total,
};

// Deterministic stand-ins for the model's fields — used only when the model
// can't be called. They exercise the renderer, the ordering and the guards
// (including a headline that SHOULD be rejected), not the prompt.
const sample = (mode: Mode): Fields => {
  const roi = computeRoi(base.swe, false, 500, false);
  const common = {
    company,
    engineers: base.swe,
    roi,
    generatedAt: new Date().toISOString(),
    positioningMode: mode,
  };
  return mode === "operational"
    ? {
        ...common,
        headline: `Giving Coding Agents System-Level Context Across ${company}'s Platform`,
        subtitle: "Governor grounds each agent request in the actual service architecture before it runs.",
        execSummary: [
          `[SAMPLE] ${company}'s platform spans many services across several clouds, so an agent task rediscovers service relationships before writing code.`,
          "[SAMPLE] Agents struggle because no single repository describes the system; Governor injects that context up front and routes each request consistently.",
          "[SAMPLE] The expected impact is less agent overhead per task and steadier quality as adoption grows.",
        ],
        cta: "[SAMPLE] Run an instrumented A/B on your repositories and schedule a short technical kickoff.",
      }
    : {
        ...common,
        execSummary: [
          "[SAMPLE] As coding agents scale across an engineering org, per-task token spend compounds.",
          "[SAMPLE] Governor reduces it by injecting context up front and routing to the right model.",
        ],
        environment: [`[SAMPLE] ${company} runs a multi-service cloud platform on Kubernetes across several providers.`],
        cta: "[SAMPLE] Replace these modeled assumptions with measured numbers in a controlled A/B, then schedule a kickoff.",
      };
};

let renderOnly = renderOnlyFlag || !process.env.ANTHROPIC_API_KEY;
const docs: Record<Mode, { fields: Fields; html: string }> = {} as never;
for (const mode of ["operational", "cost"] as const) {
  let fields: Fields | undefined;
  if (!renderOnly) {
    const t0 = Date.now();
    const r = await generateProposalFields({ ...base, positioningMode: mode });
    if (r.ok) {
      fields = r.fields;
      console.log(`${mode.toUpperCase()} generated by the model in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else {
      console.log(`${mode.toUpperCase()}: model call failed (${r.error}) — falling back to render-only for both modes`);
      renderOnly = true;
    }
  }
  if (!fields) {
    fields = sample(mode);
    console.log(`${mode.toUpperCase()} rendered from SAMPLE fields (render-only)`);
  }
  const html = buildProposalHtml(fields);
  docs[mode] = { fields, html };
  fs.writeFileSync(path.join(outDir, `${companyKey.replace(/\W+/g, "-")}-${mode}.html`), html);
  console.log(`  headline: ${h1(html)}`);
  console.log(`  sections: ${h2s(html).join(" → ")}`);
  console.log(`  summary¶1: ${fields.execSummary[0].slice(0, 160)}…\n`);
}
// If one mode fell back, re-render the other from samples too so the
// comparison is like-for-like.
if (renderOnly) {
  for (const mode of ["operational", "cost"] as const) {
    if (!docs[mode].fields.execSummary[0].startsWith("[SAMPLE]")) {
      const fields = sample(mode);
      docs[mode] = { fields, html: buildProposalHtml(fields) };
    }
  }
}

const op = docs.operational, co = docs.cost;
console.log(renderOnly ? "MODE: render-only (model not called)\n" : "MODE: live generation\n");

check(!carriesMoneyOrPct(h1(op.html)), "operational headline carries no dollar / percent figure", h1(op.html));
check(op.fields.headline !== undefined, "operational headline present (model-written in live mode)");
check(h2s(op.html)[0] === "Executive summary" && h2s(op.html)[1] === "How Governor works",
  "operational leads with summary then how-Governor-works");
const opRoiIdx = h2s(op.html).indexOf("Potential economic impact");
const opProofIdx = h2s(op.html).indexOf("Proof points");
check(base.swe ? opRoiIdx > opProofIdx : opRoiIdx === -1,
  "operational economics come AFTER proof points (secondary), when present", `idx ${opRoiIdx} vs proof ${opProofIdx}`);
check(op.fields.execSummary.length === 3, "operational summary has 3 paragraphs", String(op.fields.execSummary.length));
check(!carriesMoneyOrPct(op.fields.execSummary[0]), "operational opening paragraph carries no figure");

check(base.swe ? h1(co.html).includes("$") : true, "cost headline is dollar-led when an engineer count exists", h1(co.html));
check(bigCells(co.html).length > 0 === !!base.swe, "cost mode carries the quantified ROI table", `${bigCells(co.html).length} cells`);
const coRoiIdx = h2s(co.html).findIndex((h) => h.endsWith("s numbers"));
const coSolIdx = h2s(co.html).indexOf("How Governor works");
check(base.swe ? coRoiIdx !== -1 && coRoiIdx < coSolIdx : true, "cost economics come BEFORE how-Governor-works", `idx ${coRoiIdx} vs solution ${coSolIdx}`);
check(h2s(co.html).includes("Your engineering environment") === (co.fields.environment !== undefined),
  "cost renders its environment section when one was written");

check(h1(op.html) !== h1(co.html), "headlines differ between modes");
check(h2s(op.html).join("|") !== h2s(co.html).join("|"), "section order differs between modes");
check(op.fields.execSummary[0] !== co.fields.execSummary[0], "executive summaries differ between modes");
check(op.fields.cta !== co.fields.cta, "CTAs differ between modes");
const bannedDash = (f: Fields) => [...f.execSummary, f.cta, f.headline ?? "", ...(f.environment ?? [])].some((t) => t.includes("—"));
check(!bannedDash(op.fields) && !bannedDash(co.fields), "no em dashes in the personalized text");

// The renderer's own guard: an operational doc whose stored headline carries
// a figure must fall back to the generic operational title, never print it.
const poisoned = buildProposalHtml({ ...sample("operational"), headline: `$2.5M+ in Estimated Annual Savings on ${company}'s Bill` });
check(!carriesMoneyOrPct(h1(poisoned)) && h1(poisoned).startsWith("Giving Coding Agents"),
  "renderer rejects an operational headline that carries a figure", h1(poisoned));

// ---------------------------------------------------------------------------
// 2. Stored proposals with no mode still render exactly as captured.
// ---------------------------------------------------------------------------
if (baselineDir && fs.existsSync(baselineDir)) {
  for (const file of fs.readdirSync(baselineDir).filter((f) => f.endsWith(".html"))) {
    const token = file.replace(/\.html$/, "");
    const res = await fetch(`${U}/rest/v1/bito_proposals?select=fields&token=eq.${token}&limit=1`, { headers: H });
    const rows = (await res.json()) as { fields: Fields }[];
    if (!rows?.[0]) { check(false, `baseline ${token}: row not found`); continue; }
    const f = rows[0].fields;
    const before = fs.readFileSync(path.join(baselineDir, file), "utf8");
    const after = buildProposalHtml(f);
    const same =
      h1(before) === h1(after) &&
      h2s(before).join("|") === h2s(after).join("|") &&
      bigCells(before).join("|") === bigCells(after).join("|") &&
      bodyParas(before).join("|") === bodyParas(after).join("|");
    check(same, `legacy ${token.slice(0, 8)} (${f.company}, mode=${f.positioningMode ?? "none"}) renders identically`,
      same ? h2s(after).join(" → ") : `h1 ${h1(before) === h1(after)}, h2 ${h2s(before).join("|") === h2s(after).join("|")}, cells ${bigCells(before).join("|") === bigCells(after).join("|")}, paras ${bodyParas(before).join("|") === bodyParas(after).join("|")}`);
  }
} else {
  console.log("(no baseline dir given — legacy regression skipped)");
}

console.log(`\nRendered documents: ${outDir}`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
