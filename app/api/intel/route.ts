import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch, extractJSON } from "@/lib/anthropic";
import { bitoContextFor, type BitoProduct } from "@/lib/bito";
import { apolloOrgFacts } from "@/lib/enrich/apollo";
import { apolloOrgLookup } from "@/lib/githubProspect/enrich";
import { SEGMENT_MAP } from "@/lib/data";
import { CONNECT_CAP, VOICE_SPEC, enforceLinkedin } from "@/lib/outreachRules";
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
/** First couple of sentences of the model's own explanation, markdown stripped,
 *  so the reason shows up in the error banner instead of "usually transient". */
function summarizeRefusal(text: string): string {
  const plain = text
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return sentences.length > 320 ? `${sentences.slice(0, 317)}...` : sentences;
}

export const maxDuration =300;

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

// Which product the brief is about. Governor unless the rep pinned AI
// Architect, or the evidence is specifically about review / design / scoping.
const VALID_PRODUCTS: BitoProduct[] = ["governor", "ai_architect"];

// POSITIONING (Max, Sep 24 2026). Capital One's brief was branded Governor
// but substantively pitched AI Architect: every narrative field was about
// cross-repo context and agents "flying blind", routing never appeared, and
// the InMail's mechanism was "we pre-index across all the repos". This block
// makes a Governor brief about Governor, and keeps an AI Architect brief about
// AI Architect when that is genuinely what the account needs.
const POSITIONING = `PRODUCT FOCUS
The brief pitches exactly one product, recorded in "productFocus". Default: "governor". Every narrative field — summary, icp.rationale, callHook, motion.firstMove, outreach, linkedinOutreach, emailOpener — is about the product in focus.

When the focus is GOVERNOR, the brief must:
- Lead with Governor's value as the layer between the team's coding harnesses and their model providers: context optimization and model routing, together, improve cost, speed and task quality.
- Explain the two levers as DISTINCT contributions and say which does what: (1) cutting unnecessary token consumption by handing the agent the right code up front (fewer turns, fewer tool calls, fewer tokens per task, higher task success), and (2) routing each request to the appropriate model under one centralized policy (lower price per token, consistent model selection, governance). Never blur them into one claim.
- Position AI Architect as the engine behind Governor's context lever. Name it as the engine where useful; it is not the product being pitched.
- Build the business case on cost per successful task, task time, tool calls / reasoning turns, and task success maintained or improved.
- Stay customer-specific: use their architecture, integrations and scale to explain WHY the levers matter for THEM. Architectural complexity is evidence for the context lever's value, never a reason to turn the brief into a context-layer pitch. Every consequence is stated in Governor terms: what it does to cost per task, task time, tool calls and quality across their agents and their model mix.
- Keep three things visibly distinct: MEASURED results (the published figures — all measured on the context lever with the model held constant), MODELED savings (spend assumptions and estimates), and CUSTOMER ASSUMPTIONS (what you inferred about them). Never attribute context-engine benchmark gains to routing; routing's benefit is price per token and model policy and has no published benchmark. Never invent capabilities, integrations or numbers.

Choose "ai_architect" only when the evidence is specifically about code review, design and scoping, or architectural governance WITHOUT an agentic-coding cost or model-usage angle, or when the request pins it. Then keep the brief about AI Architect (context layer, review, design/scoping) and mention Governor at most once. Put a one-sentence "focusReason" either way.`;

