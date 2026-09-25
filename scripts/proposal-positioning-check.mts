// Positioning check for personalized proposals — run after touching
// lib/proposalGen.ts or lib/proposalDoc.ts.
//
//   1. Generates the DUAL document for one account from its cached brief
//      (two real model calls, in parallel) and renders it. With --render-only
//      (or when the local ANTHROPIC key is dead) it renders deterministic
//      sample narratives instead, which still proves the tabs, the two
//      layouts, the ordering and the guards.
//   2. Asserts the two panes are materially different: headline, executive
//      summary, section order; that the OPERATIONAL pane never leads with a
//      dollar figure; that the ROI pane still carries the quantified table;
//      that the page has the Operational | ROI tabs with Operational open.
//   3. Re-renders stored proposals (legacy, no narratives) and compares their
//      structure against baseline HTML captured before the change, so links
//      already in prospects' inboxes keep their shape. Their fixed sections
//      now drop the A/B language by design (Sep 25), so body paragraphs are
//      reported, not required to match.
//
// Usage: npx tsx scripts/proposal-positioning-check.mts [company_key] [baselineDir] [--render-only]

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
const H = { apikey: SVC, Authorization: `Bearer ${SVC}` };

const { generateProposalFields, computeRoi } = await import("../lib/proposalGen.ts");
const { buildProposalHtml } = await import("../lib/proposalDoc.ts");
type Fields = import("../lib/proposalDoc.ts").ProposalFields;
type Narrative = import("../lib/proposalDoc.ts").ProposalNarrative;

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
/** The HTML of one tab pane. */
const pane = (html: string, key: string): string => {
  const start = html.indexOf(`<div class="pane" data-pane="${key}"`);
  if (start === -1) return "";
  const rest = html.slice(start + 1);
  const next = rest.search(/<div class="pane" data-pane=|<script>/);
  return next === -1 ? html.slice(start) : html.slice(start, start + 1 + next);
};

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------------------
// 1. The dual document from one brief.
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

