// Print-ready, branded one-pager for the ROI calculator — same mechanism as
// lib/pocPdf.ts (self-contained HTML in a new tab → browser print → Save as
// PDF) and the same look as Bito's published Governor case study: letterhead,
// big headline, blue-header table, "Bito · bito.ai" footer. One page, built
// to be sent to a prospect as-is. All figures ANNUAL.

import { BITO_LOGO } from "./pocPdf";

export interface RoiPdfSimple {
  kind: "simple";
  engineers: number;
  allowanceMo: number;
  spendYr: number;
  /** Token-savings % chosen for this build (published: 47 typical, 68 heaviest). */
  savingsPct: number;
  grossSavings: number;
  newSpendYr: number;
  /** Bito's take as % of the savings (1–10). */
  feePct: number;
  bitoFee: number;
  netSavings: number;
  /** New token bill + Bito's fee — the customer's all-in cost. */
  allInYr: number;
}

export interface RoiPdfAdvanced {
  kind: "advanced";
  engineers: number;
  costPerEng: number;
  epicsPerMonth: number;
  storiesPerMonth: number;
  hrsPerEpic: number;
  hrsPerStory: number;
  qualityUpliftPct: number;
  aiSpend: number;
  tokenCutPct: number;
  planningHrsPerMonth: number;
  fteEquivalent: number;
  planningValue: number;
  tokenSavings: number;
  total: number;
  bitoCost: number;
  roiX: number | null;
  paybackMonths: number | null;
}

export type RoiPdfData = RoiPdfSimple | RoiPdfAdvanced;

const usd = (n: number) =>
  isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "—";

const todayLong = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

