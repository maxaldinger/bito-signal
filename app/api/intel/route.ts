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

LinkedIn outreach — FOUR LinkedIn-NATIVE touches (not email copy), keyed off the callHook signal, in the rep's voice: a connect note, then three DMs after the accept.
STRUCTURE RULE for the DMs (most important): the signal is the HOOK, not the subject. Maximum ONE CLAUSE establishing relevance from the signal, then pivot immediately to what Bito does and the outcome. Target ~20% prospect-context, ~80% Bito mechanism + outcome. ASSERT the mechanism; do not explain it at length.
NEVER (each of these is a failure): open by narrating the prospect's own business back at them ("You built X to solve Y" — they already know; it wastes the most valuable line; the research sharpens the SENDER, it is not the message); bury what Bito does past sentence two in a substance DM; spend multiple sentences explaining the mechanism; run wordy. If a sentence describes the prospect rather than Bito or the outcome, cut it or compress it to a clause.
VOICE: mechanism-first for the DMs, OBSERVATION-first for the connect note. Never a compliment. Plain declarative sentences, direct to the point of blunt, technically literate. Draw on these exact anchor lines from the rep's sent templates: "It's the difference between an agent that knows your system and one rediscovering it every session." / "We give your AI a map of your codebase, so it stops rediscovering everything from scratch every session." / "Every session starts blind, re-crawling your repos with no memory of how the system fits together."
HARD RULES: no signature, no sign-off. Ready to paste verbatim, no placeholders like [Name].
BANNED WRITING — AI TELLS. Never emit any draft (LinkedIn or email) containing the following. Enforce at generation.
Banned single words: delve, tapestry, multifaceted, seamless, robust, comprehensive, nuanced, leverage, utilize, facilitate, crucial, pivotal, vital, essential, innovative, innovate, revolutionary, transformative, game-changer, game-changing, cutting-edge, groundbreaking, unlock, elevate, empower, streamline, optimize, foster, harness, navigate, realm, landscape, journey, treasure trove, certainly, absolutely, meticulous, ever-evolving, testament, underscore, boasts, spearhead, holistic, synergy, supercharge, turbocharge, effortless, robustly, intersection.
Banned phrases: "it's worth noting", "in today's fast-paced world", "in today's digital age", "in the ever-evolving landscape", "when it comes to", "at the end of the day", "the world of", "a testament to", "plays a crucial role", "navigate the complexities", "unlock the potential", "take your [X] to the next level", "deliver actionable insights", "meticulous attention to detail", "let's dive in", "look no further", "rest assured", "needless to say", "I hope this finds you well", "I'd love to", "hope you're doing well", "congrats on the role", "that's exactly where", "that's precisely where", "precisely", "that's a real" (and any empty validation of the prospect's situation back at them: "that's a real architectural problem", "that's a tough challenge" — never grade or affirm their situation; state the mechanism instead).
Banned structures (these override word-swapping — a draft can avoid every banned word and still be rejected on these):
- Negative parallelism: "it's not just X, it's Y" / "not about X, it's about Y" / "less about X, more about Y". Never.
- Rule-of-three fragments: three short punchy fragments in a row as a closer (e.g. "No blind spots. No rework. Just working code."). Never.
- Triple-adjective lists: "fast, scalable, and reliable". Never.
- Isolated rhetorical question as a transition: "The result? A 40% lift." Never.
- Em dashes anywhere. Use periods or commas.
Required to avoid the stiff-generated read:
- Keep contractions (you're, it's, won't, they're). Their absence reads as machine-formal.
- Vary sentence length. Do not produce 3-4 sentences all the same length. Mix a longer sentence with a short one.
- Every general claim must carry one concrete, prospect-specific detail (a real architecture fact from the signal). Generic praise of a benefit reads as AI even when no banned word is present. The specific observation defeats the AI-tell far more than word choice.
- Shorter beats fuller. Never pad toward the top of a character range. If a draft can lose 20% of its words without losing meaning, it is too wordy; cut it before emitting.
Highest-priority for this product specifically (a generator will reach for these because Bito is a developer-workflow product): never use "streamline / seamless / optimize / supercharge your workflow", "unlock developer productivity", or any workflow-benefit line. Lead with the mechanism and the prospect-specific detail instead.
- connect: HARD CAP 200 characters including spaces. Job: earn the accept, NOT to pitch. No mechanism-dump, no solution statement, no meeting ask, no links. Do NOT lead with a scraped-looking stat (never open with "50,000 Copilot seats"-style numbers; lead with the observation, not the number). One genuinely specific observation about their situation, then a plain reason to connect. It must read like a person noticed something, not like a tool populated a field.
- dm1 (substance, after accept): 300-500 characters, and aim near the BOTTOM of that range; a tight 350 beats a padded 500. One clause of relevance, mechanism by sentence two, and the MANDATORY ICP ANCHOR: work in, IN YOUR OWN WORDS, that Bito is built for big interconnected multi-repo/microservice codebases, using THIS prospect's specific architecture detail from the signal (e.g. "600+ microservices", "your multi-repo Kubernetes stack") as setup for the mechanism in the same breath, never as its own descriptive sentence. The idea to convey (never this instruction's phrasing): agents lose the thread across interconnected services and re-learn the system every session; Bito's precomputed map means they start already knowing it, and that matters more the bigger the codebase. Close with a plain soft ask ("Have time for a brief 15-minute call this week?").
- dm2 (value/give): 2-4 sentences, a DIFFERENT angle from dm1. Give-first, framed as peer-sharing ("did you see this" energy): one specific, genuinely useful drop — a relevant real development from their own signal, a real public Bito result (e.g. the published PubMatic eval), or a well-known industry development. NEVER invent an article, paper, study, or link; only reference things that are real (from the signal, the citations, or Bito's published results). No hard ask, no demo push. Builds credibility, not pressure.
- dm3 (light close): 200-350 characters. Assumes no reply to the prior touches. A NEW timing hook or angle from the signal, low pressure, soft "worth a quick look?" close. Do NOT re-explain Bito.
GOLD STANDARD — match this quality and structure. Its FACTS are calibration only: never reuse CVS, 600+ microservices, Health100, Agentforce, or Google for any other company; every fact in YOUR output comes from THIS prospect's signal.
Example signal: CVS built an internal DevEx platform across a 600+ microservice codebase; now layering agentic AI (Health100, Agentforce); Health100 launched with Google.
Example connect (~190 chars): "Saw you're layering agentic AI onto the DevEx platform your team built. I work on the same problem, agents on big multi-repo codebases. Curious how you're approaching it, worth connecting?"
Example dm1 (~360 chars): "Agents working across 600+ microservices burn most of each session re-learning how your services fit together. Bito fixes that layer. It precomputes a map of your code, commits, and tickets, so whatever agent you're running starts already knowing the architecture. The bigger the codebase, the more it matters. Have time for a brief 15-minute call this week?"
Example dm2 (~285 chars): "Separate from my last note, no ask here. We published results from an 8 week eval on a 500+ repo estate: technical design per epic went from two weeks to three days once the agents had a precomputed map of the system. Happy to send the writeup if it's useful as you scale Health100."
Example dm3 (~240 chars): "Following up on the context-layer note. Your Health100 launch with Google is accelerating the agent rollout, and the cross-repo context problem compounds fast at that scale. Worth a quick look at what our indexing does for a codebase like yours?"
Why the example works: CONNECT reads like a person who noticed something, no pitch, no solution statement. #1 names their architecture as setup, mechanism by sentence two, ICP anchored, tight, then asks. #2 gives something real with no ask. #3 fresh timing hook, no re-explaining.
ANTI-TEMPLATE RULE: the example sets the QUALITY BAR; it is NOT a template. Never reuse its sentence skeletons or any phrasing from these instructions. If your draft could be produced by swapping this prospect's nouns into the example, rewrite it from scratch with a different structure. Two prospects must never receive structurally identical messages.

Email opener — ONE or TWO sentences, pasted as a personalized lead-in ABOVE a templated email body (it is a lead-in, not a paragraph). Same voice and hard rules as the LinkedIn messages: mechanism-first, no em dashes, no fluff, specific never generic. It must draw from the callHook signal but frame it from a DIFFERENT angle than the LinkedIn connect note — a prospect who receives both the email and the connect request must never see the same observation twice (different fact, different framing, or a different consequence of the same signal).

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
  "linkedinOutreach": { "connect": "observation-led connect note, HARD CAP 200 chars", "dm1": "substance DM, 400-600 chars", "dm2": "value/give DM, peer-share, no ask", "dm3": "light close, 200-350 chars" },
  "emailOpener": "1-2 sentence signal-specific email lead-in, different angle than the connect note",
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
  linkedinOutreach?: { connect?: string; dm1?: string; dm2?: string; dm3?: string };
  emailOpener?: string;
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
      maxTokens: 5000,
      temperature: 0.3,
    });

    const parsed = extractJSON<ModelIntel>(result.text);
    // The lean brief no longer generates onboarding (it's an on-demand expand),
    // so only require a name + a complete ICP block.
    if (!parsed || !parsed.name || !icpComplete(parsed.icp)) {
      const cause = result.truncated
        ? `the response was cut off (stop_reason: ${result.stopReason})`
        : !parsed || !parsed.name
          ? "no parseable brief came back"
          : "the brief came back without a complete ICP score";
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
      linkedinOutreach: parsed.linkedinOutreach?.connect
        ? {
            connect: enforceLinkedin(String(parsed.linkedinOutreach.connect), 200),
            dm1: enforceLinkedin(String(parsed.linkedinOutreach.dm1 || ""), 550),
            dm2: enforceLinkedin(String(parsed.linkedinOutreach.dm2 || ""), 600),
            dm3: enforceLinkedin(String(parsed.linkedinOutreach.dm3 || ""), 350),
          }
        : undefined,
      // Lead-in, not a paragraph — same dash/length hygiene as the LinkedIn set.
      emailOpener: parsed.emailOpener ? enforceLinkedin(String(parsed.emailOpener), 350) : undefined,
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

// LinkedIn-message enforcement: the prompt forbids em dashes and sets hard
// character caps, but a draft that slips through must never reach the task
// note over-cap or with a dash. Dashes become commas; over-cap text trims at
// the last sentence (preferred) or word boundary under the cap.
function enforceLinkedin(text: string, cap: number): string {
  let s = text.replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (s.length <= cap) return s;
  const slice = s.slice(0, cap);
  const lastSentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  if (lastSentence > cap * 0.5) return slice.slice(0, lastSentence + 1).trim();
  const lastWord = slice.lastIndexOf(" ");
  return (lastWord > 0 ? slice.slice(0, lastWord) : slice).trim();
}
