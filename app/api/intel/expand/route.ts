import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch, extractJSON } from "@/lib/anthropic";
import { BITO_CONTEXT } from "@/lib/bito";
import { fetchBrief, upsertBrief, supabaseConfigured } from "@/lib/supabase";
import type { CompanyIntel } from "@/lib/types";

// On-demand brief sections. The main /api/intel call stays lean (summary, ICP,
// people, motion+outreach) to cut tokens/latency; the heavier evidence sections
// are pulled here only when the rep clicks to expand. Each result is merged back
// into the cached brief so a re-open is free.
export const maxDuration = 120;

interface SectionCfg {
  instruction: string;
  schema: string;
  maxSearches: number;
  // Merge the parsed result into the cached brief.
  merge: (intel: CompanyIntel, parsed: Record<string, unknown>) => void;
}

const SECTIONS: Record<string, SectionCfg> = {
  whyBito: {
    instruction:
      "Give 3-4 evidence-tied reasons THIS company is a fit for Bito AI Architect — each grounded in a specific, real fact about them (scale, stack, AI-tooling, cross-repo complexity). No generic claims.",
    schema: `{"whyBito":["evidence-tied reason","...","..."]}`,
    maxSearches: 2,
    merge: (intel, p) => {
      intel.whyBito = (Array.isArray(p.whyBito) ? p.whyBito : []).map(String).filter(Boolean).slice(0, 5);
    },
  },
  painPoints: {
    instruction:
      "Identify up to 4 likely engineering pain points for this company that Bito addresses, each grounded in a specific evidenced fact. For each: a short title, severity (HIGH|MEDIUM|LOW), a category, the evidence, and how Bito solves it.",
    schema: `{"painPoints":[{"title":"","severity":"HIGH|MEDIUM|LOW","category":"","evidence":"specific fact/quote","bitoSolution":"how Bito addresses it"}]}`,
    maxSearches: 3,
    merge: (intel, p) => {
      const arr = Array.isArray(p.painPoints) ? (p.painPoints as Record<string, unknown>[]) : [];
      intel.painPoints = arr
        .filter((x) => x?.title)
        .map((x) => ({
          title: String(x.title),
          severity: ["HIGH", "MEDIUM", "LOW"].includes(String(x.severity))
            ? (x.severity as "HIGH" | "MEDIUM" | "LOW")
            : "MEDIUM",
          category: String(x.category || "General"),
          evidence: String(x.evidence || ""),
          bitoSolution: String(x.bitoSolution || ""),
        }))
        .slice(0, 6);
    },
  },
  tokenCost: {
    instruction:
      "Estimate this company's monthly AI dev-tooling spend using REAL public anchors (Copilot Business ~$19/seat/mo, Copilot Enterprise ~$39, Cursor Business ~$40) times an evidenced engineering-seat estimate. State every assumption in notes. Estimates only — never present as fact. bitoOffsetUsd = the slice Bito could offset.",
    schema: `{"tokenCost":{"estimatedMonthlyUsd":number,"estimatedSeats":number,"perSeatUsd":number,"notes":"assumptions, anchors used","bitoOffsetUsd":number or null}}`,
    maxSearches: 2,
    merge: (intel, p) => {
      const t = (p.tokenCost ?? {}) as Record<string, unknown>;
      const num = (v: unknown, max: number) =>
        typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
      intel.tokenCost = {
        estimatedMonthlyUsd: num(t.estimatedMonthlyUsd, 10_000_000),
        estimatedSeats: num(t.estimatedSeats, 100_000),
        perSeatUsd: num(t.perSeatUsd, 1_000),
        notes: String(t.notes || ""),
        bitoOffsetUsd: typeof t.bitoOffsetUsd === "number" ? num(t.bitoOffsetUsd, 10_000_000) : undefined,
      };
    },
  },
  motionDetail: {
    instruction:
      "Justify the recommended GTM motion for this account in 1-2 sentences (reasoning), and give 2-3 concrete watch-outs / risks for the deal. Ground both in the company's real situation.",
    schema: `{"reasoning":"why this motion fits","watchOuts":["concrete risk","concrete risk"]}`,
    maxSearches: 1,
    merge: (intel, p) => {
      intel.motion.reasoning = String(p.reasoning || "");
      intel.motion.watchOuts = (Array.isArray(p.watchOuts) ? p.watchOuts : []).map(String).slice(0, 4);
    },
  },
};

export async function POST(req: NextRequest) {
  let body: { company?: string; segment?: string; summary?: string; section?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const company = body.company?.trim();
  const section = body.section ?? "";
  const cfg = SECTIONS[section];
  if (!company) return NextResponse.json({ error: "company is required" }, { status: 400 });
  if (!cfg) return NextResponse.json({ error: "unknown section" }, { status: 400 });

  const system = `${BITO_CONTEXT}

You are Bito's GTM analyst. For the company below, produce ONLY the requested section as JSON — grounded in real, web-verified facts. Context you already have:
COMPANY: ${company}${body.segment ? ` (${body.segment})` : ""}
SUMMARY: ${body.summary || "(none provided — research the company)"}

TASK: ${cfg.instruction}

Respond with ONLY this JSON shape, no prose, no code fences:
${cfg.schema}`;

  try {
    const result = await callClaudeWithWebSearch({
      system,
      user: `Produce the "${section}" section for ${company}. Today: ${new Date().toISOString().slice(0, 10)}.`,
      maxSearches: cfg.maxSearches,
      maxTokens: 1800,
      temperature: 0.3,
    });
    const parsed = extractJSON<Record<string, unknown>>(result.text);
    if (!parsed) {
      return NextResponse.json({ error: "Could not generate that section — try again." }, { status: 502 });
    }

    // Best-effort: merge into the cached brief so a re-open shows it for free.
    if (supabaseConfigured()) {
      const brief = await fetchBrief(company);
      if (brief) {
        cfg.merge(brief, parsed);
        await upsertBrief(company, brief);
      }
    }

    return NextResponse.json({ ok: true, section, data: parsed, citations: result.citations.slice(0, 8) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Section generation failed" },
      { status: 500 },
    );
  }
}