// Shared frame: the case-study letterhead + typography, one content slot.
function frame(title: string, eyebrow: string, subline: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
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
    font-size: 10.5pt; line-height: 1.45;
  }
  .sheet { max-width: 7.6in; margin: 18px auto; background: #fff; padding: 0.62in 0.66in; box-shadow: 0 6px 30px rgba(15,23,42,0.12); border-radius: 4px; }
  .toolbar { max-width: 7.6in; margin: 0 auto 4px; display: flex; gap: 12px; align-items: center; justify-content: space-between; color: #475569; font-size: 12.5px; padding: 2px 4px; }
  .toolbar button { font: inherit; font-weight: 700; cursor: pointer; background: var(--brand); color: #fff; border: 0; padding: 9px 18px; border-radius: 8px; }
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
  h1.title { margin: 0; font-size: 21pt; line-height: 1.12; letter-spacing: -0.015em; font-weight: 800; color: var(--ink); }
  .subline { margin: 10px 0 0; font-size: 9.5pt; color: var(--ink-3); }
  section { margin-top: 20px; break-inside: avoid; }
  .sec-head { display: flex; align-items: baseline; gap: 9px; margin-bottom: 9px; }
  .sec-head .bar { width: 16px; height: 3px; border-radius: 2px; background: var(--brand-bright); transform: translateY(-3px); }
  .sec-head h2 { margin: 0; font-size: 12.5pt; font-weight: 800; letter-spacing: -0.01em; }
  /* Case-study table: blue header row, zebra body */
  table.cs { width: 100%; border-collapse: collapse; font-size: 9.8pt; }
  table.cs thead th { background: var(--brand-bright); color: #fff; font-weight: 700; text-align: left; padding: 7px 12px; }
  table.cs thead th.num, table.cs td.num { text-align: right; white-space: nowrap; }
  table.cs tbody td { padding: 7px 12px; border-bottom: 1px solid var(--line); color: var(--ink); }
  table.cs tbody tr:nth-child(odd) td { background: #f7fafd; }
  table.cs tr.total td { font-weight: 800; border-top: 2px solid var(--brand-bright); border-bottom: 0; }
  table.cs td .sub { display: block; font-size: 8.3pt; color: var(--ink-3); }
  .big { color: var(--green); }
  p.body { margin: 0 0 9px; font-size: 9.6pt; color: var(--ink-2); }
  p.body b { color: var(--ink); }
  .chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .chip { border: 1px solid var(--line); border-radius: 8px; padding: 5px 10px; font-size: 8.8pt; color: var(--ink-2); background: #f7fafd; }
  .chip b { color: var(--brand); font-weight: 800; }
  .note { margin-top: 10px; font-size: 8.4pt; color: var(--ink-3); }
  .foot { margin-top: 24px; padding-top: 11px; border-top: 1px solid var(--line); font-size: 8pt; color: var(--ink-3); display: flex; justify-content: space-between; }
  .foot a { color: var(--ink-3); }
  @page { size: Letter; margin: 0.5in; }
</style>
</head>
<body>
  <div class="toolbar">
    <span>Review, then export — <b style="color:#1a2230">Print → Save as PDF</b> for the cleanest result.</span>
    <button onclick="window.print()">Download PDF</button>
  </div>
  <div class="sheet">
    <header class="letterhead">
      ${BITO_LOGO}
      <div class="lh-right">AI Architect<br/>ROI Estimate</div>
    </header>
    <div class="rule"></div>
    <p class="eyebrow">${eyebrow}</p>
    <h1 class="title">${title}</h1>
    <p class="subline">${subline}</p>
    ${body}
    <div class="foot">
      <span>Bito · bito.ai</span>
      <span>${todayLong()}</span>
    </div>
  </div>
</body>
</html>`;
}

// The published evidence paragraph both versions cite — mirrors the Governor
// case study ("78% of your AI coding bill is search").
const EVIDENCE = `
    <section>
      <div class="sec-head"><span class="bar"></span><h2>Where the numbers come from</h2></div>
      <p class="body">In a controlled ten-question agent session (run five times per configuration, identical model
      and caching), <b>78% of the bill went to the agent searching and re-reading code</b> before it could answer.
      Routed through Governor, Bito&rsquo;s context-driven model router, the same session cost <b>83% less</b> —
      tokens through the model fell 73%, tool calls 91%, file reads 95% — with <b>10/10 tasks completed vs 9/10</b> for
      the baseline.</p>
      <p class="body">Bito&rsquo;s published per-task figure is <b>−47%</b> (conservative); testing measured
      <b>up to −83%</b> on a full session. Quality is independently benchmarked: on SWE-Bench Pro the same agent fed
      Bito&rsquo;s code context completed <b>70.1% of tasks vs 51.9%</b> for the frontier baseline.</p>
      <div class="chips">
        <span class="chip"><b>−47%</b> token cost / task</span>
        <span class="chip"><b>−60%</b> reasoning steps / task</span>
        <span class="chip"><b>−49%</b> tool calls / task</span>
        <span class="chip"><b>51.9%→70.1%</b> task success (SWE-Bench Pro)</span>
      </div>
    </section>`;

function simpleBody(d: RoiPdfSimple): string {
  return `
    <section>
      <div class="sec-head"><span class="bar"></span><h2>The math</h2></div>
      <table class="cs">
        <thead><tr><th></th><th class="num">Annual</th></tr></thead>
        <tbody>
          <tr>
            <td>Current token spend<span class="sub">${d.engineers.toLocaleString()} engineers × ${usd(d.allowanceMo)}/month</span></td>
            <td class="num">${usd(d.spendYr)}</td>
          </tr>
          <tr>
            <td>Token-cost cut with grounded context<span class="sub">−47% conservative (published per task) · tested up to −83% on a full session</span></td>
            <td class="num">−${d.savingsPct}%</td>
          </tr>
          <tr>
            <td>Token bill brought down to</td>
            <td class="num">${usd(d.newSpendYr)}</td>
          </tr>
          <tr>
            <td>Bito&rsquo;s fee<span class="sub">${d.feePct}% of the ${usd(d.grossSavings)} saved — Bito only earns on what it saves you</span></td>
            <td class="num">−${usd(d.bitoFee)}</td>
          </tr>
          <tr class="total">
            <td>You keep, per year</td>
            <td class="num big">${usd(d.netSavings)}</td>
          </tr>
        </tbody>
      </table>
      <p class="note">All-in cost after Bito: ${usd(d.allInYr)}/yr (new token bill ${usd(d.newSpendYr)} + Bito&rsquo;s
      fee ${usd(d.bitoFee)}) — down from ${usd(d.spendYr)} today.</p>
    </section>
    ${EVIDENCE}
    <p class="note">Estimate from the stated headcount and per-engineer token allowance only. Time savings and
    quality impact (planning hours reclaimed, review time, defect rates) are additional and not included in this figure.</p>`;
}

function advancedBody(d: RoiPdfAdvanced): string {
  const roiRows =
    d.bitoCost > 0 && d.roiX !== null
      ? `
          <tr>
            <td>Bito annual cost</td>
            <td class="num">−${usd(d.bitoCost)}</td>
          </tr>
          <tr class="total">
            <td>Net impact · ROI · payback</td>
            <td class="num big">${usd(d.total - d.bitoCost)} · ${d.roiX.toFixed(1)}× · ${Math.round(d.paybackMonths ?? 0)} mo</td>
          </tr>`
      : "";
  return `
    <section>
      <div class="sec-head"><span class="bar"></span><h2>Assumptions</h2></div>
      <table class="cs">
        <thead><tr><th>Input</th><th class="num">Value</th></tr></thead>
        <tbody>
          <tr><td>Engineers in scope</td><td class="num">${d.engineers.toLocaleString()}</td></tr>
          <tr><td>Fully-loaded senior-engineer cost</td><td class="num">${usd(d.costPerEng)} / yr</td></tr>
          <tr><td>Technical planning analyzed<span class="sub">${d.epicsPerMonth} epics × ${d.hrsPerEpic}h + ${d.storiesPerMonth} stories × ${d.hrsPerStory}h, manual today</span></td><td class="num">~${Math.round(d.planningHrsPerMonth).toLocaleString()} hrs / mo</td></tr>
          <tr><td>Quality uplift on shipped work</td><td class="num">${d.qualityUpliftPct}%</td></tr>
          <tr><td>Current AI coding-tool spend</td><td class="num">${usd(d.aiSpend)} / yr</td></tr>
          <tr><td>Token-cost cut with grounded context</td><td class="num">−${d.tokenCutPct}%</td></tr>
        </tbody>
      </table>
    </section>
    <section>
      <div class="sec-head"><span class="bar"></span><h2>Estimated annual impact</h2></div>
      <table class="cs">
        <thead><tr><th></th><th class="num">Annual</th></tr></thead>
        <tbody>
          <tr>
            <td>Technical-planning time reclaimed<span class="sub">~${Math.round(d.planningHrsPerMonth).toLocaleString()} hrs/mo ≈ ${d.fteEquivalent.toFixed(1)} full-time senior engineers, incl. ${d.qualityUpliftPct}% quality uplift</span></td>
            <td class="num">${usd(d.planningValue)}</td>
          </tr>
          <tr>
            <td>Token-cost savings<span class="sub">${d.tokenCutPct}% of ${usd(d.aiSpend)}/yr</span></td>
            <td class="num">${usd(d.tokenSavings)}</td>
          </tr>
          <tr class="total">
            <td>Total estimated impact</td>
            <td class="num big">${usd(d.total)}</td>
          </tr>
          ${roiRows}
        </tbody>
      </table>
    </section>
    ${EVIDENCE}
    <p class="note">Hourly cost = fully-loaded ÷ 2,080 work hours. Model and defaults mirror Bito&rsquo;s published
    math (200-engineer team, $250K fully-loaded senior engineer, ~1,000 planning hrs/mo, ~6× ROI). In production at
    PubMatic (500+ repos, 450 engineers): technical design per large epic 2 weeks → 3 days; indexed repos grew
    merges +48% vs +4% control; 2× work shipped with no rise in reverts.</p>`;
}

/** Open the ROI estimate as a print-ready document in a new tab. */
export function openRoiPdf(d: RoiPdfData): boolean {
  const html =
    d.kind === "simple"
      ? frame(
          `${usd(d.netSavings)} back on the token bill`,
          "annual token-cost estimate",
          `${d.engineers.toLocaleString()} engineers · ${usd(d.allowanceMo)}/month token allowance each · −${d.savingsPct}% build · Bito at ${d.feePct}% of savings · all figures annual`,
          simpleBody(d),
        )
      : frame(
          `${usd(d.total)} of estimated annual impact`,
          "annual impact estimate",
          `${d.engineers.toLocaleString()} engineers · planning time + token economics · all figures annual`,
          advancedBody(d),
        );
  const w = window.open("", "_blank");
  if (!w) return false; // popup blocked
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