const buildSystem = (product: BitoProduct) => `${bitoContextFor(product)}

${POSITIONING}

You are Bito's senior GTM analyst. Given a target company, research it on the live web and produce a TIGHT, evidence-grounded sales intel brief — only the fields in the schema below, no extra sections.

Research checklist (use web_search for each):
1. What the company does, HQ, headcount band, engineering headcount estimate (LinkedIn pages, about pages, recent press).
2. Engineering organization: team structure, monorepo/polyrepo hints, languages, open-source footprint, engineering blog posts.
3. Recent signals: hiring, funding, M&A, scaling pain, AI tooling adoption or commentary — and specifically for Governor: coding agents and harnesses in use (Claude Code, Cursor, Copilot agent mode, Codex), model providers or gateways (Bedrock, Azure OpenAI, Vertex, LiteLLM, Portkey, an internal gateway), who owns the AI platform or the AI tooling bill, and any public commentary on agent token cost or model selection.
4. Named engineering leaders where public (CTO, VP Eng, Head of Platform/DevEx, staff engineers who write/talk publicly).
5. Kubernetes / distributed-systems evidence: job postings mentioning "Kubernetes" or "K8s"; Platform Engineer / SRE / DevOps roles listing K8s as a requirement; GitHub repos containing Helm charts or k8s manifests; tech-blog content referencing Kubernetes or microservices architecture.

Scoring: ICP sub-scores are each 0-20 (sweHeadcount, codebaseComplexity, multiRepo, scalingActivity, aiToolingSpend). The "kubernetes" block is a SILENT BONUS folded into the score (never surfaced to the user): when you find concrete K8s/distributed-systems evidence (checklist item 5), set detected=true, quote the specific evidence, and award a bonus of +4 (indirect, e.g. one blog mention) to +10 (direct, e.g. multiple K8s-required roles or Helm charts in public repos). total = the five sub-scores + kubernetes bonus, capped at 99, and must be consistent. Score honestly — a 2,000-engineer giant or a 10-person startup scores LOW on sweHeadcount; set detected=false with bonus 0 when there is no real K8s evidence.

Motion: pick exactly one of PLG, Top-Down, Champion-Led, Land-and-Expand from the evidence (bottoms-up dev culture => PLG; strict procurement => Top-Down). Give ONE concrete firstMove (the specific first action to take) and name the key contact (real full name) it targets if found in public sources.

Outreach angle: one concrete angle tied to a specific live signal you found, with a 3-5 line draft message a rep could send today.

Outreach — a connect request, an InMail, and two timed follow-ups, keyed off the callHook signal.
${VOICE_SPEC}

PER-TOUCH STRUCTURE (jobs and caps are fixed; the voice above governs how they read):
- connect: AT MOST three short sentences, HARD CAP 300 characters including spaces, and well under it is better. Open "Hey [First],". NO subject, NO signature, NO pitch, NO mechanism, NO proof figure, NO numbers, NO diagnosis of their problem, NO restatement of their architecture. It ASKS how they're handling coding agents against their specific thing, says in one clause that this is what Max works on, and stops. See the CONNECT REQUESTS block above for the calibration examples; do not model it on the InMail example. If nothing better fits, this template is acceptable: "Hey [First], curious how you're handling coding agents across [their specific thing]. That's what I work on at Bito. Would be good to connect."
- inmail: 4 short paragraphs MAX, with a subject. Paragraph 1: the specific hook, ONE sentence, no bio restatement. Paragraph 2: the mechanism, plainly, in Governor's terms: an agent only sees the repo it's working in, so anything crossing a service boundary is a guess followed by turns of reading code to un-guess it, and every one of those turns goes to whatever model the harness defaults to. Tie that to THEIR actual architecture and model mix. Paragraph 3: what Governor does — hands the agent the right code up front (fewer turns and tool calls per task) and routes each request to the model that clears the quality bar at the lowest price — plus ONE approved figure, attributed to the context lever. Paragraph 4: base URL change, run it on their own work. Close "Let me know if it's worth a look." Sign "Max". (When productFocus is ai_architect, paragraph 3 is what AI Architect does instead and the base-URL line becomes connecting the context layer to their tools.)
- followup2 (send +5 business days if no reply): 3 paragraphs max, with a DIFFERENT subject. A new angle, not a restatement. Either a different approved figure or the methodology sentence. Never "circling back" or "following up".
- followup3 (send +10 business days if no reply): 2 short paragraphs, with its own subject. Reference a genuinely new external event ONLY if one exists in the signal and is verifiable. If none exists, make it a clean permission-to-close: ask whether this sits with someone else in the org. That question gets answered more often than the pitch does.

"[First]" is the ONLY placeholder permitted, because these are drafted per-COMPANY and reused for whichever contact the rep picks. Everything else must be paste-ready with no brackets.

Email opener — ONE or TWO sentences, pasted as a personalized lead-in ABOVE a templated email body (it is a lead-in, not a paragraph). Same voice and hard rules as the LinkedIn messages: mechanism-first, no em dashes, no fluff, specific never generic. It must draw from the callHook signal but frame it from a DIFFERENT angle than the LinkedIn connect note — a prospect who receives both the email and the connect request must never see the same observation twice (different fact, different framing, or a different consequence of the same signal).

Citations: list every distinct source you actually used.

Never include <cite> tags or any citation markup inside JSON string values — write plain prose; sources belong only in the "citations" array.

DEFUNCT, RENAMED, ACQUIRED OR AMBIGUOUS TARGETS. The company you are given comes from a stock-index list that is years out of date in places, so some of them no longer exist under that name. Do NOT answer in prose when this happens, and do NOT ask which company was meant — that reply is discarded by the caller and the whole research pass is wasted. Always return the JSON object:
- Acquired or renamed (e.g. "Twenty-First Century Fox", acquired by Disney in 2019): research the SUCCESSOR that inherited the engineering organisation, set "name" to the successor's current legal name, and open "summary" by stating the succession plainly, e.g. "Twenty-First Century Fox no longer exists; its studio and streaming assets went to The Walt Disney Company in March 2019, so this brief covers Disney." Score the successor.
- Split into several entities: pick the one that carries the software organisation, name it, and say in "summary" which parts went where.
- Genuinely nothing there, or too ambiguous to resolve: still return the object, with "name" set to the string you were given, every icp sub-score 0, and "summary" explaining in one or two sentences what you found and what the rep should search for instead.

Output ONLY one JSON object — no prose, no code fences:
{
  "name": "Canonical Company Name",
  "domain": "company.com",
  "productFocus": "governor|ai_architect",
  "focusReason": "one sentence: why this product is the one to pitch here",
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
  "linkedinOutreach": { "connect": "connect request, HARD CAP 300 chars, no subject, no signature, no proof figure", "inmail": { "subject": "lowercase 2-4 words", "body": "4 short paragraphs max, signed Max" }, "followup2": { "subject": "lowercase 2-4 words, different from the inmail subject", "body": "3 paragraphs max, new angle" }, "followup3": { "subject": "lowercase 2-4 words", "body": "2 short paragraphs" } },
  "emailOpener": "1-2 sentence signal-specific email lead-in, different angle than the connect note",
  "citations": [ { "title": "", "source": "publisher", "url": "https://...", "date": "YYYY-MM-DD or omit", "kind": "hiring|oss|ma|funding|ai|news|other" } ]
}`;

