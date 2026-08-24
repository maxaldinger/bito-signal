import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch, extractJSON } from "@/lib/anthropic";
import { adminClient, sessionUserId } from "@/lib/supabaseAuth";
import { BITO_CONTEXT } from "@/lib/bito";
import type { ProposalFields, ProposalRoi } from "@/lib/proposalDoc";

// POST /api/proposal — generate a personalized Governor proposal for an
// account and store it under an unguessable token; the prospect-facing page
// is served publicly at /p/<token> (middleware exempts that path).
//
// The canonical sections (solution, rollout, proof points, why-Bito) are
// FIXED copy in lib/proposalDoc.ts, and the ROI table is computed here — the
// model only writes the executive summary and the closing CTA, from facts
// the caller supplies. Thin context degrades to a solid generic summary; it
// must never degrade to invention.
export const maxDuration = 60;

interface Body {
  company?: string;
  domain?: string;
  contactName?: string;
  contactTitle?: string;
  /** Whatever the surface knows: signal, blurb, brief summary, call hook. */
  context?: string;
  sweEstimate?: number;
  employees?: number;
  icpTotal?: number;
}

interface GenOut {
  execSummary?: unknown;
  cta?: unknown;
}

const ASSUMED_ALLOWANCE_MO = 1000;

export async function POST(req: NextRequest) {
  const uid = await sessionUserId();
  if (!uid) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const company = body.company?.trim();
  if (!company) return NextResponse.json({ ok: false, error: "Pass company" }, { status: 400 });
  const contactName = body.contactName?.trim() || undefined;
  const swe = typeof body.sweEstimate === "number" && body.sweEstimate >= 20 ? Math.round(body.sweEstimate) : undefined;

  // ROI table, computed — never model-written. Only rendered when we actually
  // have an engineer count to anchor it.
  let roi: ProposalRoi | undefined;
  if (swe) {
    const spendYr = swe * ASSUMED_ALLOWANCE_MO * 12;
    roi = {
      engineers: swe,
      allowanceMo: ASSUMED_ALLOWANCE_MO,
      spendYr,
      savedAt47: Math.round(spendYr * 0.47),
      newSpendAt47: Math.round(spendYr * 0.53),
      savedAt83: Math.round(spendYr * 0.83),
    };
  }

  const facts = [
    `Company: ${company}`,
    body.domain ? `Domain: ${body.domain}` : "",
    contactName ? `Recipient: ${contactName}${body.contactTitle ? `, ${body.contactTitle}` : ""}` : "",
    typeof body.employees === "number" ? `Total employees: ~${Math.round(body.employees).toLocaleString()}` : "",
    swe ? `Estimated software engineers: ~${swe.toLocaleString()}` : "",
    typeof body.icpTotal === "number" ? `Bito ICP fit score: ${body.icpTotal}/99` : "",
    body.context ? `What we know (signal / brief context):\n${body.context.slice(0, 1500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `${BITO_CONTEXT}

You write the two personalized sections of a Bito GOVERNOR proposal document. Governor is Bito's context-driven model router: a transparent layer between a team's coding harness (Claude Code, Cursor, Codex, Copilot) and the models — the Code Context Engine injects the right code up front (−47% token cost per task, up to −68%), and the Model Router sends each request to the lowest-cost model that clears the quality bar. Drop-in: point the harness's base URL at Governor, nothing else changes.

Write in a direct, senior, vendor-to-engineering-leader register. No hype words, no em dashes.

HARD RULES:
- Use ONLY the account facts provided. NEVER invent initiatives, names, numbers, quotes, or events for the company. If the facts are thin, write about the cost mechanics of agentic coding at a company of their kind in general terms.
- Do not repeat the company name more than twice across everything you write.
- No statistics other than these, verbatim if used: 47% lower token cost per task; up to 68% on individual tasks; $4.12 to $2.14 per task; $6.81 to $1.13 for a full session; 51.9% to 70.1% on SWE-Bench Pro. At most two figures total.

Return ONLY JSON: {"execSummary": ["paragraph 1", "paragraph 2"], "cta": "one closing next-steps paragraph"}.
- execSummary: exactly 2 paragraphs, 50-90 words each. Paragraph 1: their situation — the unit economics of scaling coding agents, tied to the provided facts. Paragraph 2: what Governor changes for them specifically.
- cta: 40-70 words proposing the controlled A/B benchmark on THEIR codebase and tasks, ending with scheduling a brief technical kickoff. No exclamation marks.`;

  let gen: GenOut | null = null;
  try {
    const result = await callClaudeWithWebSearch({
      system,
      user: `Account facts:\n${facts}\n\nWrite the JSON now.`,
      webSearch: false,
      maxTokens: 1200,
    });
    gen = extractJSON<GenOut>(result.text);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Generation failed" },
      { status: 502 },
    );
  }
  const execSummary = Array.isArray(gen?.execSummary)
    ? gen.execSummary.map((p) => String(p)).filter(Boolean).slice(0, 3)
    : [];
  const cta = typeof gen?.cta === "string" ? gen.cta.trim() : "";
  if (execSummary.length === 0 || !cta) {
    return NextResponse.json(
      { ok: false, error: "The generator returned an unusable draft — try again" },
      { status: 502 },
    );
  }

  const fields: ProposalFields = {
    company,
    contactName,
    execSummary,
    cta,
    engineers: swe,
    employees: typeof body.employees === "number" ? Math.round(body.employees) : undefined,
    roi,
    generatedAt: new Date().toISOString(),
  };

  const token = randomBytes(16).toString("hex");
  const { error } = await adminClient()
    .from("bito_proposals")
    .insert({ token, company, contact_name: contactName ?? null, fields, created_by: uid });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });

  return NextResponse.json({ ok: true, url: `${req.nextUrl.origin}/p/${token}` });
}
