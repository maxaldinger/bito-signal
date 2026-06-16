import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch, extractJSON, FAST_MODEL } from "@/lib/anthropic";
import { BITO_CONTEXT } from "@/lib/bito";

// Sales Assist — two kinds of modes:
//  - chat modes (ask / email / objections / research): free-form answers,
//    grounded with web_search where it helps;
//  - tool modes (lou / fit / threading / proposal / deck / meddpicc):
//    structured JSON extracted from the rep's notes, rendered as interactive
//    tools in the UI (LOU table + Excel export, MEDDPICC scorecard, …).
export const maxDuration = 180;

const LOU_CATEGORIES =
  "Review Throughput | Code Quality & Bugs | Security & Compliance | AI Tooling Cost | Adoption & Process";

type ModeType = "text" | "json";
interface ModeCfg {
  type: ModeType;
  instruction: string;
  schema?: string;
  maxSearches: number;
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
  proposal: {
    type: "json",
    instruction:
      "Build a structured proposal outline from the notes and the recommended products. Include an executive summary, the prospect's situation, recommended Bito solution mapped to their needs, value/ROI framing (reviewer-hours saved, escaped-bug cost, AI-spend offset), implementation phases, and next steps. Do not invent specific prices.",
    schema: `{"title":"proposal title","sections":[{"heading":"section heading","content":"section body (plain text, may use - bullets)"}]}`,
    maxSearches: 1,
  },
  deck: {
    type: "json",
    instruction:
      "Generate slide-by-slide presentation content for a Bito sales deck tailored to the context. 7-10 slides covering hook, their pain, Bito's solution, proof, ROI, and next steps.",
    schema: `{"slides":[{"title":"slide title","bullets":["bullet","bullet"],"notes":"one-line speaker note"}]}`,
    maxSearches: 1,
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
      // Structured tool modes (LOU, MEDDPICC, threading, proposal, deck) extract
      // and draft from the rep's notes — Haiku handles them at lower cost. The
      // free-form research/email chat ("ask") stays on the default Sonnet model.
      model: cfg.type === "json" ? FAST_MODEL : undefined,
      maxSearches: cfg.maxSearches,
      maxTokens: cfg.type === "json" ? 4000 : 2500,
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
