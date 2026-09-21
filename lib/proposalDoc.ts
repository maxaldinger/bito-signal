// Personalized Governor proposal — the prospect-facing page served at the
// public /p/<token> link, modeled on the approved proposal doc (Aug 17:
// "48% Reduction in Agent Token Costs") and the Governor case-study PDF's
// branding. Canonical sections (solution, rollout, proof, why-Bito) live
// HERE as fixed copy so the model can never mangle a claim; only the
// executive summary and the closing CTA are model-personalized, and the ROI
// table is computed in code from the account's numbers.

import { BITO_LOGO } from "./pocPdf";

export interface ProposalRoiTier {
  engineers: number;
  label: string;
  spendYr: number;
  savedAt47: number;
  savedAt83: number;
}

export interface ProposalRoi {
  /** Token allowance per engineer per month (USD) — the $500 default
   *  assumption, or the account's real number when the rep set one. */
  allowanceMo: number;
  /** True when allowanceMo is the account's own figure (confirmed on a
   *  call), not the default assumption — changes the note's framing. */
  spendConfirmed?: boolean;
  /** Adoption-tier table (10% / 25% / 50% / full org for big estimates, a
   *  single row for small ones). The pilot row keeps it credible; the full
   *  row keeps the scale story — Max's call after a flat 2K cap undersold
   *  a 32,000-engineer bank. */
  tiers?: ProposalRoiTier[];
  sweEstimate?: number;
  /** Legacy single-cohort fields — proposals stored before the tier table
   *  still render from these. */
  engineers?: number;
  cappedFrom?: number;
  spendYr?: number;
  savedAt47?: number;
  newSpendAt47?: number;
  savedAt83?: number;
}

/** Which narrative the document tells. COST leads with the modeled economics
 *  (the original style); OPERATIONAL leads with the account's engineering
 *  environment and treats economics as a secondary section. */
export type PositioningMode = "cost" | "operational";

export interface ProposalFields {
  company: string;
  /** Recorded for the rep (which contact the doc was generated around) but
   *  deliberately NOT rendered: one proposal link goes to several people at
   *  the account, so a "Hi Rick," greeting is wrong for everyone else. */
  contactName?: string;
  /** Absent on proposals stored before the toggle existed. Those render in
   *  the ORIGINAL layout (cost-led, original section order) so links already
   *  sent out never change under the reader. */
  positioningMode?: PositioningMode;
  /** Model-written in OPERATIONAL mode only. Cost mode computes its headline
   *  from the ROI table and never lets the model write a number. */
  headline?: string;
  subtitle?: string;
  /** Model-personalized executive-summary paragraphs (2-3). */
  execSummary: string[];
  /** COST mode: 1-2 evidence-only paragraphs on the account's engineering
   *  environment, rendered as its own section after the summary. */
  environment?: string[];
  /** Model-personalized closing CTA paragraph. */
  cta: string;
  engineers?: number;
  employees?: number;
  roi?: ProposalRoi;
  generatedAt: string;
}

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const usd = (n: number) =>
  isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "—";

// Headline-sized money: $944K, $25.9M, $258M.
const usdCompact = (n: number): string => {
  if (!isFinite(n) || n <= 0) return "";
  if (n >= 1e6) {
    const m = n / 1e6;
    return `$${m >= 100 ? Math.round(m).toLocaleString("en-US") : String(Math.round(m * 10) / 10)}M`;
  }
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};

const dateLong = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

