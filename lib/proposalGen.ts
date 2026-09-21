// Proposal generation — one pipeline, both narratives.
//
// Every proposal is generated TWICE from the same account research, in
// parallel: an OPERATIONAL narrative (leads with the account's engineering
// environment, economics secondary) and a COST narrative (leads with the
// modeled economics). The page renders both as tabs (lib/proposalDoc.ts).
// What differs per narrative: which facts lead the prompt, what the model is
// told it is writing for, which fields it writes (operational writes the
// headline; cost never lets the model near a number), and the section order.
// Extracted from the route so it can run against a stored brief without an
// HTTP session (scripts/proposal-positioning-check.mts).

import { callClaudeWithWebSearch, extractJSON } from "@/lib/anthropic";
import { BITO_CONTEXT } from "@/lib/bito";
import { stripEmDashes } from "@/lib/format";
import type { PositioningMode, ProposalFields, ProposalNarrative, ProposalRoi } from "@/lib/proposalDoc";

export type { PositioningMode, ProposalNarrative };

/** Structured research a surface can hand the generator. Every field is
 *  optional; the brief fills most of them, a feed card fills two or three.
 *  The generator orders them by narrative priority and NEVER fills gaps. */
export interface ProposalResearch {
  /** The brief's executive summary. */
  summary?: string;
  /** The single strongest buying signal ("what I saw"). */
  signal?: string;
  oneLiner?: string;
  segment?: string;
  hq?: string;
  employeeBand?: string;
  /** e.g. "monorepo, ~7M LoC across 40+ services". */
  codebaseHint?: string;
  /** The ICP scorer's rationale — usually the densest architecture text. */
  icpRationale?: string;
  /** Kubernetes / distributed-systems evidence from the brief. */
  kubernetesEvidence?: string;
  /** Onboarding-friction drivers ("Monorepo + custom CI"). */
  onboardingDrivers?: string[];
  painPoints?: { title: string; evidence?: string }[];
  whyBito?: string[];
  tags?: string[];
  /** Titles of the web sources the brief used. */
  citations?: string[];
}

export interface GenerateInput {
  company: string;
  domain?: string;
  /** Legacy free-text context (feed cards still send this). */
  context?: string;
  research?: ProposalResearch;
  contactName?: string;
  contactTitle?: string;
  employees?: number;
  swe?: number;
  sweConfirmed: boolean;
  allowanceMo: number;
  spendConfirmed: boolean;
  icpTotal?: number;
}

// ROI renders as ADOPTION TIERS (10% / 25% / 50% / full org) for estimates
// above this, a single row below it. One flat "whole org × $1K/mo" number at
// Comcast scale produced a $684M "token spend" that torpedoes credibility; a
// flat 2K cap then undersold a 32,000-engineer bank. Tiers keep the pilot row
// believable AND the full-scale row on the page, each with its assumption
// visible.
const ROI_TIER_THRESHOLD = 2000;

/** The ROI table, computed — never model-written. Only when there is an
 *  engineer count to anchor it; no count means no table and no dollar
 *  headline, never a manufactured one. */
export function computeRoi(
  swe: number | undefined,
  sweConfirmed: boolean,
  allowanceMo: number,
  spendConfirmed: boolean,
): ProposalRoi | undefined {
  if (!swe) return undefined;
  const tier = (n: number, label: string) => {
    const spendYr = n * allowanceMo * 12;
    return {
      engineers: n,
      label,
      spendYr,
      savedAt47: Math.round(spendYr * 0.47),
      savedAt83: Math.round(spendYr * 0.83),
    };
  };
  // Round tier headcounts to something a human would say (nearest 100).
  const pctOf = (p: number) => Math.max(100, Math.round((swe * p) / 100 / 100) * 100);
  const tiers =
    swe > ROI_TIER_THRESHOLD
      ? [
          tier(pctOf(10), "pilot — 10% of engineers on agents"),
          tier(pctOf(25), "25% of engineers"),
          tier(pctOf(50), "50% of engineers"),
          tier(
            swe,
            sweConfirmed
              ? `full engineering org (${swe.toLocaleString()} confirmed)`
              : `full engineering org (~${swe.toLocaleString()} estimated)`,
          ),
        ]
      : [
          tier(
            swe,
            sweConfirmed
              ? `${swe.toLocaleString()} engineers (confirmed)`
              : `~${swe.toLocaleString()} estimated engineers`,
          ),
        ];
  return { allowanceMo, spendConfirmed, sweEstimate: swe, tiers };
}