interface ModelIntel {
  name?: string;
  domain?: string;
  productFocus?: string;
  focusReason?: string;
  segment?: string;
  oneLiner?: string;
  hq?: string;
  employeeBand?: string;
  sweEstimate?: number | null;
  icp?: Partial<ICPScore>;
  summary?: string;
  callHook?: string;
  linkedinOutreach?: {
    connect?: string;
    inmail?: { subject?: string; body?: string };
    followup2?: { subject?: string; body?: string };
    followup3?: { subject?: string; body?: string };
  };
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
/** Normalize one subject+body message. Subjects are forced lowercase and
 *  stripped of colons/question marks in CODE, because the prompt asks for it
 *  but a title-cased subject is the single most visible tell that the spec was
 *  ignored. Returns undefined when there is no usable body, so a partial model
 *  response degrades to "missing" rather than an empty labelled section. */
function pickMessage(
  m: { subject?: string; body?: string } | undefined,
  cap: number,
): { subject: string; body: string } | undefined {
  const body = enforceLinkedin(String(m?.body || ""), cap);
  if (!body) return undefined;
  const subject = String(m?.subject || "")
    .toLowerCase()
    .replace(/[:?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return { subject, body };
}

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
  // ?product=ai_architect pins the brief to AI Architect (a brief explicitly
  // meant for it keeps that focus). Anything else: Governor leads and the
  // model may still choose AI Architect from the evidence.
  const productParam = req.nextUrl.searchParams.get("product")?.trim();
  const pinned: BitoProduct | undefined = (VALID_PRODUCTS as string[]).includes(productParam ?? "")
    ? (productParam as BitoProduct)
    : undefined;
  if (!fresh && supabaseConfigured()) {
    const cached = await fetchBrief(company);
    if (cached) {
      return NextResponse.json(
        { intel: cached, cached: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // Measured engineering headcount (Apollo departmental counts, two FREE
  // calls) injected as ground evidence, so the brief's SWE estimate anchors
  // on data instead of a share-of-headcount guess. Best-effort — a miss
  // changes nothing about the research pass.
  let orgFactsLine = "";
  try {
    const look = await apolloOrgLookup(company);
    const facts = look.ok && look.domain ? await apolloOrgFacts(look.domain) : null;
    if (facts && (facts.engineering || facts.employees)) {
      orgFactsLine =
        `\nMeasured headcount evidence (Apollo, LinkedIn-derived; treat as floors where LinkedIn coverage is thin, and note "engineering" includes non-software engineers at industrial companies): ` +
        `${facts.employees ? `~${facts.employees.toLocaleString()} total employees. ` : ""}` +
        `${facts.engineering ? `Engineering department ~${facts.engineering.toLocaleString()}. ` : ""}` +
        `${facts.informationTechnology ? `IT department ~${facts.informationTechnology.toLocaleString()}. ` : ""}` +
        `Anchor sweEstimate on this evidence, reconciled with anything your research finds.`;
    }
  } catch {
    /* best-effort */
  }

  try {
    const result = await callClaudeWithWebSearch({
      system: buildSystem(pinned ?? "governor"),
      user:
        `Research "${company}" and produce the lean Bito intel brief JSON. Today's date: ${new Date().toISOString().slice(0, 10)}.${orgFactsLine}` +
        (pinned
          ? `\nPRODUCT FOCUS PINNED BY THE REP: ${pinned}. Keep the whole brief about that product.`
          : ""),
      maxSearches: 6,
      // 5000 was set when outreach was four short strings. The Aug 2026 spec
      // replaced those with a connect note plus THREE subject+body messages
      // (InMail and two follow-ups), and the brief already carries stakeholders,
      // pain points, competitors, motion, cost and citations. Research-heavy
      // accounts (Lockheed Martin) then ran past the ceiling and 502'd with
      // stop_reason max_tokens. Headroom is cheap; a truncated brief costs the
      // whole research pass.
      maxTokens: 9000,
      temperature: 0.3,
    });

    const parsed = extractJSON<ModelIntel>(result.text);
    // The lean brief no longer generates onboarding (it's an on-demand expand),
    // so only require a name + a complete ICP block.
    if (!parsed || !parsed.name || !icpComplete(parsed.icp)) {
      // Log enough to diagnose the next one instead of guessing. "No parseable
      // brief" has several distinct causes (the model answered in prose, it
      // returned only tool blocks, it emitted JSON we mis-sliced) and the
      // message alone can't tell them apart.
      console.error(
        `[intel] ${company} unparseable: stop=${result.stopReason} truncated=${result.truncated} ` +
          `searches=${result.searchCount} textLen=${result.text.length} ` +
          `head=${JSON.stringify(result.text.slice(0, 200))} tail=${JSON.stringify(result.text.slice(-200))}`,
      );
      // THE MODEL ANSWERED IN PROSE. Not a parse failure and emphatically not
      // transient: it researched the company, concluded it could not write the
      // brief, and explained why in English. Observed on Twenty-First Century
      // Fox — "a defunct entity, acquired by Disney, effective March 20 2019",
      // offering Fox Corporation or Disney instead. Reporting that as "try
      // again, usually transient" sends the rep to burn another research pass
      // on a company that no longer exists.
      //
      // The explanation is the most useful thing the call produced, so it is
      // what gets shown.
      const prose = !result.truncated && !parsed && result.text.trim().length > 0;
      if (prose) {
        return NextResponse.json(
          {
            error: `No brief for "${company}" — the research came back with an explanation instead. ${summarizeRefusal(result.text)}`,
            modelNote: result.text.slice(0, 1200),
            retryable: false,
            searchCount: result.searchCount,
            searchErrors: result.searchErrors,
          },
          { status: 422, headers: { "Cache-Control": "no-store" } },
        );
      }
      const cause = result.truncated
        ? `the response was cut off (stop_reason: ${result.stopReason})`
        : !result.text.trim()
          ? "the model returned no text at all (only search calls)"
          : "the brief came back without a complete ICP score";
      return NextResponse.json(
        {
          // Don't call a truncation transient — retrying an over-budget brief
          // just burns another research pass. Say which failure it was.
          error: result.truncated
            ? `Live research pass incomplete — ${cause}. Retrying may not help: the brief is too long for the output budget.`
            : `Live research pass incomplete — ${cause}. Try again; this is usually transient.`,
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
      // A pin outranks the model's choice; otherwise the model's choice,
      // defaulting to Governor if it returned something invalid.
      productFocus:
        pinned ??
        ((VALID_PRODUCTS as string[]).includes(String(parsed.productFocus))
          ? (parsed.productFocus as BitoProduct)
          : "governor"),
      focusReason: parsed.focusReason ? String(parsed.focusReason).slice(0, 300) : undefined,
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
            // connect is a hard 300. The InMail/follow-up caps are generous
            // backstops against a runaway draft, not shaping targets — the
            // paragraph limits in the prompt do the shaping.
            connect: enforceLinkedin(String(parsed.linkedinOutreach.connect), CONNECT_CAP),
            inmail: pickMessage(parsed.linkedinOutreach.inmail, 1100),
            followup2: pickMessage(parsed.linkedinOutreach.followup2, 800),
            followup3: pickMessage(parsed.linkedinOutreach.followup3, 600),
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

// enforceLinkedin now lives in lib/outreachRules alongside the ban list, so the
// per-person connect generator applies byte-identical sanitizing.