const input = {
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

// Deterministic stand-ins for the model's narratives — used only when the
// model can't be called. They exercise the renderer, the tabs, the ordering
// and the guards, not the prompt.
const sampleNarratives = (): { operational: Narrative; cost: Narrative } => ({
  operational: {
    headline: `Giving Coding Agents System-Level Context Across ${company}'s Platform`,
    subtitle: "Governor grounds each agent request in the actual service architecture before it runs.",
    execSummary: [
      `[SAMPLE] ${company}'s platform spans many services across several clouds, so an agent task rediscovers service relationships before writing code.`,
      "[SAMPLE] Agents struggle because no single repository describes the system; Governor injects that context up front and routes each request consistently.",
      "[SAMPLE] The expected impact is less agent overhead per task and steadier quality as adoption grows.",
    ],
    cta: "[SAMPLE] Start with one team on your repositories and schedule a short technical kickoff.",
  },
  cost: {
    execSummary: [
      "[SAMPLE] As coding agents scale across an engineering org, per-task token spend compounds.",
      "[SAMPLE] Governor reduces it by injecting context up front and routing to the right model.",
    ],
    environment: [`[SAMPLE] ${company} runs a multi-service cloud platform on Kubernetes across several providers.`],
    cta: "[SAMPLE] Start with one team and revisit these modeled assumptions against your actual spend, then schedule a kickoff.",
  },
});
const sampleFields = (): Fields => {
  const n = sampleNarratives();
  return {
    company,
    engineers: swe,
    roi: computeRoi(swe, false, 500, false),
    generatedAt: new Date().toISOString(),
    narratives: n,
    positioningMode: "operational",
    headline: n.operational.headline,
    subtitle: n.operational.subtitle,
    execSummary: n.operational.execSummary,
    cta: n.operational.cta,
  };
};

let renderOnly = renderOnlyFlag || !process.env.ANTHROPIC_API_KEY;
let fields: Fields | undefined;
if (!renderOnly) {
  const t0 = Date.now();
  const r = await generateProposalFields(input);
  if (r.ok) {
    fields = r.fields;
    console.log(`Both narratives generated by the model in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else {
    console.log(`Model call failed (${r.error}) — falling back to render-only`);
    renderOnly = true;
  }
}
if (!fields) {
  fields = sampleFields();
  console.log("Rendered from SAMPLE narratives (render-only)");
}
const html = buildProposalHtml(fields);
fs.writeFileSync(path.join(outDir, `${companyKey.replace(/\W+/g, "-")}-dual.html`), html);
const op = pane(html, "operational");
const co = pane(html, "cost");
console.log(`MODE: ${renderOnly ? "render-only (model not called)" : "live generation"}`);
console.log(`  operational: ${h1(op)}`);
console.log(`     sections: ${h2s(op).join(" → ")}`);
console.log(`  roi:         ${h1(co)}`);
console.log(`     sections: ${h2s(co).join(" → ")}\n`);

// Tabs and panes.
check(/<button type="button" role="tab" class="tab active" data-pane="operational">Operational<\/button>/.test(html),
  "Operational tab present and active by default");
check(/<button type="button" role="tab" class="tab" data-pane="cost">ROI<\/button>/.test(html), "ROI tab present");
check(op.length > 0 && co.length > 0, "both panes rendered");
check(/<div class="pane" data-pane="cost" hidden>/.test(html), "ROI pane hidden until its tab is clicked");
check(html.includes("location.hash==='#roi'"), "#roi in the URL opens the ROI tab");
check(html.includes(".pane[hidden] { display: none !important; }"), "print hides the inactive pane");
check(fields.narratives !== undefined, "stored fields carry both narratives");

// Operational pane.
check(!carriesMoneyOrPct(h1(op)), "operational headline carries no dollar / percent figure", h1(op));
check(h2s(op)[0] === "Executive summary" && h2s(op)[1] === "How Governor works", "operational leads with summary then how-Governor-works");
const opRoiIdx = h2s(op).indexOf("Potential economic impact");
const opProofIdx = h2s(op).indexOf("Proof points");
check(swe ? opRoiIdx > opProofIdx : opRoiIdx === -1, "operational economics come AFTER proof points (secondary)", `idx ${opRoiIdx} vs proof ${opProofIdx}`);
check((fields.narratives?.operational.execSummary.length ?? 0) === 3, "operational summary has 3 paragraphs");
check(!carriesMoneyOrPct(fields.narratives?.operational.execSummary[0] ?? ""), "operational opening paragraph carries no figure");

// ROI pane.
check(swe ? h1(co).includes("$") : true, "ROI headline is dollar-led when an engineer count exists", h1(co));
check(bigCells(co).length > 0 === !!swe, "ROI pane carries the quantified table", `${bigCells(co).length} cells`);
const coRoiIdx = h2s(co).findIndex((h) => h.endsWith("s numbers"));
const coSolIdx = h2s(co).indexOf("How Governor works");
check(swe ? coRoiIdx !== -1 && coRoiIdx < coSolIdx : true, "ROI economics come BEFORE how-Governor-works", `idx ${coRoiIdx} vs solution ${coSolIdx}`);
check(h2s(co).includes("Your engineering environment") === (fields.narratives?.cost.environment !== undefined),
  "ROI pane renders its environment section when one was written");

// Materially different.
check(h1(op) !== h1(co), "headlines differ between panes");
check(h2s(op).join("|") !== h2s(co).join("|"), "section order differs between panes");
check(fields.narratives?.operational.execSummary[0] !== fields.narratives?.cost.execSummary[0], "executive summaries differ between panes");
check(fields.narratives?.operational.cta !== fields.narratives?.cost.cta, "CTAs differ between panes");
const dashes = (n: Narrative) => [...n.execSummary, n.cta, n.headline ?? "", ...(n.environment ?? [])].some((t) => t.includes("—"));
check(!dashes(fields.narratives!.operational) && !dashes(fields.narratives!.cost), "no em dashes in the personalized text");

// No A/B offer anywhere in the rendered document (Max, Sep 25: Bito does not
// run customer A/B tests, so the documents must not promise one).
const abLanguage = /\bA\/B\b|both arms|per arm|instrumented|bake-?off|>Validation<\/h2>/i;
check(!abLanguage.test(html), "rendered document carries no A/B / validation-test language", html.match(abLanguage)?.[0] ?? "");

// Guards and back-compat.
const poisoned = sampleFields();
poisoned.narratives!.operational.headline = `$2.5M+ in Estimated Annual Savings on ${company}'s Bill`;
const poisonedOp = pane(buildProposalHtml(poisoned), "operational");
check(!carriesMoneyOrPct(h1(poisonedOp)) && h1(poisonedOp).startsWith("Giving Coding Agents"),
  "renderer rejects an operational headline that carries a figure", h1(poisonedOp));
const single: Fields = { ...sampleFields(), narratives: undefined, positioningMode: "operational" };
const singleHtml = buildProposalHtml(single);
check(!singleHtml.includes('class="tabs"') && h2s(singleHtml)[1] === "How Governor works",
  "a single-narrative document (no narratives stored) renders one layout, no tabs");

// ---------------------------------------------------------------------------
// 2. Stored proposals with no narratives still render exactly as captured.
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
    const parasChanged = bodyParas(after).filter((p, i) => p !== bodyParas(before)[i]).length;
    // The FIXED sections must be A/B-free for every old link. The stored
    // narrative is model text written under the old prompt; it is reported
    // here and regenerated by "Update", not by the renderer.
    const blank = <T extends Narrative | Fields>(n: T): T =>
      ({ ...n, cta: "", execSummary: [], headline: undefined, subtitle: undefined, environment: undefined }) as T;
    const fixedOnly = buildProposalHtml({
      ...blank(f),
      narratives: f.narratives ? { operational: blank(f.narratives.operational), cost: blank(f.narratives.cost) } : undefined,
    });
    const texts = (n?: Narrative | Fields) =>
      n ? [n.cta ?? "", ...(n.execSummary ?? []), n.headline ?? "", n.subtitle ?? "", ...(n.environment ?? [])] : [];
    const storedAb = [...texts(f), ...texts(f.narratives?.operational), ...texts(f.narratives?.cost)].some((t) => abLanguage.test(t));
    const same =
      h1(before) === h1(after) &&
      h2s(before).join("|") === h2s(after).join("|") &&
      bigCells(before).join("|") === bigCells(after).join("|") &&
      !after.includes('class="tabs"') &&
      !abLanguage.test(fixedOnly);
    check(same, `legacy ${token.slice(0, 8)} (${f.company}, mode=${f.positioningMode ?? "none"}) keeps its structure, no tabs, fixed sections A/B-free`,
      same
        ? `${h2s(after).join(" → ")} · ${parasChanged} fixed paragraph(s) reworded${storedAb ? " · stored narrative still mentions A/B: click Update to regenerate" : ""}`
        : `h1 ${h1(before) === h1(after)}, h2 ${h2s(before).join("|") === h2s(after).join("|")}, cells ${bigCells(before).join("|") === bigCells(after).join("|")}, fixed ab-free ${!abLanguage.test(fixedOnly)}, paras changed ${parasChanged}`);
  }
} else {
  console.log("(no baseline dir given — legacy regression skipped)");
}

console.log(`\nRendered document: ${outDir}`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
