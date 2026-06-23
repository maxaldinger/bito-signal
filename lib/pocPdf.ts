// Build a self-contained, print-optimized HTML document for an AI Architect
// Proof-of-Concept plan, then open it in a new tab and trigger the browser's
// print dialog (Save as PDF). Going through print gives vector-quality type and
// pixel-perfect layout with zero PDF dependencies — the resulting PDF is exactly
// what a rep sends a prospect. Designed to fit ~3 pages.

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

// The official Bito logo (wordmark + monogram), lifted from the brand deck.
const BITO_LOGO = `<svg viewBox="0 0 79.6 32.46" width="84" height="34" xmlns="http://www.w3.org/2000/svg" class="logo"><g fill="#1a2230"><path d="M45.5 14C48 14.7 49.3 16.4 49.3 19.1 49.3 20.8 48.7 22.2 47.6 23.2 46.5 24.2 44.9 24.7 43 24.7L35 24.7 35 5.1 42 5.1C43.9 5.1 45.3 5.5 46.2 6.3 47.2 7.1 47.6 8.3 47.6 9.9 47.6 10.9 47.4 11.7 47.1 12.4 46.7 13 46.2 13.6 45.5 14ZM38.3 12.9 41.6 12.9C42.5 12.9 43.2 12.7 43.7 12.3 44.2 11.9 44.4 11.3 44.4 10.4 44.4 9.5 44.2 8.9 43.7 8.5 43.2 8.1 42.5 7.9 41.6 7.9L38.3 7.9ZM42.5 21.8C44.7 21.8 45.8 20.8 45.8 18.9 45.8 17.8 45.5 17.1 44.9 16.6 44.3 16.1 43.5 15.9 42.5 15.9L38.3 15.9 38.3 21.8Z"/><path d="M51.3 5.1 54.4 5.1 54.4 8.3 51.3 8.3ZM51.3 10.8 54.4 10.8 54.4 24.7 51.3 24.7Z"/><path d="M62.1 25C60.9 25 60 24.7 59.3 24 58.7 23.3 58.4 22.5 58.4 21.5L58.4 13.4 56.3 13.4 56.6 10.9 58.4 10.9 58.4 7.6 61.5 7.3 61.5 10.8 64.8 10.8 64.8 13.3 61.5 13.3 61.5 20C61.5 20.8 61.5 21.4 61.6 21.7 61.7 22 61.9 22.2 62.2 22.3 62.5 22.4 63.1 22.4 63.9 22.4L64.7 22.4 64.5 25Z"/><path d="M72.6 25C71.2 25 69.9 24.7 68.8 24 67.7 23.3 66.9 22.5 66.3 21.4 65.7 20.3 65.5 19.1 65.5 17.8 65.5 16.5 65.8 15.3 66.3 14.2 66.9 13.1 67.7 12.2 68.8 11.6 69.9 10.9 71.1 10.6 72.6 10.6 74.1 10.6 75.3 10.9 76.4 11.6 77.5 12.2 78.3 13.1 78.8 14.2 79.4 15.3 79.6 16.5 79.6 17.8 79.6 19.1 79.3 20.3 78.8 21.4 78.2 22.5 77.4 23.4 76.4 24 75.3 24.7 74.1 25 72.6 25ZM72.6 22.3C73.8 22.3 74.8 21.9 75.4 21.1 76.1 20.3 76.4 19.2 76.4 17.7 76.4 16.3 76.1 15.2 75.4 14.4 74.7 13.6 73.8 13.1 72.6 13.1 71.4 13.1 70.4 13.5 69.8 14.4 69.1 15.2 68.8 16.3 68.8 17.7 68.8 19.1 69.1 20.2 69.8 21.1 70.5 21.9 71.4 22.3 72.6 22.3Z"/></g><path d="M30 15C30 23.3 23.3 30 15 30 14 30 13.1 29.9 12.2 29.7L5.9 32.4C5.3 32.6 4.7 32.3 4.6 31.7L3.7 24.9C1.4 22.2 0 18.8 0 15 0 6.7 6.7 0 15 0 23.3 0 30 6.7 30 15ZM17.3 11.4C17.5 10.7 17.1 10 16.4 9.9 15.7 9.7 15 10.1 14.9 10.8L12.8 18.6C12.6 19.3 13 20 13.7 20.1 14.4 20.3 15.1 19.9 15.2 19.2ZM5.4 14.1C4.9 14.6 4.9 15.4 5.4 15.9L9.1 19.6C9.6 20.1 10.4 20.1 10.9 19.6 11.4 19.1 11.4 18.3 10.9 17.8L8 15 10.9 12.1C11.4 11.6 11.4 10.8 10.9 10.3 10.4 9.8 9.6 9.8 9.1 10.3ZM24.6 15.9C25.1 15.4 25.1 14.6 24.6 14.1L20.9 10.4C20.4 9.9 19.6 9.9 19.1 10.4 18.6 10.9 18.6 11.7 19.1 12.2L22 15 19.1 17.9C18.6 18.4 18.6 19.2 19.1 19.7 19.6 20.2 20.4 20.2 20.9 19.7Z" fill="#2BAAFF" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;

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
    .slice(0, 3)
    .map(
      (s, i) => `
      <div class="card">
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
        <p class="metric-line"><span class="lbl">How</span> ${esc(m.how)}</p>
        <p class="metric-line"><span class="lbl">Why</span> ${esc(m.why)}</p>
      </div>`,
    )
    .join("");

  const momentItems = (p.moments?.examples || [])
    .slice(0, 3)
    .map((e) => `<li>${esc(e)}</li>`)
    .join("");

  const timelineCols = (p.timeline || [])
    .map(
      (t) => `
      <div class="week">
        <h4>${esc(t.phase)}</h4>
        <ul class="acts">${(t.activities || []).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        <div class="checkpoint">
          <span class="cp-label">Checkpoint</span>${esc(t.checkpoint)}
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
    --brand: #1480d6;      /* readable Bito blue for text/accents */
    --brand-bright: #2BAAFF; /* logo blue for fills */
    --ink: #1a2230;
    --ink-2: #46556a;
    --ink-3: #7a8699;
    --line: #e6eaf0;
    --tint: #eef6ff;
    --amber: #b45309;
    --red: #b91c1c;
    --green: #15803d;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    background: #f3f4f6;
    -webkit-font-smoothing: antialiased;
    font-size: 10.2pt;
    line-height: 1.42;
  }
  .sheet { max-width: 7.6in; margin: 18px auto; background: #fff; padding: 0.62in 0.66in; box-shadow: 0 6px 30px rgba(15,23,42,0.12); border-radius: 4px; }

  /* Screen-only toolbar */
  .toolbar {
    max-width: 7.6in; margin: 0 auto 4px;
    display: flex; gap: 12px; align-items: center; justify-content: space-between;
    color: #475569; font-size: 12.5px; padding: 2px 4px;
  }
  .toolbar button { font: inherit; font-weight: 700; cursor: pointer; background: var(--brand); color: #fff; border: 0; padding: 9px 18px; border-radius: 8px; }
  .toolbar button:hover { background: #0e6bb8; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none !important; }
    .sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
  }

  /* Letterhead */
  .letterhead { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 12px; }
  .logo { display: block; height: 30px; width: auto; }
  .lh-right { text-align: right; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3); }
  .rule { height: 3px; border-radius: 3px; margin: 0 0 22px; background: linear-gradient(90deg, var(--brand-bright), #6dd0ff 55%, transparent); }

  /* Title block */
  .eyebrow { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--brand); margin: 0 0 6px; }
  h1.title { margin: 0; font-size: 21pt; line-height: 1.12; letter-spacing: -0.015em; font-weight: 800; color: var(--ink); }
  .subline { margin: 10px 0 0; font-size: 9.5pt; color: var(--ink-3); }
  .subline b { color: var(--ink-2); font-weight: 600; }

  /* Sections */
  section { margin-top: 19px; break-inside: avoid; }
  .sec-head { display: flex; align-items: baseline; gap: 9px; margin-bottom: 9px; }
  .sec-head .bar { width: 16px; height: 3px; border-radius: 2px; background: var(--brand-bright); transform: translateY(-3px); }
  .sec-head h2 { margin: 0; font-size: 12.5pt; font-weight: 800; letter-spacing: -0.01em; }
  .sec-head .note { font-size: 8.5pt; color: var(--ink-3); font-weight: 500; }

  /* Success cards */
  .card { display: flex; gap: 12px; padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; break-inside: avoid; }
  .card-num { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 6px; background: var(--tint); color: var(--brand); font-weight: 800; font-size: 10.5pt; display: flex; align-items: center; justify-content: center; }
  .card-title { margin: 0 0 2px; font-weight: 700; font-size: 10.5pt; }
  .card-body { margin: 0; color: var(--ink-2); font-size: 9.3pt; }

  /* Complexity threshold */
  .threshold { border: 1px solid var(--line); border-left: 3px solid var(--brand-bright); border-radius: 11px; padding: 15px 18px; break-inside: avoid; }
  .threshold .stats { display: flex; align-items: center; gap: 26px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--line); }
  .threshold .stat b { display: block; font-size: 19pt; font-weight: 800; color: var(--brand); line-height: 1; white-space: nowrap; }
  .threshold .stat span { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); }
  .threshold .vline { width: 1px; align-self: stretch; background: var(--line); }
  .threshold .rationale { margin: 0 0 11px; color: var(--ink-2); font-size: 9.4pt; }
  .fit-row { display: flex; align-items: center; gap: 9px; }
  .fit-badge { font-size: 7.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
  .fit-strong { background: #dcfce7; color: var(--green); }
  .fit-ok { background: #fef3c7; color: var(--amber); }
  .fit-under { background: #fee2e2; color: var(--red); }
  .fit-note { font-size: 9pt; color: var(--ink-2); margin: 0; }

  /* Metrics grid */
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
  .metric { position: relative; border: 1px solid var(--line); border-radius: 10px; padding: 12px 13px; break-inside: avoid; }
  .metric-unlock { border-color: var(--brand-bright); background: var(--tint); }
  .unlock-tag { position: absolute; top: -8px; right: 12px; background: var(--brand-bright); color: #fff; font-size: 7pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; padding: 2px 8px; border-radius: 999px; }
  .metric-name { margin: 0 0 6px; font-weight: 700; font-size: 10pt; }
  .metric-line { margin: 0 0 3px; font-size: 8.9pt; color: var(--ink-2); }
  .lbl { display: inline-block; font-size: 7pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--brand); margin-right: 4px; }

  /* Moments */
  .def { font-size: 9.5pt; color: var(--ink-2); margin: 0 0 9px; padding: 10px 13px; border-radius: 9px; background: #f7f9fc; border: 1px solid var(--line); }
  ul.moments { margin: 0; padding-left: 0; list-style: none; }
  ul.moments li { position: relative; padding: 7px 0 7px 22px; border-bottom: 1px solid var(--line); font-size: 9.3pt; color: var(--ink); }
  ul.moments li:last-child { border-bottom: 0; }
  ul.moments li::before { content: "→"; position: absolute; left: 2px; color: var(--brand-bright); font-weight: 800; }

  /* Timeline */
  .weeks { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
  .week { border: 1px solid var(--line); border-radius: 10px; padding: 13px; break-inside: avoid; }
  .week h4 { margin: 0 0 8px; font-size: 10.5pt; color: var(--brand); }
  ul.acts { margin: 0 0 9px; padding-left: 16px; }
  ul.acts li { font-size: 8.9pt; color: var(--ink-2); margin-bottom: 3px; }
  .checkpoint { background: var(--tint); border-radius: 8px; padding: 9px 11px; font-size: 8.9pt; color: var(--ink); font-weight: 600; }
  .cp-label { display: block; font-size: 7pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; color: var(--brand); margin-bottom: 2px; }

  /* Reference benchmark */
  .roi { border: 1px solid var(--line); border-left: 3px solid var(--brand-bright); border-radius: 11px; padding: 14px 16px; background: var(--tint); break-inside: avoid; }
  .roi .anchor { font-size: 10pt; font-weight: 600; line-height: 1.42; color: var(--ink); margin: 0 0 7px; }
  .roi .framing { font-size: 9pt; color: var(--ink-2); margin: 0 0 2px; }
  .roi .your { font-size: 9pt; color: var(--ink-2); margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--line); }

  /* Two-up lists */
  .twoup { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .block h3 { margin: 0 0 6px; font-size: 9.5pt; font-weight: 800; letter-spacing: 0.02em; color: var(--ink); }
  ul.plain { margin: 0; padding-left: 15px; }
  ul.plain li { font-size: 9.2pt; color: var(--ink-2); margin-bottom: 3px; }

  /* Sign-off */
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 42px; }
  .sig .who { font-size: 9pt; font-weight: 700; color: var(--ink); }
  .sig .line { margin-top: 34px; border-top: 1px solid #9aa3b2; padding-top: 5px; font-size: 7.5pt; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }

  .foot { margin-top: 22px; padding-top: 11px; border-top: 1px solid var(--line); font-size: 8pt; color: var(--ink-3); display: flex; justify-content: space-between; }

  @page { size: Letter; margin: 0.5in; }
</style>
</head>
<body>
  <div class="toolbar">
    <span>Review the plan, then export — <b style="color:#1a2230">Print → Save as PDF</b> for the cleanest result.</span>
    <button onclick="window.print()">Download PDF</button>
  </div>

  <div class="sheet">
    <header class="letterhead">
      ${BITO_LOGO}
      <div class="lh-right">AI Architect<br/>Proof-of-Concept Plan</div>
    </header>
    <div class="rule"></div>

    <p class="eyebrow">2-week trial · prepared for ${company}</p>
    <h1 class="title">${esc(p.headline || "A trial designed to be felt, not evaluated")}</h1>
    <p class="subline"><b>Prepared for</b> ${company} &nbsp;·&nbsp; <b>Date</b> ${todayLong()} &nbsp;·&nbsp; <b>Window</b> 2 weeks from knowledge-graph readiness</p>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>What success looks like</h2><span class="note">outcomes, not features</span></div>
      ${successCards}
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Scope &amp; the complexity threshold</h2></div>
      <div class="threshold">
        <div class="stats">
          <div class="stat"><b>${esc(p.complexityThreshold?.minRepos || "—")}</b><span>repos (min)</span></div>
          <span class="vline"></span>
          <div class="stat"><b>${esc(p.complexityThreshold?.minLoc || "—")}</b><span>lines of code (min)</span></div>
        </div>
        <p class="rationale">${esc(p.complexityThreshold?.rationale)}</p>
        <div class="fit-row">
          <span class="fit-badge ${fit.cls}">${fit.label}</span>
          <p class="fit-note">${esc(p.complexityThreshold?.fitNote)}</p>
        </div>
      </div>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>What we'll measure</h2><span class="note">indexed vs. non-indexed</span></div>
      <div class="grid">${metricCards}</div>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Moments, not vibes</h2></div>
      <p class="def">${esc(p.moments?.definition)}</p>
      <ul class="moments">${momentItems}</ul>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Timeline &amp; checkpoints</h2></div>
      <div class="weeks">${timelineCols}</div>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Reference benchmark</h2></div>
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
      <div class="block" style="margin-top:14px">
        <h3>Next steps</h3>
        <ul class="plain">${list(p.nextSteps)}</ul>
      </div>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Sign-off</h2><span class="note">to start the trial window</span></div>
      <div class="sign">
        <div class="sig"><div class="who">For ${company}</div><div class="line">Name, title &amp; date</div></div>
        <div class="sig"><div class="who">For Bito</div><div class="line">Name, title &amp; date</div></div>
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
