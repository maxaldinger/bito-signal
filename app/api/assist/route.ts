import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch } from "@/lib/anthropic";
import { BITO_CONTEXT } from "@/lib/bito";

// Sales Assist — chat-style helper for Bito reps. Four modes, all grounded:
// "research" leans hard on web_search; the others may search lightly to
// personalize (e.g. checking a prospect's latest news before an email).
export const maxDuration = 120;

const MODES: Record<string, { instruction: string; maxSearches: number }> = {
  ask: {
    instruction:
      "Answer the rep's question directly and practically. If the question references a specific company or person, verify with a quick web search before asserting facts.",
    maxSearches: 2,
  },
  email: {
    instruction:
      "Write a ready-to-send sales email: subject line + tight body (under 130 words) + one clear CTA. If a target company is named, search for one fresh, specific fact to personalize the opener — cite where it came from after the email. Never invent facts about the prospect.",
    maxSearches: 3,
  },
  objections: {
    instruction:
      "Handle the objection: acknowledge → reframe → evidence → one question to advance the deal. If the objection references a competitor, verify current competitor positioning with a search before contrasting.",
    maxSearches: 2,
  },
  research: {
    instruction:
      "Run live account research on whatever company, person, or market the rep asks about. Search thoroughly, synthesize into SHORT CAPS sections, and end with 'SO WHAT FOR BITO' — the sales-relevant takeaways. Cite sources inline as [domain.com].",
    maxSearches: 6,
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

  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    return NextResponse.json(
      { error: "`messages` must be an array of {role, content}." },
      { status: 400 },
    );
  }
  const history = (body.messages ?? []).filter(
    (m) =>
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim(),
  );
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "No message provided." }, { status: 400 });
  }

  const last = history[history.length - 1];
  const prior = history.slice(0, -1);

  const system = `You are an expert AI sales engineer for Bito, helping Bito's own reps sell.

${BITO_CONTEXT}

TASK: ${cfg.instruction}
TONE: ${tone}.${persona ? ` TARGET PERSONA: the rep is selling to a ${persona} — frame value for that role.` : ""}
FORMAT: clean plain text — SHORT CAPS headings and "- " bullets where structure helps. Be specific to Bito, never generic. Never fabricate prospect facts; if you didn't find it, say so.`;

  try {
    const result = await callClaudeWithWebSearch({
      system,
      user: last.content,
      history: prior,
      maxSearches: cfg.maxSearches,
      maxTokens: 2500,
      temperature: 0.5,
    });

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
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error talking to Anthropic.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
