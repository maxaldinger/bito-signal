import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch, extractJSON, FAST_MODEL } from "@/lib/anthropic";
import { BITO_CONTEXT } from "@/lib/bito";

// Sales Assist — two kinds of modes:
//  - chat modes (ask / email / objections / research): free-form answers,
//    grounded with web_search where it helps;
//  - tool modes (lou / threading / poc / meddpicc): structured JSON extracted
//    from the rep's notes, rendered as interactive tools in the UI (LOU table +
//    Excel export, MEDDPICC scorecard, POC plan + PDF, …). The ROI calculator
//    is fully client-side and does not hit this route.
export const maxDuration = 180;

const LOU_CATEGORIES =
  "Review Throughput | Code Quality & Bugs | Security & Compliance | AI Tooling Cost | Adoption & Process";

type ModeType = "text" | "json";
interface ModeCfg {
  type: ModeType;
  instruction: string;
  schema?: string;
  maxSearches: number;
  // Heavy JSON modes (e.g. the POC plan) need Sonnet + more tokens for quality;
  // the light extract modes stay on the fast model.
  heavy?: boolean;
}

const MODES: Record<string, ModeCfg> = {
  // ---- chat mode ----
  ask: {
    type: "text",
    instruction:
      "Answer the rep's request directly and practically — questions, objection handling, email drafts, account research, call prep. " +
      "For emails: subject line + tight body (under 130 words) + one clear CTA. " +
      "For objections: acknowledge → reframe → evidence → one question to advance the deal. " +
      "For account research: search the live web, synthesize into SHORT CAPS sections, end with 'SO WHAT FOR BITO'. " +
      "Whenever a specific company or person is referenced, verify facts with a quick web search before asserting them — never invent prospect facts.",
    maxSearches: 5,
  },

  // ---- structured tool modes ----
  lou: {
    type: "json",
    instruction:
      "Read the meeting notes and extract the prospect's critical business issues. For EACH issue, map whether/how Bito helps — be specific about which Bito capability and what outcome. Only include issues actually present in the notes; never invent issues.",
    schema: `{"issues":[{"issue":"the critical business problem in their words","solution":"Can we help? If so, how? — specific Bito capability + outcome","category":"${LOU_CATEGORIES}","priority":"High|Medium|Low","timeframe":"short phase/timeframe e.g. 'Phase 1 - Pilot (4 weeks)'"}]}`,
    maxSearches: 1,
  },
  threading: {
    type: "json",
    instruction:
      "Analyze the buying committee from the stakeholders provided. Classify each by role and disposition, give a one-line engagement strategy tuned to selling Bito (review pain → staff engineers; budget → VPE/CTO; security gate → security lead), then identify coverage gaps and next actions to multi-thread the deal.",
    schema: `{"summary":"1-2 sentence committee read","stakeholders":[{"name":"","title":"","role":"Champion|Economic Buyer|Decision Maker|Influencer|Blocker|Unknown","disposition":"Supporter|Neutral|Detractor|Unknown","strategy":"one-line engagement plan"}],"gaps":["coverage gap"],"nextActions":["concrete next action"]}`,
    maxSearches: 1,
  },
  poc: {
    type: "json",
    heavy: true,
    instruction:
      "Generate a precise 2-week Proof-of-Concept (evaluation) PLAN for AI Architect, tailored to the prospect described in the notes. " +
      "The input is raw meeting notes or a call transcript — first read it and extract the company name, codebase scale (repos / lines of code), team size, the coding agents and planning tools they use, their pain, and who the technical lead / decision-maker / security reviewer are. Infer reasonably when something is described loosely; only use placeholders for names truly not present. " +
      "AUDIENCE & VOICE: this is a TECHNICAL EVALUATION DOCUMENT written for an engineering audience (VP/Director of Engineering, staff engineers). Write plainly and precisely, the way an engineer scoping an evaluation would. State mechanisms, conditions, and measurements. " +
      "DO NOT use marketing language: no taglines, no rhetorical contrasts ('not X, but Y'), no hype words (unlock as a verb, supercharge, transformative, game-changer, effortless, magic), no exclamation points, no second-person selling ('you'll love'), no adjectives doing the work that a number should. If a sentence would sound at home in a pitch deck, rewrite it as a factual statement. Follow these rules exactly:\n" +
      "1) WHAT SUCCESS LOOKS LIKE: state observable OUTCOMES — what becomes true in their workflow — not a description of features. Each item is an outcome + how the 2-week window verifies it objectively. 3 items.\n" +
      "2) COMPLEXITY THRESHOLD: the value of grounded context scales with the surface area of cross-repo dependencies, shared schemas, and divergent patterns; below a certain size a single engineer holds enough context mentally and the measured delta shrinks. State a concrete recommended floor (minRepos and minLoc) for a meaningful evaluation and explain the mechanism. Then assess THEIR stated scope against that floor and set fit = strong | adequate | under-scoped with one honest sentence. If they gave no scale, recommend the floor and note scope must be confirmed.\n" +
      "3) METRICS: define four measurable signals, each with how it's measured in the trial and why it matters for the evaluation: (a) Time-to-first-correct-PR / time-to-merge on indexed vs non-indexed repos; (b) Token-consumption delta vs an ungrounded baseline, converted to annualized dollars using the recorded spend baseline; (c) Iteration count to a correct, mergeable result; (d) Developer-reported confidence in agent suggestions — set unlock=true on this one (it converts a subjective signal into a tracked number). 'why' must be a factual reason it matters, not a sales claim.\n" +
      "4) MOMENTS: define a 'moment' as a specific, reproducible instance where grounded context produced correct output where an ungrounded agent would have been wrong (wrong API contract, stale schema, a pattern from another repo). Give 3 concrete example moments tied to their stated stack/tools/agents.\n" +
      "5) TIMELINE: Week 1 checkpoint must be concrete — 'Identify one real example from your codebase where grounded context changed the output'. Week 2 checkpoint = review the quantified deltas and captured moments, then decide.\n" +
      "6) REFERENCE BENCHMARK: cite the PubMatic result factually (500+ repos, 450 engineers, 8-week controlled evaluation): technical design per large epic dropped from an estimated 2 weeks to 3 days; indexed repos grew merge volume +48% (control repos +4%); 2x work shipped with no rise in reverts or incidents. Present it as a single prior result, not a guarantee, then describe how they establish their own equivalent baseline measurement during the trial. No editorializing.\n" +
      "7) CHECKLIST — ECONOMIC BASELINE: the checklist MUST include capturing the team's current AI coding-tool spend (seats x annual cost) as a recorded baseline BEFORE the trial starts, so the token-consumption delta converts to a dollar figure at readout (e.g. an annualized saving) rather than an abstract token count. Make this item explicit and specific.\n" +
      "Keep every field specific to the prospect in the notes. Never invent prospect facts not implied by the notes; for people/roles use placeholders if unknown. " +
      "LENGTH: this renders as a 3-page document, so be tight — every string one sentence, ~22 words max. Exactly 3 successLooksLike, exactly the 4 metrics, exactly 3 moment examples, 2 timeline phases, 5-7 checklist items (one of which is the economic baseline above), 2-3 next steps. No filler.",
    schema: `{"company":"prospect company name","headline":"plain descriptive document title, <=9 words (NOT a marketing tagline)","successLooksLike":[{"outcome":"an observable outcome in their workflow (not a tool description)","proof":"how the 2-week trial verifies it objectively"}],"complexityThreshold":{"minRepos":0,"minLoc":"SHORT token only, e.g. '1M+' or '1.5M+' (no words like 'lines of code')","rationale":"the mechanism: why value scales with cross-repo complexity","fit":"strong|adequate|under-scoped","fitNote":"one honest sentence assessing their stated scope vs the floor"},"metrics":[{"name":"metric name","how":"how it is measured during the trial","why":"factual reason it matters for the evaluation","unlock":false}],"moments":{"definition":"what a 'moment' is in this trial","examples":["tailored example moment"]},"timeline":[{"phase":"Week 1","activities":["activity"],"checkpoint":"concrete checkpoint"}],"roi":{"anchor":"the PubMatic result stated factually (technical design per large epic 2 weeks -> 3 days; +48% merges vs +4% control; 2x work shipped; 500+ repos / 450 engineers), noting it is one prior result","yourVersion":"how they establish their own equivalent baseline measurement during the trial","framing":"one neutral line on how to interpret the measurement"},"roles":{"customer":["role: placeholder"],"bito":["Primary POC: Rohan Thakur","Onboarding lead: Rahul Kumar"]},"checklist":["pre-trial item (include repo list meeting the floor, Jira/Linear, Slack, MCP + SSO/OAuth, developer emails, confirmed POC + decision lead, start date)"],"nextSteps":["next step"]}`,
    maxSearches: 2,
  },
  meddpicc: {
    type: "json",
    instruction:
      "Fill a MEDDPICC scorecard ONLY from what the notes actually contain. If an element was not discussed, set status to 'not_set' and leave notes empty. Status: 'strong' = solid, confirmed; 'weak' = partial/assumed; 'missing' = explicitly a gap/unknown that matters; 'not_set' = not discussed. Notes should be concise and specific. " +
      "For EVERY element (including weak, missing, and not_set ones), also return 2-4 'suggestions': concrete next moves on HOW to strengthen that element on THIS deal. Ground each suggestion in the notes — reference the real people, repos, tools, competitors, numbers, and situations mentioned. Phrase them as specific discovery questions or actions the rep can take next (e.g. 'Ask Dana who signs off on dev-tool spend above $50k', not 'Identify the economic buyer'). If the element is already strong, suggest how to confirm or leverage it. Never return generic, deal-agnostic advice.",
    schema: `{"elements":{"metrics":{"status":"strong|weak|missing|not_set","notes":"","suggestions":["",""]},"economicBuyer":{"status":"","notes":"","suggestions":[]},"decisionCriteria":{"status":"","notes":"","suggestions":[]},"decisionProcess":{"status":"","notes":"","suggestions":[]},"paperProcess":{"status":"","notes":"","suggestions":[]},"identifyPain":{"status":"","notes":"","suggestions":[]},"champion":{"status":"","notes":"","suggestions":[]},"competition":{"status":"","notes":"","suggestions":[]}}}`,
    maxSearches: 1,
  },
};