// The stylesheet, lifted verbatim from the original single-layout renderer so
// proposals stored before the positioning toggle render exactly as they did.
const STYLE_BLOCK = `  :root {
    --brand: #1480d6; --brand-bright: #2BAAFF;
    --ink: #1a2230; --ink-2: #46556a; --ink-3: #7a8699;
    --line: #e6eaf0; --tint: #eef6ff; --green: #15803d;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); background: #f3f4f6; -webkit-font-smoothing: antialiased;
    font-size: 10.8pt; line-height: 1.5;
  }
  .sheet { max-width: 7.6in; margin: 18px auto; background: #fff; padding: 0.62in 0.66in; box-shadow: 0 6px 30px rgba(15,23,42,0.12); border-radius: 4px; }
  .toolbar { max-width: 7.6in; margin: 0 auto 4px; display: flex; justify-content: flex-end; padding: 2px 4px; }
  .toolbar button { font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; background: var(--brand); color: #fff; border: 0; padding: 8px 16px; border-radius: 8px; }
  .toolbar button:hover { background: #0e6bb8; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none !important; }
    .sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
  }
  .letterhead { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 12px; }
  .logo { display: block; height: 30px; width: auto; }
  .lh-right { text-align: right; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3); }
  .rule { height: 3px; border-radius: 3px; margin: 0 0 22px; background: linear-gradient(90deg, var(--brand-bright), #6dd0ff 55%, transparent); }
  .eyebrow { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--brand); margin: 0 0 6px; }
  h1.title { margin: 0; font-size: 20pt; line-height: 1.14; letter-spacing: -0.015em; font-weight: 800; color: var(--ink); }
  .subline { margin: 10px 0 0; font-size: 9.5pt; color: var(--ink-3); }
  section { margin-top: 21px; break-inside: avoid; }
  .sec-head { display: flex; align-items: baseline; gap: 9px; margin-bottom: 9px; }
  .sec-head .bar { width: 16px; height: 3px; border-radius: 2px; background: var(--brand-bright); transform: translateY(-3px); }
  .sec-head h2 { margin: 0; font-size: 12.5pt; font-weight: 800; letter-spacing: -0.01em; }
  p.body { margin: 0 0 10px; font-size: 10pt; color: var(--ink-2); }
  p.body b, li b { color: var(--ink); }
  ul.plain { margin: 0 0 10px; padding-left: 18px; }
  ul.plain li { font-size: 10pt; color: var(--ink-2); margin-bottom: 5px; }
  .milestone { border: 1px solid var(--line); border-left: 3px solid var(--brand-bright); border-radius: 10px; padding: 11px 14px; margin-bottom: 8px; break-inside: avoid; }
  .milestone h4 { margin: 0 0 3px; font-size: 10.5pt; color: var(--brand); }
  .milestone p { margin: 0; font-size: 9.6pt; color: var(--ink-2); }
  table.cs { width: 100%; border-collapse: collapse; font-size: 9.8pt; }
  table.cs thead th { background: var(--brand-bright); color: #fff; font-weight: 700; text-align: left; padding: 7px 12px; }
  table.cs thead th.num, table.cs td.num { text-align: right; white-space: nowrap; }
  table.cs tbody td { padding: 7px 12px; border-bottom: 1px solid var(--line); color: var(--ink); }
  table.cs tbody tr:nth-child(odd) td { background: #f7fafd; }
  table.cs td .sub { display: block; font-size: 8.3pt; color: var(--ink-3); }
  .num.big { color: var(--green); font-weight: 800; }
  .note { margin-top: 9px; font-size: 8.4pt; color: var(--ink-3); }
  .cta { border: 1px solid var(--line); border-left: 3px solid var(--brand-bright); background: var(--tint); border-radius: 11px; padding: 14px 16px; font-size: 10pt; color: var(--ink); }
  .foot { margin-top: 24px; padding-top: 11px; border-top: 1px solid var(--line); font-size: 8pt; color: var(--ink-3); display: flex; justify-content: space-between; }
  @page { size: Letter; margin: 0.5in; }
`;

/** Operational headlines must never carry a dollar figure or a savings
 *  percentage; that is the whole point of the mode. Model output is checked
 *  here as well as in the generator, so a stored field can't sneak one in. */
const carriesMoneyOrPct = (t: string) => /\$|\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?[MK]\b/i.test(t);

