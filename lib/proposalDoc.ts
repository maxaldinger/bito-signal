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

export interface ProposalFields {
  company: string;
  contactName?: string;
  /** Model-personalized executive-summary paragraphs (2-3). */
  execSummary: string[];
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

export function buildProposalHtml(f: ProposalFields): string {
  const company = esc(f.company);
  const first = f.contactName ? esc(f.contactName.split(" ")[0]) : "";
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

  const roi = f.roi
    ? `
    <section>
      <div class="sec-head"><span class="bar"></span><h2>${company}&rsquo;s numbers</h2></div>
      ${roiTable(f.roi)}
    </section>`
    : "";

  // Headline: LEAD with the estimated dollar savings (Max, Aug 28) — taken
  // from the most conservative row of the ROI table (the pilot tier at the
  // published −47%), so the number that hooks the reader is also the easiest
  // to defend. The "+" carries the upside (wider adoption, the measured
  // −83%). No engineer count → no dollar to anchor, keep the percent title.
  //
  // TIERS ONLY, deliberately: legacy single-cohort docs stored their savedAt47
  // on the WHOLE org, uncapped — Comcast's stored row would headline $321M,
  // the exact credibility torpedo the tier table replaced. Legacy docs keep
  // the percent title they were emailed with until an Update regenerates them.
  const baseTier = f.roi?.tiers?.[0];
  const headlineSave = baseTier?.savedAt47 ?? 0;
  const headlineEngineers = baseTier?.engineers ?? 0;
  const headlineScales = (f.roi?.tiers?.length ?? 0) > 1;
  const title =
    headlineSave > 0
      ? `${usdCompact(headlineSave)}+ in Estimated Annual Savings on ${company}&rsquo;s Agent Token Bill`
      : `48% Reduction in Agent Token Costs for ${company}`;
  const subline =
    headlineSave > 0
      ? `Estimated at Governor&rsquo;s published −47% per-task token reduction, on ${headlineEngineers.toLocaleString()}
    engineers on coding agents${headlineScales ? " — the table below scales it with adoption" : ""}. Governor,
    Bito&rsquo;s context-driven model router, manages both factors of your AI bill: it injects the right code context
    up front, then routes each request to the right model.`
      : `Inject the right code context up front, then route each request to the right model. Governor,
    Bito&rsquo;s context-driven model router, manages both factors of your AI bill.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Cutting agent token costs — prepared for ${company}</title>
<style>
  :root {
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
</style>
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

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Executive summary</h2></div>
      ${first ? `<p class="body">Hi ${first},</p>` : ""}
      ${exec}
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Our solution</h2></div>
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
      independent SWE-Bench Pro testing the same context engine lifted task success from <b>51.9% to 70.1%</b>.</p>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>How it works</h2></div>
      <div class="milestone"><h4>Day 1 — drop-in endpoint</h4><p>Update the base URL in your existing harness
      (Claude Code, Cursor, Codex, Copilot). Works direct to model providers or in front of your existing gateway,
      with zero behavioral change for your engineers and no disruption to active sprints.</p></div>
      <div class="milestone"><h4>Week 2 — codebase mapping</h4><p>AI Architect indexes your repositories into a
      continuously updated map of services, architectural patterns, and dependencies — deeper than vector search, and
      inside your security and compliance guardrails. Governor starts injecting that context up front.</p></div>
      <div class="milestone"><h4>Month 2 — instrumented A/B on your own workload</h4><p>The same work runs with and
      without Governor. You get a telemetry report showing the exact reduction in reasoning turns, tool calls, task
      time, and token cost — your benchmark, on your codebase, not ours.</p></div>
    </section>
    ${roi}
    <section>
      <div class="sec-head"><span class="bar"></span><h2>Proof points</h2></div>
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
      </ul>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Why Bito</h2></div>
      <p class="body">Both ends of your AI stack are moving targets: models leapfrog each other every few months and
      harnesses ship weekly. The one stable place to manage cost, quality, and policy is the layer between them.
      Model routing saves real money, and before long every vendor will offer a version of it. The deeper savings —
      reducing the token count itself — require a semantic understanding of your proprietary codebase. That&rsquo;s
      Bito&rsquo;s foundation, and Governor is where the context engine, the routing, and every future optimization
      live together.</p>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Next steps</h2></div>
      <div class="cta">${esc(f.cta)}</div>
    </section>

    <div class="foot">
      <span>Bito · bito.ai</span>
      <span>Prepared for ${company} · ${dateLong(f.generatedAt)}</span>
    </div>
  </div>
</body>
</html>`;
}
