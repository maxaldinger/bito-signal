// Build a self-contained, print-optimized HTML document for an AI Architect
// Proof-of-Concept plan, then open it in a new tab and trigger the browser's
// print dialog (Save as PDF). Going through print gives vector-quality type and
// pixel-perfect layout with zero PDF dependencies — the resulting PDF is exactly
// what a rep sends a prospect.

export interface PocPlan {
  company: string;
  headline: string;
  successLooksLike: { outcome: string; proof: string }[];
  complexityThreshold: {
    minRepos: number;
    minLoc: string;
    rationale: string;
    fit: "strong" | "adequate" | "under-scoped" | string;
    fitNote: string;
  };
  metrics: { name: string; how: string; why: string; unlock?: boolean }[];
  moments: { definition: string; examples: string[] };
  timeline: { phase: string; activities: string[]; checkpoint: string }[];
  roi: { anchor: string; yourVersion: string; framing?: string };
  roles: { customer: string[]; bito: string[] };
  checklist: string[];
  nextSteps: string[];
}

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const todayLong = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const fitBadge = (fit: string) => {
  const f = (fit || "").toLowerCase();
  if (f.includes("strong")) return { label: "Strong fit", cls: "fit-strong" };
  if (f.includes("under")) return { label: "Under-scoped", cls: "fit-under" };
  return { label: "Adequate", cls: "fit-ok" };
};