// ---------------------------------------------------------------------------
// Research prioritization. The model reads the facts top to bottom and is told
// the order is the priority, so what leads the list leads the narrative.
// ---------------------------------------------------------------------------

const clip = (s: string | undefined, n: number) => (s ? s.trim().slice(0, n) : "");

function factBlocks(input: GenerateInput): Record<string, string> {
  const r = input.research ?? {};
  const swe = input.swe;
  const sweLine = swe
    ? input.sweConfirmed
      ? `Software engineers: ${swe.toLocaleString()} (confirmed by the account on a call — reliable, may be stated plainly)`
      : `Estimated software engineers: ~${swe.toLocaleString()} (LinkedIn-derived headcount data — approximate, never quote as fact)`
    : "";
  const pains = (r.painPoints ?? [])
    .slice(0, 4)
    .map((p) => `- ${p.title}${p.evidence ? `: ${clip(p.evidence, 240)}` : ""}`)
    .join("\n");
  return {
    identity: [
      `Company: ${input.company}`,
      input.domain ? `Domain: ${input.domain}` : "",
      r.segment ? `Segment: ${r.segment}` : "",
      r.oneLiner ? `What they do: ${clip(r.oneLiner, 300)}` : "",
      r.hq ? `HQ: ${r.hq}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    architecture: [
      r.kubernetesEvidence ? `Architecture / infrastructure evidence: ${clip(r.kubernetesEvidence, 900)}` : "",
      r.icpRationale ? `Codebase and org assessment: ${clip(r.icpRationale, 900)}` : "",
      r.codebaseHint ? `Codebase shape: ${clip(r.codebaseHint, 200)}` : "",
      r.onboardingDrivers?.length ? `Known technical complexity: ${r.onboardingDrivers.slice(0, 5).join("; ")}` : "",
      r.tags?.length ? `Tech signals: ${r.tags.slice(0, 10).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    summary: r.summary ? `Account summary (researched): ${clip(r.summary, 1200)}` : "",
    signal: r.signal ? `Most relevant current signal: ${clip(r.signal, 600)}` : "",
    pains: pains ? `Likely pain points (researched):\n${pains}` : "",
    initiatives: [
      r.whyBito?.length ? `Fit reasons (researched): ${r.whyBito.slice(0, 3).join(" | ")}` : "",
      r.citations?.length ? `Sources consulted: ${r.citations.slice(0, 12).join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    org: [
      typeof input.employees === "number" ? `Total employees: ~${input.employees.toLocaleString()}` : "",
      r.employeeBand && typeof input.employees !== "number" ? `Employees: ${r.employeeBand}` : "",
      sweLine,
      typeof input.icpTotal === "number" ? `Bito ICP fit score: ${input.icpTotal}/99` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    economics: [
      `Modeled per-engineer agent token allowance: $${input.allowanceMo.toLocaleString()}/month ${
        input.spendConfirmed ? "(shared by the account)" : "(an assumption, not known spend)"
      }`,
      swe ? "An ROI table is computed separately from these numbers; do not restate its figures." : "",
    ]
      .filter(Boolean)
      .join("\n"),
    legacyContext: input.context ? `Additional context: ${clip(input.context, 1500)}` : "",
  };
}

/** Facts in the narrative's priority order (Max's positioning spec, Sep 21). */
export function buildFacts(input: GenerateInput, mode: PositioningMode): string {
  const b = factBlocks(input);
  const order =
    mode === "operational"
      ? // 1 architecture · 2-4 services / languages / cloud (carried inside the
        // architecture and summary text) · 5 AI adoption (signal, pains) · 6 org
        // · 7-8 platform / modernization initiatives · 9 complexity (in
        // architecture) · 10 hiring (signal) · 11 financial estimates LAST.
        ["identity", "architecture", "summary", "signal", "pains", "org", "initiatives", "legacyContext", "economics"]
      : // 1 headcount · 2 AI adoption · 3 spend assumptions · 5 token economics
        // · 6 architecture · 7 financial impact.
        ["identity", "org", "signal", "pains", "economics", "summary", "architecture", "initiatives", "legacyContext"];
  return order
    .map((k) => b[k])
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SHARED_RULES = `Write in a direct, senior register. No hype words, no em dashes, no exclamation marks.

HARD RULES:
- Use ONLY the account facts provided, and treat their ORDER as their priority. NEVER invent initiatives, names, numbers, quotes, services, technologies, or events for the company. If a fact you would like is missing, write around it in general terms for a company of their kind; never fill the gap.
- Every paragraph must be usable by anyone at the account: never address one person, never assume a title or role.
- No statistics other than these, verbatim if used: 47% lower token cost per task; up to 68% on individual tasks; $4.12 to $2.14 per task; $6.81 to $1.13 for a full session; 51.9% to 70.1% on SWE-Bench Pro. At most two figures total across everything you write.
- Do not restate the ROI table's dollar figures; the document computes and prints those itself.`;

function modePrompt(mode: PositioningMode, company: string): string {
  if (mode === "operational") {
    return `POSITIONING MODE: OPERATIONAL

You are writing for a senior engineering leader. Lead with a specific operational problem supported by the supplied company research. Establish credibility by demonstrating understanding of their engineering environment before discussing economics. Cost savings are secondary evidence, not the opening hook. Avoid generic SaaS ROI language.

The first page must make the reader think "they actually understand how our engineering environment works", not "they ran our headcount through an ROI calculator". Draw on, where the facts support it: microservice or multi-repo architecture, cross-repo dependencies, repeated code discovery (grep / file-reading loops), agents lacking system-level context, developer time spent steering agents, duplicated context discovery, long-running agent sessions, inconsistent model selection, engineering governance, maintaining quality as AI adoption grows, large codebases, distributed ownership, service dependencies, the risk of agents changing the wrong service or missing a dependency.

Return ONLY JSON:
{"headline": "...", "subtitle": "...", "execSummary": ["p1", "p2", "p3"], "cta": "..."}
- headline: 8-14 words, names ${company} or its platform, states the operational outcome. NO dollar figures, NO percentages, NO savings claims. Good shapes: "Reducing AI Agent Overhead Across <platform>'s Microservice Architecture", "Giving Coding Agents System-Level Context Across <company>'s <platform>", "Grounding Coding Agents in <company>'s Actual Service Architecture".
- subtitle: one sentence, 15-30 words, what Governor changes for an agent working in their environment. No figures.
- execSummary: exactly 3 paragraphs, 55-95 words each. Paragraph 1: their engineering environment and workflow, built from the research (architecture, services, clouds, repos, org spread), and the operational friction that creates for coding agents. Paragraph 2: why coding agents struggle there today (rediscovering service relationships, APIs, patterns and cross-repo dependencies before useful code) and how Governor changes that workflow (context up front, consistent routing). Paragraph 3: the expected engineering impact for them, with at most one approved figure. Economics may be mentioned in one clause, framed as an additional benefit.
- cta: 40-70 words proposing an instrumented A/B on THEIR repositories and real tasks, framed around agent overhead and quality rather than the bill, ending with scheduling a brief technical kickoff.`;
  }
  return `POSITIONING MODE: COST

You are writing for an engineering or FinOps leader evaluating AI infrastructure economics. Lead with a defensible quantified business case using the supplied assumptions. Clearly distinguish modeled estimates from known customer data: modeled spend is an assumption, never their known bill. Label estimates as estimates and avoid false precision. If the facts cannot support a credible financial estimate, do not manufacture one.

Return ONLY JSON:
{"execSummary": ["p1", "p2"], "environment": ["p1"], "cta": "..."}
- execSummary: exactly 2 paragraphs, 50-90 words each. Paragraph 1: why AI development costs rise as coding agents scale at a company like theirs, tied to the provided facts (headcount, adoption signals, spend assumptions). Paragraph 2: how Governor reduces them, through context up front and model routing economics, with at most one approved figure.
- environment: 1-2 paragraphs, 40-80 words each, on their relevant engineering and architecture context from the research only. If the research is thin, one short paragraph that states only what is known.
- cta: 40-70 words proposing the controlled A/B benchmark on THEIR codebase and tasks to replace the modeled assumptions with measured numbers, ending with scheduling a brief technical kickoff.`;
}

export function buildSystemPrompt(mode: PositioningMode, company: string): string {
  return `${BITO_CONTEXT}

You write the personalized sections of a Bito GOVERNOR proposal document. Governor is Bito's context-driven model router: a transparent layer between a team's coding harness (Claude Code, Cursor, Codex, Copilot) and the models — the Code Context Engine injects the right code up front (−47% token cost per task, up to −68%), and the Model Router sends each request to the lowest-cost model that clears the quality bar. Drop-in: point the harness's base URL at Governor, nothing else changes. The document's fixed sections (how Governor works, rollout, proof points, validation, why Bito) and its ROI table are written by the system; you write only the fields requested below.

${SHARED_RULES}

${modePrompt(mode, company)}`;
}

// ---------------------------------------------------------------------------
// Generation + validation
// ---------------------------------------------------------------------------

interface GenOut {
  headline?: unknown;
  subtitle?: unknown;
  execSummary?: unknown;
  environment?: unknown;
  cta?: unknown;
}

const carriesMoneyOrPct = (t: string) => /\$|\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?[MK]\b/i.test(t);

const paras = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v
        .map((p) => stripEmDashes(String(p ?? "")).trim())
        .filter(Boolean)
        .slice(0, max)
    : [];

type NarrativeResult = { ok: true; narrative: ProposalNarrative } | { ok: false; error: string };

/** One narrative, validated. Exported so the check script can exercise a
 *  single mode; the route always generates both. */
export async function generateNarrative(input: GenerateInput, mode: PositioningMode): Promise<NarrativeResult> {
  let gen: GenOut | null = null;
  try {
    const result = await callClaudeWithWebSearch({
      system: buildSystemPrompt(mode, input.company),
      user: `Account facts, in priority order:\n\n${buildFacts(input, mode)}\n\nWrite the JSON now.`,
      webSearch: false,
      maxTokens: mode === "operational" ? 1800 : 1500,
    });
    gen = extractJSON<GenOut>(result.text);
  } catch (e) {
    return { ok: false, error: `${mode}: ${e instanceof Error ? e.message : "Generation failed"}` };
  }

  const execSummary = paras(gen?.execSummary, 3);
  const cta = typeof gen?.cta === "string" ? stripEmDashes(gen.cta).trim() : "";
  if (execSummary.length < 2 || !cta) {
    return { ok: false, error: `${mode}: the generator returned an unusable draft — try again` };
  }

  const narrative: ProposalNarrative = { execSummary, cta };
  if (mode === "operational") {
    // The headline is the narrative's whole point: a model draft carrying a
    // figure is dropped for the safe generic form, never passed through.
    const headline = typeof gen?.headline === "string" ? stripEmDashes(gen.headline).trim() : "";
    const subtitle = typeof gen?.subtitle === "string" ? stripEmDashes(gen.subtitle).trim() : "";
    if (headline && headline.length <= 120 && !carriesMoneyOrPct(headline)) narrative.headline = headline;
    if (subtitle && subtitle.length <= 240 && !carriesMoneyOrPct(subtitle)) narrative.subtitle = subtitle;
  } else {
    const environment = paras(gen?.environment, 2);
    if (environment.length > 0) narrative.environment = environment;
  }
  return { ok: true, narrative };
}

export type GenerateResult = { ok: true; fields: ProposalFields } | { ok: false; error: string };

/** Both narratives, in parallel, as one document. Either failing fails the
 *  whole generation: the page promises both tabs. */
export async function generateProposalFields(input: GenerateInput): Promise<GenerateResult> {
  const roi = computeRoi(input.swe, input.sweConfirmed, input.allowanceMo, input.spendConfirmed);
  const [op, co] = await Promise.all([generateNarrative(input, "operational"), generateNarrative(input, "cost")]);
  if (!op.ok) return { ok: false, error: op.error };
  if (!co.ok) return { ok: false, error: co.error };

  const fields: ProposalFields = {
    company: input.company,
    contactName: input.contactName,
    narratives: { operational: op.narrative, cost: co.narrative },
    // Operational is the default tab; the flattened fields mirror it for any
    // reader that predates `narratives`.
    positioningMode: "operational",
    headline: op.narrative.headline,
    subtitle: op.narrative.subtitle,
    execSummary: op.narrative.execSummary,
    cta: op.narrative.cta,
    engineers: input.swe,
    employees: input.employees,
    roi,
    generatedAt: new Date().toISOString(),
  };
  return { ok: true, fields };
}
