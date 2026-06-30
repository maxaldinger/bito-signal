import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch, extractJSON } from "@/lib/anthropic";
import { BITO_CONTEXT } from "@/lib/bito";
import { SEGMENT_MAP } from "@/lib/data";
import { fetchBrief, upsertBrief, supabaseConfigured } from "@/lib/supabase";
import type {
  CompanyIntel,
  ICPScore,
  LiveCitation,
  Motion,
  SegmentId,
  Stakeholder,
} from "@/lib/types";

// Live Intel Brief: claude-sonnet-4 researches the company on the open web,
// then emits the full CompanyIntel JSON. Nothing is templated or canned —
// the model must ground every section in what it actually found.
export const maxDuration = 300;

const VALID_SEGMENTS: SegmentId[] = [
  "saas",
  "fintech",
  "devtools",
  "marketplace",
  "ai",
  "retail",
  "industrial",
  "auto",
  "health",
  "media",
  "logistics",
  "defense",
  "enterprise",
];
const SEGMENT_ENUM = VALID_SEGMENTS.join(" | ");
const VALID_MOTIONS: Motion[] = ["PLG", "Top-Down", "Champion-Led", "Land-and-Expand"];
const VALID_STAKEHOLDER_TYPES: Stakeholder["type"][] = [
  "feels-pain",
  "signs",
  "champion",
  "blocker",
  "influencer",
];

const SYSTEM = `${BITO_CONTEXT}

You are Bito's senior GTM analyst. Given a target company, research it on the live web and produce a TIGHT, evidence-grounded sales intel brief — only the fields in the schema below, no extra sections.

Research checklist (use web_search for each):
1. What the company does, HQ, headcount band, engineering headcount estimate (LinkedIn pages, about pages, recent press).
2. Engineering organization: team structure, monorepo/polyrepo hints, languages, open-source footprint, engineering blog posts.
3. Recent signals: hiring, funding, M&A, scaling pain, AI tooling adoption or commentary.
4. Named engineering leaders where public (CTO, VP Eng, Head of Platform/DevEx, staff engineers who write/talk publicly).
5. Kubernetes / distributed-systems evidence: job postings mentioning "Kubernetes" or "K8s"; Platform Engineer / SRE / DevOps roles listing K8s as a requirement; GitHub repos containing Helm charts or k8s manifests; tech-blog content referencing Kubernetes or microservices architecture.

Scoring: ICP sub-scores are each 0-20 (sweHeadcount, codebaseComplexity, multiRepo, scalingActivity, aiToolingSpend). The "kubernetes" block is a SILENT BONUS folded into the score (never surfaced to the user): when you find concrete K8s/distributed-systems evidence (checklist item 5), set detected=true, quote the specific evidence, and award a bonus of +4 (indirect, e.g. one blog mention) to +10 (direct, e.g. multiple K8s-required roles or Helm charts in public repos). total = the five sub-scores + kubernetes bonus, capped at 99, and must be consistent. Score honestly — a 2,000-engineer giant or a 10-person startup scores LOW on sweHeadcount; set detected=false with bonus 0 when there is no real K8s evidence.

Motion: pick exactly one of PLG, Top-Down, Champion-Led, Land-and-Expand from the evidence (bottoms-up dev culture => PLG; strict procurement => Top-Down). Give ONE concrete firstMove (the specific first action to take) and name the key contact (real full name) it targets if found in public sources.

Outreach angle: one concrete angle tied to a specific live signal you found, with a 3-5 line draft message a rep could send today.

Citations: list every distinct source you actually used.

Never include <cite> tags or any citation markup inside JSON string values — write plain prose; sources belong only in the "citations" array.

Output ONLY one JSON object — no prose, no code fences:
{
  "name": "Canonical Company Name",
  "domain": "company.com",
  "segment": "${SEGMENT_ENUM}",
  "oneLiner": "what they do, one line",
  "hq": "City, Country",
  "employeeBand": "e.g. 200-500",
  "sweEstimate": number or null,
  "icp": {
    "total": 0-99,
    "sweHeadcount": 0-20,
    "codebaseComplexity": 0-20,
    "multiRepo": 0-20,
    "scalingActivity": 0-20,
    "aiToolingSpend": 0-20,
    "kubernetes": { "detected": true|false, "bonus": 0-10, "evidence": "the specific K8s evidence found, or empty string" },
    "rationale": "2-3 sentences explaining the score from evidence"
  },
  "summary": "2-4 sentence executive summary grounded in findings",
  "callHook": "ONE glanceable sentence a rep can drop in a call — the single most valuable, specific signal you found (a number, event, or quote), not generic. e.g. 'Shipping 1,300+ PRs/day and accepting 20K lines of Copilot code daily — review is now the bottleneck.'",
  "motion": { "primary": "PLG|Top-Down|Champion-Led|Land-and-Expand", "firstMove": "concrete first action", "keyContactName": "the specific person the first move targets (real full name) or null if generic", "keyContactTitle": "that person's title or null" },
  "outreach": { "hook": "", "channel": "Email|LinkedIn|Engineering Community|Warm Intro", "proof": "the specific signal behind the hook", "draftMessage": "3-5 lines" },
  "citations": [ { "title": "", "source": "publisher", "url": "https://...", "date": "YYYY-MM-DD or omit", "kind": "hiring|oss|ma|funding|ai|news|other" } ]
}`;