export function buildProposalHtml(f: ProposalFields): string {
  const company = esc(f.company);
  // Three layouts, one renderer: "legacy" is a stored doc with no mode.
  const layout: "legacy" | PositioningMode = f.positioningMode ?? "legacy";
  const exec = (f.execSummary ?? [])
    .slice(0, 3)
    .map((p) => `<p class="body">${esc(p)}</p>`)
    .join("");

  const roiTable = (r: NonNullable<ProposalFields["roi"]>): string => {
    if (r.tiers?.length) {
      const rows = r.tiers
        .map(
          (t) => `
          <tr>
            <td>${t.engineers.toLocaleString()}<span class="sub">${esc(t.label)}</span></td>
            <td class="num">${usd(t.spendYr)}</td>
            <td class="num big">${usd(t.savedAt47)}</td>
            <td class="num big">${usd(t.savedAt83)}</td>
          </tr>`,
        )
        .join("");
      const spendLine = r.spendConfirmed
        ? `Uses the ${usd(r.allowanceMo)} per engineer per month in agent tokens your team shared;
      the instrumented A/B below replaces it with your measured per-task numbers.`
        : `Assumes ${usd(r.allowanceMo)} per engineer per month in agent tokens — an assumption to make the
      math concrete; the instrumented A/B below replaces it with your measured per-task numbers.`;
      return `
      <table class="cs">
        <thead><tr><th>Engineers on coding agents</th><th class="num">Token spend / yr</th><th class="num">Saved at −47%</th><th class="num">Saved at −83%</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">${spendLine} −47% is the published
      per-task figure; −83% was measured on a full working session.</p>`;
    }
    // Legacy single-cohort shape (proposals stored before the tier table).
    return `
      <table class="cs">
        <thead><tr><th></th><th class="num">Annual</th></tr></thead>
        <tbody>
          <tr>
            <td>Estimated token spend<span class="sub">${
              r.cappedFrom
                ? `modeled on the first ${(r.engineers ?? 0).toLocaleString()} engineers on coding agents (of ~${r.cappedFrom.toLocaleString()} estimated) × ${usd(r.allowanceMo)}/month — scales linearly with rollout`
                : `${(r.engineers ?? 0).toLocaleString()} engineers × ${usd(r.allowanceMo)}/month assumed allowance`
            }</span></td>
            <td class="num">${usd(r.spendYr ?? 0)}</td>
          </tr>
          <tr>
            <td>At Governor&rsquo;s published −47% per task<span class="sub">bill brought down to ${usd(r.newSpendAt47 ?? 0)}</span></td>
            <td class="num big">${usd(r.savedAt47 ?? 0)} saved</td>
          </tr>
          <tr>
            <td>At the −83% measured on a full working session</td>
            <td class="num big">${usd(r.savedAt83 ?? 0)} saved</td>
          </tr>
        </tbody>
      </table>
      <p class="note">The allowance is an assumption to make the math concrete — the instrumented A/B below replaces
      it with your real per-task numbers.</p>`;
  };

  // ---- Headline ------------------------------------------------------------
  // Cost / legacy: LEAD with the estimated dollar savings, taken from the most
  // conservative row of the ROI table (the pilot tier at the published −47%),
  // so the number that hooks the reader is also the easiest to defend. The
  // "+" carries the upside. No engineer count → no dollar to anchor → the
  // published percent title. TIERS ONLY: legacy single-cohort docs stored a
  // whole-org savedAt47 (Comcast's would headline $321M).
  //
  // Operational: the model wrote the headline from the account's engineering
  // research. It is never allowed to carry a figure.
  const baseTier = f.roi?.tiers?.[0];
  const headlineSave = baseTier?.savedAt47 ?? 0;
  const headlineEngineers = baseTier?.engineers ?? 0;
  const headlineScales = (f.roi?.tiers?.length ?? 0) > 1;
  const costTitle =
    headlineSave > 0
      ? `${usdCompact(headlineSave)}+ in Estimated Annual Savings on ${company}&rsquo;s Agent Token Bill`
      : `48% Reduction in Agent Token Costs for ${company}`;
  const costSubline =
    headlineSave > 0
      ? `Estimated at Governor&rsquo;s published −47% per-task token reduction, on ${headlineEngineers.toLocaleString()}
    engineers on coding agents${headlineScales ? " — the table below scales it with adoption" : ""}. Governor,
    Bito&rsquo;s context-driven model router, manages both factors of your AI bill: it injects the right code context
    up front, then routes each request to the right model.`
      : `Inject the right code context up front, then route each request to the right model. Governor,
    Bito&rsquo;s context-driven model router, manages both factors of your AI bill.`;
  const opHeadlineRaw = (f.headline ?? "").trim();
  const opTitle =
    opHeadlineRaw && !carriesMoneyOrPct(opHeadlineRaw)
      ? esc(opHeadlineRaw)
      : `Giving Coding Agents System-Level Context Across ${company}&rsquo;s Codebase`;
  const opSubtitleRaw = (f.subtitle ?? "").trim();
  const opSubline = opSubtitleRaw
    ? esc(opSubtitleRaw)
    : `Governor, Bito&rsquo;s context-driven model router, grounds every agent request in your actual service
    architecture before it runs, then routes it to the right model.`;
  const title = layout === "operational" ? opTitle : costTitle;
  const subline = layout === "operational" ? opSubline : costSubline;
  const docTitle =
    layout === "operational"
      ? `Governor proposal — prepared for ${company}`
      : `Cutting agent token costs — prepared for ${company}`;

  // ---- Sections ------------------------------------------------------------
  const sec = (heading: string, inner: string) => `
    <section>
      <div class="sec-head"><span class="bar"></span><h2>${heading}</h2></div>
      ${inner}
    </section>`;

  const execSection = sec("Executive summary", exec);

  const environmentSection =
    f.environment && f.environment.length > 0
      ? sec(
          "Your engineering environment",
          f.environment
            .slice(0, 2)
            .map((p) => `<p class="body">${esc(p)}</p>`)
            .join(""),
        )
      : "";

  const solutionInner = `
      <p class="body">Governor is a transparent layer between your engineering harness and your LLMs. You update the
      base URL in your existing harness to point at Governor — one base-URL swap — and nothing else in your
      developers&rsquo; workflow changes. Governor manages both multipliers of your AI bill at once: total token count
      and price per token.</p>
      <ul class="plain">
        <li><b>The Code Context Engine cuts token volume.</b> AI Architect maintains a continuously updated semantic
        map of your codebases. When an agent gets a task, Governor resolves it to the code that answers it and injects
        that context up front, so the agent skips most of the file reading and gets to the fix sooner: <b>47% lower
        token cost per task</b> in aggregate, up to 68% on individual tasks.</li>
        <li><b>The Model Router cuts price per token.</b> Once the right code is in the prompt, most requests stop
        needing frontier-grade reasoning, so each one is routed to the lowest-cost model that clears the quality bar —
        and frontier models are never pulled off the work that needs them.</li>
      </ul>
      <p class="body">Quality doesn&rsquo;t pay for it. In our customer A/B, task success was 100% in both arms; in
      independent SWE-Bench Pro testing the same context engine lifted task success from <b>51.9% to 70.1%</b>.</p>`;
  // The operational reader cares about what changes for an agent working in
  // their codebase, so the same mechanics are framed as workflow, not bill.
  const solutionInnerOperational = `
      <p class="body">Governor is a transparent layer between your engineering harness and your LLMs. You update the
      base URL in your existing harness to point at Governor — one base-URL swap — and nothing else in your
      developers&rsquo; workflow changes. What changes is what the agent knows before it starts.</p>
      <ul class="plain">
        <li><b>The Code Context Engine gives agents system-level context.</b> AI Architect maintains a continuously
        updated semantic map of your codebases: services, APIs, implementation patterns, cross-repo dependencies.
        When an agent gets a task, Governor resolves it to the code that answers it and injects that context up front,
        so the agent stops rediscovering the system through grep and file reads on every task and gets to the fix
        sooner: <b>47% lower token cost per task</b> in aggregate, up to 68% on individual tasks.</li>
        <li><b>The Model Router applies a consistent model policy.</b> Once the right code is in the prompt, most
        requests stop needing frontier-grade reasoning, so each one is routed to the lowest-cost model that clears the
        quality bar — and frontier models are never pulled off the work that needs them. One place to govern which
        models do which work, instead of a per-developer guess.</li>
      </ul>
      <p class="body">Quality doesn&rsquo;t pay for it. In our customer A/B, task success was 100% in both arms; in
      independent SWE-Bench Pro testing the same context engine lifted task success from <b>51.9% to 70.1%</b>.</p>`;

  const milestonesInner = `
      <div class="milestone"><h4>Day 1 — drop-in endpoint</h4><p>Update the base URL in your existing harness
      (Claude Code, Cursor, Codex, Copilot). Works direct to model providers or in front of your existing gateway,
      with zero behavioral change for your engineers and no disruption to active sprints.</p></div>
      <div class="milestone"><h4>Week 2 — codebase mapping</h4><p>AI Architect indexes your repositories into a
      continuously updated map of services, architectural patterns, and dependencies — deeper than vector search, and
      inside your security and compliance guardrails. Governor starts injecting that context up front.</p></div>
      <div class="milestone"><h4>Month 2 — instrumented A/B on your own workload</h4><p>The same work runs with and
      without Governor. You get a telemetry report showing the exact reduction in reasoning turns, tool calls, task
      time, and token cost — your benchmark, on your codebase, not ours.</p></div>`;

  const validationInner = `
      <p class="body">Nothing in this document asks you to take a benchmark on faith. The validation is an instrumented
      A/B on your own repositories: the same set of real tasks runs with and without Governor, on the same model and
      the same caching, and every run is measured on reasoning turns, tool calls, tokens through the model, task time,
      cost per task, and task success. You keep the telemetry. If the numbers on your codebase don&rsquo;t hold, the
      conversation ends there.</p>`;

  const proofInner = `
      <ul class="plain">
        <li>Controlled customer A/B, identical tasks on Claude Code: cost per task <b>$4.12 → $2.14 (−48%)</b>,
        reasoning turns halved (47.6 → 23.6), tool calls −53%, tasks 36% faster. Task success 100% in both arms.</li>
        <li>Full ten-ask working session, five runs per arm, same model and caching: <b>$6.81 → $1.13 (−83%)</b>,
        tokens through the model 5.3M → 1.4M, 10/10 tasks vs 9/10 for the baseline.</li>
        <li>SWE-Bench Pro (independent, The Context Lab): task success <b>51.9% → 70.1%</b> with Governor&rsquo;s code
        context.</li>
        <li>In production: PubMatic (500+ repos, 450 engineers) cut technical design per large epic from
        <b>2 weeks to 3 days</b>; Privado shipped an enterprise SSO project in <b>5 hours</b> against a 7–10 day
        estimate.</li>
      </ul>`;

  const whyBitoInner = `
      <p class="body">Both ends of your AI stack are moving targets: models leapfrog each other every few months and
      harnesses ship weekly. The one stable place to manage cost, quality, and policy is the layer between them.
      Model routing saves real money, and before long every vendor will offer a version of it. The deeper savings —
      reducing the token count itself — require a semantic understanding of your proprietary codebase. That&rsquo;s
      Bito&rsquo;s foundation, and Governor is where the context engine, the routing, and every future optimization
      live together.</p>`;

  const nextSection = sec("Next steps", `<div class="cta">${esc(f.cta)}</div>`);

  // The economics: primary in cost mode, explicitly secondary in operational.
  const roiSection = (heading: string, intro: string) =>
    f.roi ? sec(heading, `${intro}${roiTable(f.roi)}`) : "";
  const roiCost = roiSection(`${company}&rsquo;s numbers`, "");
  const roiOperational = roiSection(
    "Potential economic impact",
    `<p class="body">Secondary to the operational case above: solving the context problem also changes the bill.
      The figures below are modeled from the stated headcount and a per-engineer allowance assumption, not measured
      spend, and the instrumented A/B replaces them with your own numbers.</p>`,
  );

  let body: string;
  if (layout === "legacy") {
    // The original layout, unchanged, for proposals stored before the toggle.
    body = [
      execSection,
      sec("Our solution", solutionInner),
      sec("How it works", milestonesInner),
      roiCost,
      sec("Proof points", proofInner),
      sec("Why Bito", whyBitoInner),
      nextSection,
    ].join("");
  } else if (layout === "cost") {
    // Financial outcome → why costs rise → their environment → the economic
    // model → how Governor works → proof → validation → next step.
    body = [
      execSection,
      environmentSection,
      roiCost,
      sec("How Governor works", solutionInner),
      sec("Rollout", milestonesInner),
      sec("Proof points", proofInner),
      sec("Validation", validationInner),
      sec("Why Bito", whyBitoInner),
      nextSection,
    ].join("");
  } else {
    // Environment → friction → why agents struggle → what Governor changes →
    // impact → evidence → economics LAST.
    body = [
      execSection,
      sec("How Governor works", solutionInnerOperational),
      sec("Rollout", milestonesInner),
      sec("Proof points", proofInner),
      sec("Validation", validationInner),
      roiOperational,
      sec("Why Bito", whyBitoInner),
      nextSection,
    ].join("");
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${docTitle}</title>
<style>
${STYLE_BLOCK}</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Download PDF</button></div>
  <div class="sheet">
    <header class="letterhead">
      ${BITO_LOGO}
      <div class="lh-right">Governor<br/>Proposal</div>
    </header>
    <div class="rule"></div>

    <p class="eyebrow">prepared for ${company} · ${dateLong(f.generatedAt)}</p>
    <h1 class="title">${title}</h1>
    <p class="subline">${subline}</p>
${body}

    <div class="foot">
      <span>Bito · bito.ai</span>
      <span>Prepared for ${company} · ${dateLong(f.generatedAt)}</span>
    </div>
  </div>
</body>
</html>`;
}