function buildPocHtml(p: PocPlan): string {
  const company = esc(p.company || "Your team");
  const fit = fitBadge(p.complexityThreshold?.fit || "");

  const successCards = (p.successLooksLike || [])
    .map(
      (s, i) => `
      <div class="card success">
        <div class="card-num">${i + 1}</div>
        <div>
          <p class="card-title">${esc(s.outcome)}</p>
          <p class="card-body">${esc(s.proof)}</p>
        </div>
      </div>`,
    )
    .join("");

  const metricCards = (p.metrics || [])
    .map(
      (m) => `
      <div class="metric ${m.unlock ? "metric-unlock" : ""}">
        ${m.unlock ? `<span class="unlock-tag">The unlock</span>` : ""}
        <p class="metric-name">${esc(m.name)}</p>
        <p class="metric-how"><span class="lbl">Measured</span> ${esc(m.how)}</p>
        <p class="metric-why"><span class="lbl">Why it lands</span> ${esc(m.why)}</p>
      </div>`,
    )
    .join("");

  const momentItems = (p.moments?.examples || [])
    .map((e) => `<li>${esc(e)}</li>`)
    .join("");

  const timelineCols = (p.timeline || [])
    .map(
      (t) => `
      <div class="week">
        <h4>${esc(t.phase)}</h4>
        <ul class="acts">${(t.activities || []).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        <div class="checkpoint">
          <span class="cp-label">Checkpoint</span>
          ${esc(t.checkpoint)}
        </div>
      </div>`,
    )
    .join("");

  const list = (items: string[]) =>
    (items || []).map((x) => `<li>${esc(x)}</li>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI Architect — POC Plan — ${company}</title>
<style>
  :root {
    --brand: #059669;
    --brand-dark: #047857;
    --ink: #0f172a;
    --ink-2: #334155;
    --ink-3: #64748b;
    --line: #e2e8f0;
    --tint: #ecfdf5;
    --amber: #b45309;
    --red: #b91c1c;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    background: #fff;
    -webkit-font-smoothing: antialiased;
    font-size: 11pt;
    line-height: 1.5;
  }
  .doc { max-width: 7.5in; margin: 0 auto; padding: 0.2in 0.1in; }

  /* Toolbar (screen only) */
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 12px; align-items: center; justify-content: space-between;
    background: #0b1220; color: #cbd5e1;
    padding: 12px 18px; border-radius: 10px; margin-bottom: 22px;
    font-size: 13px;
  }
  .toolbar button {
    font: inherit; font-weight: 600; cursor: pointer;
    background: var(--brand); color: #fff; border: 0;
    padding: 9px 16px; border-radius: 8px;
  }
  .toolbar button:hover { background: var(--brand-dark); }
  @media print { .toolbar { display: none !important; } .doc { max-width: none; padding: 0; } }

  /* Cover */
  .cover { padding: 0.35in 0 0.5in; border-bottom: 1px solid var(--line); margin-bottom: 0.4in; }
  .wordmark {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 10.5pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--brand-dark);
  }
  .wordmark .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--brand); display: inline-block; }
  .eyebrow { margin: 26px 0 6px; font-size: 10.5pt; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); }
  h1.title { margin: 0; font-size: 30pt; line-height: 1.1; letter-spacing: -0.015em; font-weight: 800; color: var(--ink); }
  .cover-meta { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 22px; font-size: 10pt; color: var(--ink-3); }
  .cover-meta b { color: var(--ink-2); font-weight: 600; }

  /* Sections */
  section { margin: 0.34in 0; }
  .sec-head { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; }
  .sec-head .bar { width: 4px; height: 18px; border-radius: 2px; background: var(--brand); }
  .sec-head h2 { margin: 0; font-size: 15pt; font-weight: 800; letter-spacing: -0.01em; }
  .sec-sub { margin: -6px 0 14px 14px; color: var(--ink-3); font-size: 10pt; }

  /* Success cards */
  .card { display: flex; gap: 14px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; margin-bottom: 10px; break-inside: avoid; }
  .card-num { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 7px; background: var(--tint); color: var(--brand-dark); font-weight: 800; font-size: 12pt; display: flex; align-items: center; justify-content: center; }
  .card-title { margin: 0 0 3px; font-weight: 700; font-size: 11.5pt; }
  .card-body { margin: 0; color: var(--ink-2); font-size: 10pt; }

  /* Complexity threshold */
  .threshold { border: 1px solid var(--line); border-left: 4px solid var(--brand); border-radius: 12px; padding: 18px 20px; background: linear-gradient(180deg, var(--tint), #fff); break-inside: avoid; }
  .threshold .nums { display: flex; gap: 28px; margin-bottom: 12px; }
  .threshold .num b { display: block; font-size: 22pt; font-weight: 800; color: var(--brand-dark); line-height: 1; }
  .threshold .num span { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-3); }
  .threshold p { margin: 0 0 12px; color: var(--ink-2); font-size: 10pt; }
  .fit-row { display: flex; align-items: center; gap: 10px; padding-top: 12px; border-top: 1px solid var(--line); }
  .fit-badge { font-size: 8.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; padding: 4px 10px; border-radius: 999px; }
  .fit-strong { background: #dcfce7; color: #166534; }
  .fit-ok { background: #fef3c7; color: var(--amber); }
  .fit-under { background: #fee2e2; color: var(--red); }
  .fit-note { font-size: 10pt; color: var(--ink-2); margin: 0; }

  /* Metrics grid */
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .metric { position: relative; border: 1px solid var(--line); border-radius: 12px; padding: 15px 16px; break-inside: avoid; }
  .metric-unlock { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand) inset; background: var(--tint); }
  .unlock-tag { position: absolute; top: -9px; right: 14px; background: var(--brand); color: #fff; font-size: 7.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; padding: 3px 8px; border-radius: 999px; }
  .metric-name { margin: 0 0 8px; font-weight: 700; font-size: 11pt; }
  .metric-how, .metric-why { margin: 0 0 5px; font-size: 9.5pt; color: var(--ink-2); }
  .lbl { display: inline-block; font-size: 7.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); margin-right: 5px; }

  /* Moments */
  .def { font-size: 10.5pt; color: var(--ink-2); margin: 0 0 12px; padding: 12px 16px; border-radius: 10px; background: #f8fafc; border: 1px solid var(--line); }
  ul.moments { margin: 0; padding-left: 0; list-style: none; }
  ul.moments li { position: relative; padding: 9px 0 9px 26px; border-bottom: 1px dashed var(--line); font-size: 10pt; color: var(--ink); }
  ul.moments li:last-child { border-bottom: 0; }
  ul.moments li::before { content: "→"; position: absolute; left: 4px; color: var(--brand); font-weight: 800; }

  /* Timeline */
  .weeks { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .week { border: 1px solid var(--line); border-radius: 12px; padding: 16px; break-inside: avoid; }
  .week h4 { margin: 0 0 10px; font-size: 12pt; color: var(--brand-dark); }
  ul.acts { margin: 0 0 12px; padding-left: 18px; }
  ul.acts li { font-size: 9.5pt; color: var(--ink-2); margin-bottom: 4px; }
  .checkpoint { background: var(--tint); border-radius: 9px; padding: 10px 12px; font-size: 9.5pt; color: var(--ink); font-weight: 600; }
  .cp-label { display: block; font-size: 7.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--brand-dark); margin-bottom: 3px; }

  /* ROI */
  .roi { border-radius: 14px; padding: 26px 28px; background: #0b1220; color: #e2e8f0; break-inside: avoid; }
  .roi .anchor { font-size: 17pt; font-weight: 800; line-height: 1.25; letter-spacing: -0.01em; color: #fff; margin: 0 0 14px; }
  .roi .anchor .hl { color: #34d399; }
  .roi .your { font-size: 10.5pt; color: #94a3b8; margin: 0; padding-top: 14px; border-top: 1px solid #1e293b; }
  .roi .framing { font-size: 10pt; color: #cbd5e1; margin: 0 0 4px; }

  /* Two-up lists */
  .twoup { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  .block h3 { margin: 0 0 8px; font-size: 11pt; }
  ul.plain { margin: 0; padding-left: 18px; }
  ul.plain li { font-size: 10pt; color: var(--ink-2); margin-bottom: 5px; }

  .foot { margin-top: 0.4in; padding-top: 14px; border-top: 1px solid var(--line); font-size: 8.5pt; color: var(--ink-3); display: flex; justify-content: space-between; }

  @page { size: Letter; margin: 0.6in; }
  .pb { break-before: page; }
</style>
</head>
<body>
<div class="doc">
  <div class="toolbar">
    <span>Review the plan, then export. <b style="color:#fff">File → Print → Save as PDF</b> for the cleanest result.</span>
    <button onclick="window.print()">Download PDF</button>
  </div>

  <header class="cover">
    <span class="wordmark"><span class="dot"></span>Bito · AI Architect</span>
    <p class="eyebrow">Proof-of-Concept Plan · 2-Week Trial</p>
    <h1 class="title">${esc(p.headline || "A trial designed to be felt, not evaluated")}</h1>
    <div class="cover-meta">
      <span><b>Prepared for</b> &nbsp;${company}</span>
      <span><b>Date</b> &nbsp;${todayLong()}</span>
      <span><b>Window</b> &nbsp;2 weeks from knowledge-graph readiness</span>
    </div>
  </header>

  <section>
    <div class="sec-head"><span class="bar"></span><h2>What success looks like</h2></div>
    <p class="sec-sub">Outcomes your team will feel — not a list of features to tick.</p>
    ${successCards}
  </section>

  <section>
    <div class="sec-head"><span class="bar"></span><h2>Trial scope &amp; the complexity threshold</h2></div>
    <div class="threshold">
      <div class="nums">
        <div class="num"><b>${esc(p.complexityThreshold?.minRepos || "—")}</b><span>repositories (min)</span></div>
        <div class="num"><b>${esc(p.complexityThreshold?.minLoc || "—")}</b><span>lines of code (min)</span></div>
      </div>
      <p>${esc(p.complexityThreshold?.rationale)}</p>
      <div class="fit-row">
        <span class="fit-badge ${fit.cls}">${fit.label}</span>
        <p class="fit-note">${esc(p.complexityThreshold?.fitNote)}</p>
      </div>
    </div>
  </section>

  <section>
    <div class="sec-head"><span class="bar"></span><h2>What we'll measure</h2></div>
    <p class="sec-sub">This can't be vibes. Four numbers, captured on indexed vs. non-indexed work.</p>
    <div class="grid">${metricCards}</div>
  </section>

  <section class="pb">
    <div class="sec-head"><span class="bar"></span><h2>Moments, not vibes</h2></div>
    <p class="def">${esc(p.moments?.definition)}</p>
    <ul class="moments">${momentItems}</ul>
  </section>

  <section>
    <div class="sec-head"><span class="bar"></span><h2>Timeline &amp; checkpoints</h2></div>
    <div class="weeks">${timelineCols}</div>
  </section>

  <section>
    <div class="sec-head"><span class="bar"></span><h2>The ROI anchor</h2></div>
    <div class="roi">
      <p class="anchor">${esc(p.roi?.anchor)}</p>
      ${p.roi?.framing ? `<p class="framing">${esc(p.roi.framing)}</p>` : ""}
      <p class="your">${esc(p.roi?.yourVersion)}</p>
    </div>
  </section>

  <section>
    <div class="sec-head"><span class="bar"></span><h2>Roles, checklist &amp; next steps</h2></div>
    <div class="twoup">
      <div class="block">
        <h3>Roles &amp; ownership</h3>
        <ul class="plain">${list(p.roles?.customer)}${list(p.roles?.bito)}</ul>
      </div>
      <div class="block">
        <h3>Pre-trial checklist</h3>
        <ul class="plain">${list(p.checklist)}</ul>
      </div>
    </div>
    <div class="block" style="margin-top:18px">
      <h3>Next steps</h3>
      <ul class="plain">${list(p.nextSteps)}</ul>
    </div>
  </section>

  <div class="foot">
    <span>Bito · AI Architect — Proof-of-Concept Plan</span>
    <span>${company} · ${todayLong()}</span>
  </div>
</div>
</body>
</html>`;
}

/** Open the POC plan as a print-ready document in a new tab. */
export function openPocPdf(plan: PocPlan): boolean {
  const html = buildPocHtml(plan);
  const w = window.open("", "_blank");
  if (!w) return false; // popup blocked
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