interface ModelIntel {
  name?: string;
  domain?: string;
  segment?: string;
  oneLiner?: string;
  hq?: string;
  employeeBand?: string;
  sweEstimate?: number | null;
  icp?: Partial<ICPScore>;
  summary?: string;
  callHook?: string;
  whyBito?: string[];
  stakeholders?: Partial<Stakeholder>[];
  painPoints?: CompanyIntel["painPoints"];
  competitors?: CompanyIntel["competitors"];
  motion?: Partial<CompanyIntel["motion"]>;
  tokenCost?: Partial<CompanyIntel["tokenCost"]>;
  onboarding?: Partial<CompanyIntel["onboarding"]>;
  outreach?: Partial<CompanyIntel["outreach"]>;
  citations?: Partial<LiveCitation>[];
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number): number => {
  const x = Number(n);
  if (!Number.isFinite(x)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(x)));
};

// Trim a model-supplied name/title; treat empty or literal "null" as absent.
const cleanName = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "none" ? s : undefined;
};

// Scores must come from the model, not from defaults — a brief with a missing
// or non-numeric ICP block is incomplete and gets rejected (retryable 502)
// rather than rendered with invented midpoint values.
function icpComplete(icp: Partial<ICPScore> | undefined): icp is ICPScore {
  if (!icp) return false;
  return (
    [
      icp.total,
      icp.sweHeadcount,
      icp.codebaseComplexity,
      icp.multiRepo,
      icp.scalingActivity,
      icp.aiToolingSpend,
    ].every((v) => Number.isFinite(Number(v)))
  );
}

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company")?.trim();
  if (!company) {
    return NextResponse.json({ error: "Missing ?company=" }, { status: 400 });
  }

  // Cache-first: a previously generated brief returns instantly. ?fresh=1
  // (the "Update brief" button) skips the cache and regenerates.
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  if (!fresh && supabaseConfigured()) {
    const cached = await fetchBrief(company);
    if (cached) {
      return NextResponse.json(
        { intel: cached, cached: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  try {
    const result = await callClaudeWithWebSearch({
      system: SYSTEM,
      user: `Research "${company}" and produce the lean Bito intel brief JSON. Today's date: ${new Date().toISOString().slice(0, 10)}.`,
      maxSearches: 6,
      maxTokens: 4500,
      temperature: 0.3,
    });

    const parsed = extractJSON<ModelIntel>(result.text);
    const onboardingScored = Number.isFinite(Number(parsed?.onboarding?.score));
    if (!parsed || !parsed.name || !icpComplete(parsed.icp) || !onboardingScored) {
      const cause = result.truncated
        ? `the response was cut off (stop_reason: ${result.stopReason})`
        : !parsed || !parsed.name
          ? "no parseable brief came back"
          : "the brief came back without complete ICP / onboarding scores";
      return NextResponse.json(
        {
          error: `Live research pass incomplete — ${cause}. Try again; this is usually transient.`,
          searchCount: result.searchCount,
          searchErrors: result.searchErrors,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const segmentId: SegmentId = (VALID_SEGMENTS as string[]).includes(
      String(parsed.segment),
    )
      ? (parsed.segment as SegmentId)
      : "saas";

    // Merge model-declared citations with the URLs actually returned by the
    // web_search tool (the latter are ground truth for "what was read").
    const citations = new Map<string, LiveCitation>();
    for (const c of parsed.citations ?? []) {
      if (!c?.url) continue;
      citations.set(c.url, {
        title: c.title || c.url,
        source: c.source || hostOf(c.url),
        url: c.url,
        date: c.date,
        kind: (c.kind as LiveCitation["kind"]) || "other",
      });
    }
    for (const c of result.citations) {
      if (!citations.has(c.url)) citations.set(c.url, c);
    }

    const intel: CompanyIntel = {
      name: String(parsed.name),
      domain: parsed.domain ? String(parsed.domain) : undefined,
      segment: SEGMENT_MAP[segmentId],
      oneLiner: String(parsed.oneLiner || ""),
      hq: parsed.hq ? String(parsed.hq) : undefined,
      employeeBand: parsed.employeeBand ? String(parsed.employeeBand) : undefined,
      sweEstimate:
        typeof parsed.sweEstimate === "number" && parsed.sweEstimate > 0
          ? Math.round(parsed.sweEstimate)
          : undefined,
      icp: {
        // icpComplete() guaranteed these are numeric — clamp only bounds them.
        total: clamp(parsed.icp.total, 0, 99, 0),
        sweHeadcount: clamp(parsed.icp.sweHeadcount, 0, 20, 0),
        codebaseComplexity: clamp(parsed.icp.codebaseComplexity, 0, 20, 0),
        multiRepo: clamp(parsed.icp.multiRepo, 0, 20, 0),
        scalingActivity: clamp(parsed.icp.scalingActivity, 0, 20, 0),
        aiToolingSpend: clamp(parsed.icp.aiToolingSpend, 0, 20, 0),
        // Bonus signal — only kept when detected WITH actual evidence text.
        kubernetes:
          parsed.icp.kubernetes?.detected && String(parsed.icp.kubernetes.evidence || "").trim()
            ? {
                detected: true,
                bonus: clamp(parsed.icp.kubernetes.bonus, 0, 10, 0),
                evidence: String(parsed.icp.kubernetes.evidence).trim(),
              }
            : { detected: false, bonus: 0, evidence: "" },
        rationale: String(parsed.icp.rationale || ""),
      },
      generatedAt: new Date().toISOString(),
      summary: String(parsed.summary || ""),
      callHook: String(parsed.callHook || ""),
      whyBito: (parsed.whyBito ?? []).map(String).filter(Boolean).slice(0, 5),
      stakeholders: (parsed.stakeholders ?? [])
        .filter((s) => s?.role)
        .map((s) => ({
          role: String(s.role),
          name: s.name ? String(s.name) : undefined,
          type: VALID_STAKEHOLDER_TYPES.includes(s.type as Stakeholder["type"])
            ? (s.type as Stakeholder["type"])
            : "influencer",
          rationale: String(s.rationale || ""),
          outreachHook: String(s.outreachHook || ""),
          linkedinQuery: s.linkedinQuery ? String(s.linkedinQuery) : undefined,
        }))
        .slice(0, 8),
      painPoints: (parsed.painPoints ?? [])
        .filter((p) => p?.title)
        .map((p) => ({
          title: String(p.title),
          severity: ["HIGH", "MEDIUM", "LOW"].includes(String(p.severity))
            ? (p.severity as "HIGH" | "MEDIUM" | "LOW")
            : "MEDIUM",
          category: String(p.category || "General"),
          evidence: String(p.evidence || ""),
          bitoSolution: String(p.bitoSolution || ""),
        }))
        .slice(0, 6),
      competitors: (parsed.competitors ?? [])
        .filter((c) => c?.name)
        .map((c) => ({
          name: String(c.name),
          category: String(c.category || "Competitor"),
          weakness: String(c.weakness || ""),
          bitoAdvantage: String(c.bitoAdvantage || ""),
          pitch: String(c.pitch || ""),
        }))
        .slice(0, 5),
      motion: {
        primary: VALID_MOTIONS.includes(parsed.motion?.primary as Motion)
          ? (parsed.motion?.primary as Motion)
          : "Champion-Led",
        reasoning: String(parsed.motion?.reasoning || ""),
        firstMove: String(parsed.motion?.firstMove || ""),
        watchOuts: (parsed.motion?.watchOuts ?? []).map(String).slice(0, 4),
        keyContactName: cleanName(parsed.motion?.keyContactName),
        keyContactTitle: cleanName(parsed.motion?.keyContactTitle),
      },
      tokenCost: {
        estimatedMonthlyUsd: clamp(parsed.tokenCost?.estimatedMonthlyUsd, 0, 10_000_000, 0),
        estimatedSeats: clamp(parsed.tokenCost?.estimatedSeats, 0, 100_000, 0),
        perSeatUsd: clamp(parsed.tokenCost?.perSeatUsd, 0, 1_000, 0),
        notes: String(parsed.tokenCost?.notes || ""),
        bitoOffsetUsd:
          typeof parsed.tokenCost?.bitoOffsetUsd === "number"
            ? clamp(parsed.tokenCost.bitoOffsetUsd, 0, 10_000_000, 0)
            : undefined,
      },
      onboarding: {
        score: clamp(parsed.onboarding?.score, 0, 99, 0),
        level: ["Low", "Medium", "High"].includes(String(parsed.onboarding?.level))
          ? (parsed.onboarding?.level as "Low" | "Medium" | "High")
          : "Medium",
        drivers: (parsed.onboarding?.drivers ?? []).map(String).slice(0, 5),
        mitigations: (parsed.onboarding?.mitigations ?? []).map(String).slice(0, 5),
      },
      outreach: {
        hook: String(parsed.outreach?.hook || ""),
        channel: ["Email", "LinkedIn", "Engineering Community", "Warm Intro"].includes(
          String(parsed.outreach?.channel),
        )
          ? (parsed.outreach?.channel as CompanyIntel["outreach"]["channel"])
          : "Email",
        proof: String(parsed.outreach?.proof || ""),
        draftMessage: String(parsed.outreach?.draftMessage || ""),
      },
      citations: Array.from(citations.values()).slice(0, 16),
    };

    // Persist for instant future opens, keyed on the REQUESTED name — that's
    // what the next click looks up (the model may canonicalize differently).
    // The DB is the cache now — keep the CDN out of it so "Update brief" is
    // never masked by a stale edge copy.
    if (supabaseConfigured()) {
      await upsertBrief(company, intel);
    }

    return NextResponse.json(
      { intel, cached: false, searchCount: result.searchCount },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error talking to Anthropic.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
