import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch, extractJSON } from "@/lib/anthropic";
import { bitoContextFor, type BitoProduct } from "@/lib/bito";
import { fetchBrief, upsertBrief, supabaseConfigured } from "@/lib/supabase";
import type { CompanyIntel } from "@/lib/types";

// On-demand brief sections. The main /api/intel call stays lean (summary, ICP,
// people, motion+outreach) to cut tokens/latency; the heavier evidence sections
// are pulled here only when the rep clicks to expand. Each result is merged back
// into the cached brief so a re-open is free.
export const maxDuration = 120;

interface SectionCfg {
  /** Per-product instruction; Governor is the default focus. */
  instruction: string | ((product: BitoProduct) => string);
  schema: string;
  maxSearches: number;
  // Merge the parsed result into the cached brief.
  merge: (intel: CompanyIntel, parsed: Record<string, unknown>) => void;
}

const SECTIONS: Record<string, SectionCfg> = {
  whyBito: {
    instruction: (product) =>
      product === "ai_architect"
        ? "Give 3-4 evidence-tied reasons THIS company is a fit for Bito AI Architect (context layer, code review, design and scoping) — each grounded in a specific, real fact about them (scale, stack, review load, cross-repo complexity). No generic claims."
        : "Give 3-4 evidence-tied reasons THIS company is a fit for Governor — each grounded in a specific, real fact about them (coding-agent and harness adoption, model providers or gateways, agent token spend, engineering scale, cross-repo complexity) and each stated as a consequence for cost per successful task, task time, tool calls, or task success across their agents and models. Architecture facts explain why the context lever matters; they are never a standalone context-layer pitch. Say which lever (context up front, or model routing) each reason rests on. No generic claims.",
    schema: `{"whyBito":["evidence-tied reason","...","..."]}`,
    maxSearches: 2,
    merge: (intel, p) => {
      intel.whyBito = (Array.isArray(p.whyBito) ? p.whyBito : []).map(String).filter(Boolean).slice(0, 5);
    },
  },
  painPoints: {
    instruction: (product) =>
      product === "ai_architect"
        ? "Identify up to 4 likely engineering pain points for this company that Bito AI Architect addresses, each grounded in a specific evidenced fact. For each: a short title, severity (HIGH|MEDIUM|LOW), a category, the evidence, and which AI Architect capability (context layer, code review, design and scoping) solves it."
        : "Identify up to 4 likely engineering pain points for this company that Governor addresses, each grounded in a specific evidenced fact. For each: a short title, severity (HIGH|MEDIUM|LOW), a category, the evidence, and how Governor solves it — naming the lever: context up front (fewer turns, tool calls and tokens per task; higher task success) or model routing (price per token, one model policy). Never attribute the published context figures to routing.",
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
      "Estimate this company's monthly AI dev-tooling spend using REAL public anchors (Copilot Business ~$19/seat/mo, Copilot Enterprise ~$39, Cursor Business ~$40) times an evidenced engineering-seat estimate. This is a MODELED estimate: state every assumption in notes and label it as modeled, never as the company's known spend. bitoOffsetUsd = the slice Governor's CONTEXT lever could offset, modeled from the published ~47% token-cost-per-task figure applied to the agent-token portion only; say so in notes, and never attribute it to routing (routing lowers price per token and has no published benchmark).",
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
  let body: {
    company?: string;
    segment?: string;
    summary?: string;
    section?: string;
    /** The brief's product focus; Governor when absent (older briefs). */
    productFocus?: string;
  };
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

  const product: BitoProduct = body.productFocus === "ai_architect" ? "ai_architect" : "governor";
  const instruction = typeof cfg.instruction === "function" ? cfg.instruction(product) : cfg.instruction;
  const system = `${bitoContextFor(product)}

You are Bito's GTM analyst. For the company below, produce ONLY the requested section as JSON — grounded in real, web-verified facts. The brief this section belongs to pitches ${
    product === "ai_architect" ? "AI Architect" : "Governor"
  }; stay on that product. Keep measured results, modeled estimates and customer assumptions visibly distinct. Context you already have:
COMPANY: ${company}${body.segment ? ` (${body.segment})` : ""}
SUMMARY: ${body.summary || "(none provided — research the company)"}

TASK: ${instruction}

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