const TONES = new Set(["Direct", "Consultative", "Concise", "Technical"]);
const PERSONAS = new Set([
  "VP Engineering",
  "CTO",
  "Head of Platform / DevEx",
  "Staff Engineer",
  "Security Lead",
]);

export async function POST(req: NextRequest) {
  let body: {
    mode?: string;
    tone?: string;
    persona?: string;
    account?: string;
    notes?: string;
    extra?: string;
    messages?: { role: "user" | "assistant"; content: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const mode = body.mode && MODES[body.mode] ? body.mode : "ask";
  const cfg = MODES[mode];
  const tone = body.tone && TONES.has(body.tone) ? body.tone : "Direct";
  const persona =
    body.persona && PERSONAS.has(body.persona) ? body.persona : undefined;

  // Build the user content + history.
  let user = "";
  let history: { role: "user" | "assistant"; content: string }[] = [];

  if (cfg.type === "text") {
    if (body.messages !== undefined && !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: "`messages` must be an array of {role, content}." },
        { status: 400 },
      );
    }
    const msgs = (body.messages ?? []).filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    );
    if (msgs.length === 0 || msgs[msgs.length - 1].role !== "user") {
      return NextResponse.json({ error: "No message provided." }, { status: 400 });
    }
    user = msgs[msgs.length - 1].content;
    history = msgs.slice(0, -1);
  } else {
    const parts: string[] = [];
    if (typeof body.account === "string" && body.account.trim())
      parts.push(`ACCOUNT: ${body.account.trim()}`);
    if (typeof body.notes === "string" && body.notes.trim())
      parts.push(`NOTES / INPUT:\n${body.notes.trim()}`);
    if (typeof body.extra === "string" && body.extra.trim())
      parts.push(`ADDITIONAL:\n${body.extra.trim()}`);
    user = parts.join("\n\n");
    if (!user) {
      return NextResponse.json({ error: "No input provided." }, { status: 400 });
    }
  }

  const personaLine = persona
    ? ` TARGET PERSONA: the rep is selling to a ${persona} — frame value for that role.`
    : "";
  const system =
    cfg.type === "text"
      ? `You are an expert AI sales engineer for Bito, helping Bito's own reps sell.

${BITO_CONTEXT}

TASK: ${cfg.instruction}
TONE: ${tone}.${personaLine}
FORMAT: clean plain text — SHORT CAPS headings and "- " bullets where structure helps. Be specific to Bito, never generic. Never fabricate prospect facts; if you didn't find it, say so.`
      : `You are an expert AI sales engineer for Bito.

${BITO_CONTEXT}

TASK: ${cfg.instruction}
TONE: ${tone}.${personaLine}
Only use web_search if a factual company detail genuinely needs verifying — the rep's notes are the primary source.

Respond with ONLY a single JSON object, no prose, no code fences, matching exactly this shape:
${cfg.schema}`;

  try {
    const result = await callClaudeWithWebSearch({
      system,
      user,
      history,
      // Structured tool modes (LOU, MEDDPICC, threading) extract and draft from
      // the rep's notes — Haiku handles them at lower cost. The
      // free-form research/email chat ("ask") and heavy modes (POC plan) stay on
      // the default Sonnet model for quality.
      model: cfg.type === "json" && !cfg.heavy ? FAST_MODEL : undefined,
      maxSearches: cfg.maxSearches,
      maxTokens: cfg.heavy ? 6000 : cfg.type === "json" ? 4000 : 2500,
      temperature: cfg.type === "json" ? 0.3 : 0.5,
    });

    if (cfg.type === "text") {
      if (!result.text) {
        return NextResponse.json(
          { error: "No response generated — try rephrasing." },
          { status: 502 },
        );
      }
      return NextResponse.json({
        text: result.text,
        citations: result.citations.slice(0, 8),
        searchCount: result.searchCount,
        // Surfaced as a notice in the UI — a cut-off answer must not pass as complete.
        truncated: result.truncated,
        searchErrors: result.searchErrors,
      });
    }

    const parsed = extractJSON<Record<string, unknown>>(result.text);
    if (!parsed) {
      const cause = result.truncated
        ? `the response was cut off (stop_reason: ${result.stopReason})`
        : "could not parse the AI output";
      return NextResponse.json(
        { error: `Tool pass failed — ${cause}. Try again or trim the notes.` },
        { status: 502 },
      );
    }
    return NextResponse.json({ data: parsed, truncated: result.truncated });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error talking to Anthropic.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
