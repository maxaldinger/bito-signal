// Contact tiering — scores each surfaced profile by what they actually own,
// before they reach the review queue.
//
// This replaces title regexes as the qualification gate. A regex can't tell
// "Senior Director, Engineering and Asset Optimization" (a plant job) from
// "Director of Engineering Platform" (the buyer). Titles are natural language;
// score them with a model.
//
// Contacts are scored A PAGE AT A TIME, not one call each. Two reasons: the
// spec requires a distinct rationale per contact ("if two contacts would
// receive the same rationale, you have not evaluated them"), which is
// impossible when each call is blind to the others; and a page used to fire ~30
// concurrent Haiku calls, which is exactly the burst shape that draws a 429 and
// made an outage look like a screening decision.
//
// Runs on FAST_MODEL (Haiku) with web_search OFF — pure reasoning over text the
// caller already has, so it bills tokens only, no search fees.

import { callClaudeWithWebSearch, extractJSON, FAST_MODEL } from "./anthropic";

export type ICPClass = "ANCHOR" | "TARGET" | "ROUTER" | "PASS" | "UNSCORED";
export type ICPConfidence = "high" | "medium" | "low";

/** Fixed vocabulary for WHY a contact landed where it did. Free prose was
 *  unauditable: two contacts could be dropped for the same reason described two
 *  different ways, and a tier with no vocabulary behind it is decoration. Every
 *  verdict carries one of these. */
export type ICPReasonCode =
  // Exclusions — deterministic, decided by title before the model is consulted.
  | "DEVOPS_SRE"
  | "CUSTOMER_FACING"
  | "CIO_CISO_ORG"
  | "SECURITY_RISK_COMPLIANCE"
  | "ENTERPRISE_ARCHITECTURE"
  | "PRODUCT_MANAGEMENT"
  | "NETWORK_EMBEDDED"
  | "DATA_ML_AI"
  | "NOT_ENGINEERING"
  // Inclusions — assigned by the scorer.
  | "OWNS_DEV_PLATFORM"
  | "ENG_LEADER_NAMED_SURFACE"
  | "ENG_LEADER_ADJACENT"
  | "CAN_REDIRECT"
  | "UNKNOWN";

/** Human-readable label for a reason code, used on the card. */
export const REASON_LABEL: Record<ICPReasonCode, string> = {
  DEVOPS_SRE: "devops / sre",
  CUSTOMER_FACING: "customer-facing",
  CIO_CISO_ORG: "cio / ciso org",
  SECURITY_RISK_COMPLIANCE: "security / risk / compliance",
  ENTERPRISE_ARCHITECTURE: "enterprise architecture",
  PRODUCT_MANAGEMENT: "product management",
  NETWORK_EMBEDDED: "network / embedded",
  DATA_ML_AI: "data / ml / ai",
  NOT_ENGINEERING: "not engineering",
  OWNS_DEV_PLATFORM: "owns dev platform",
  ENG_LEADER_NAMED_SURFACE: "eng leader, named surface",
  ENG_LEADER_ADJACENT: "eng leadership, adjacent",
  CAN_REDIRECT: "can redirect internally",
  UNKNOWN: "insufficient signal",
};

export interface ICPVerdict {
  classification: ICPClass;
  confidence: ICPConfidence;
  ownsDevTooling: boolean;
  reason: string;
  recommendedAction: string;
  /** Fixed-vocabulary code behind the tier. */
  reasonCode: ICPReasonCode;
  /** True when the tier came from the deterministic title filter rather than
   *  the model — these are policy, not judgement, and cost no tokens. */
  hardFiltered?: boolean;
  /** The call failed or returned something unparseable. The classification
   *  field is a placeholder, NOT a judgement — never count it as "screened
   *  out", and fall back to the seniority heuristic instead. */
  failed?: boolean;
}

// ---------------------------------------------------------------------------
// HARD EXCLUSIONS
//
// Max's rule, Aug 2026: these are filters, not judgement calls. A model asked
// to weigh "Director, Network DevOps" will sometimes find a reason to keep it;
// a regex will not. Applied BEFORE the scorer, so excluded contacts cost no
// tokens either.
//
// Ordered: the first match wins, so put the compound cases (network devops,
// office of the CIO) ahead of the general ones.
// ---------------------------------------------------------------------------
const HARD_EXCLUSIONS: Array<{ code: ICPReasonCode; re: RegExp; why: string }> = [
  {
    // Network + DevOps is infrastructure twice over. Checked first so it is
    // reported as the network case rather than the generic devops one.
    code: "NETWORK_EMBEDDED",
    re: /\bnetwork\s+(?:dev\s*ops|devops|sre|reliability|engineering)\b/i,
    why: "Network engineering, not application engineering. Infrastructure on both axes.",
  },
  {
    code: "DEVOPS_SRE",
    re: /\bdev\s*ops\b|\bdevsecops\b|\bsre\b|\bsite\s+reliability\b|\bbuild\s*(?:&|and)\s*release\b|\brelease\s+engineering\b|\bci\s*\/?\s*cd\b|\bobservability\b/i,
    why: "DevOps/SRE tooling budget is CI/CD, observability and deployment pipelines. They buy Datadog and Harness, not coding agents.",
  },
  {
    code: "CUSTOMER_FACING",
    re: /\bfield\b|\bcustomer\b|\bclient\b|\bsolutions?\s+(?:architect|engineer|consult)|\bsolution\s+architect|\bprofessional\s+services\b|\bsales\s+engineer|\bpre-?sales\b|\bsupport\b|\bservices?\s+delivery\b|\bcustomer\s+success\b/i,
    why: "Customer-facing or pre-sales. Advisory work against someone else's codebase, or a small isolated stack.",
  },
  {
    code: "CIO_CISO_ORG",
    re: /\boffice\s+of\s+the\s+(?:cio|ciso|cto)\b|\bchief\s+of\s+staff\b|\bcorporate\s+(?:it|systems|technology)\b|\b(?:internal|enterprise)\s+it\b|\bit\s+operations\b/i,
    why: "CIO org owns internal IT, corporate systems and vendor management, not the product engineering codebase.",
  },
  {
    code: "SECURITY_RISK_COMPLIANCE",
    re: /\bciso\b|\binformation\s+security\b|\bcyber\b|\bsecurity\s+(?:engineering|architect|operations|officer)\b|\bgrc\b|\bcompliance\b|\brisk\b|\bgovernance\b|\baudit\b|\bprivacy\b/i,
    why: "Security and risk own posture and will only ever appear as a blocker in the deal, never a buyer.",
  },
  {
    code: "ENTERPRISE_ARCHITECTURE",
    re: /\benterprise\s+architect/i,
    why: "Enterprise Architecture sets standards and advises. It does not own the engineering tooling budget.",
  },
  {
    code: "PRODUCT_MANAGEMENT",
    re: /\bproduct\s+(?:owner|manage|management|manager)\b|\btechnical\s+product\b|\bprogram\s+manage|\bscrum\b|\bagile\s+coach\b/i,
    why: "Product owns process and roadmap, not repos.",
  },
  {
    code: "NETWORK_EMBEDDED",
    re: /\bnetwork\b|\bwireless\b|\brf\b|\bradio\b|\bbroadband\b|\baccess\s+(?:network|engineering|technolog)|\bfiber\b|\bembedded\b|\bfirmware\b|\bhardware\b|\bsilicon\b|\bdevice\s+engineering\b/i,
    why: "Network / RF / embedded systems work, not application code an agent writes against.",
  },
  {
    code: "DATA_ML_AI",
    re: /\bdata\s+(?:science|scientist|engineering|analytics|platform|warehouse)\b|\banalytics\b|\bbusiness\s+intelligence\b|\bmachine\s+learning\b|\b(?:ml|mlops)\b|\bai\s+research\b|\bresearch\s+scien/i,
    why: "Data / ML / AI research is a different budget and a different codebase from application engineering.",
  },
];

// Anything technical at all. A title matching NONE of this is not an
// engineering contact — Finance, HR, Legal, Merchandising, Wealth Management.
// The seniority sweep returns those in bulk at a large enterprise.
//
// This test used to live in lib/enrich/apollo.ts, where it DELETED those people
// from the search result server-side. Same test, opposite handling: they are
// now labelled and rendered like any other exclusion. The token saving is
// unchanged, since this still runs before the model.
//
// Two groups on purpose: acronyms need BOTH word boundaries or "ai" matches
// "Aircraft"; stems need only a leading one.
const TECHNICAL =
  /\b(?:c[ti]o|ctpo|cdo|sre|ml|ai)\b|\b(?:engineer|technolog|technical|information|software|platform|infrastructur|infra|devops|reliab|architect|develop|data|machine\s*learning|cloud|digital|security)/i;

/** Deterministic exclusion by title. Returns the verdict when the contact is
 *  hard-excluded, otherwise undefined. Never consults a model.
 *
 *  TITLE ONLY, deliberately. A headline usually carries the employer ("VP
 *  Engineering at Juniper Networks"), and /\bnetwork\b/ against that would
 *  screen out every contact at Juniper, F5, Arista and Palo Alto — companies
 *  that sit in the Signal 2000. The job is in the title; the company is not our
 *  business here. */
export function hardExclude(titles?: string): ICPVerdict | undefined {
  const t = (titles || "").trim();
  if (!t) return undefined;
  const pass = (code: ICPReasonCode, why: string): ICPVerdict => ({
    classification: "PASS",
    confidence: "high",
    ownsDevTooling: false,
    reason: why,
    recommendedAction: "skip",
    reasonCode: code,
    hardFiltered: true,
  });
  for (const rule of HARD_EXCLUSIONS) {
    if (rule.re.test(t)) return pass(rule.code, rule.why);
  }
  // Last, and inverted: no technical token anywhere in the title. Checked after
  // the specific rules so a Network or Product title reports as ITSELF rather
  // than as the catch-all.
  if (!TECHNICAL.test(t)) {
    return pass(
      "NOT_ENGINEERING",
      "No technical scope in the title. A seniority sweep at a large enterprise returns Finance, HR, Legal and business leadership in bulk; this is one of those.",
    );
  }
  return undefined;
}

export interface ICPProfileInput {
  company?: string;
  headline?: string;
  titles?: string;
  description?: string;
  /** Company-level signals (eng headcount, the account's live signal). Lets the
   *  rationale reference what is happening at THIS account rather than
   *  paraphrasing the job title. */
  companySignals?: string;
}

/** Tiers that belong in the main review queue, best first. ROUTER is included:
 *  the spec says they are worth one message asking who owns developer tooling.
 *  UNSCORED is included deliberately — "we could not tell" must not silently
 *  behave like a rejection. Only PASS is screened out. */
export const QUEUE_CLASSES: ICPClass[] = ["ANCHOR", "TARGET", "ROUTER", "UNSCORED"];

/** Badge styling per tier. Lives here rather than in one component so every
 *  surface that shows a tier shows the same one. ANCHOR is the buyer and gets
 *  the strongest treatment; ROUTER is amber because it means "ask them who owns
 *  this", not "pitch them". */
export const TIER_STYLE: Record<ICPClass, string> = {
  ANCHOR: "border border-neon-600/50 bg-neon-500/20 text-neon-200",
  TARGET: "border border-sky-500/40 bg-sky-500/15 text-sky-300",
  ROUTER: "border border-amber-500/40 bg-amber-500/15 text-amber-300",
  UNSCORED: "border border-ink-700 bg-ink-800 text-ink-400",
  PASS: "border border-ink-700 bg-ink-800 text-ink-500",
};

/** Sort weight, lower is better. */
export const TIER_RANK: Record<ICPClass, number> = {
  ANCHOR: 0,
  TARGET: 1,
  ROUTER: 2,
  UNSCORED: 3,
  PASS: 4,
};

export function isQueueWorthy(v?: ICPVerdict | null): boolean {
  return !!v && QUEUE_CLASSES.includes(v.classification);
}

const SYSTEM = `You are scoring individual contacts at a target account for Bito, which sells AI coding infrastructure (a context layer and model gateway) that is purchased out of engineering tooling budget.

For each contact, output a tier and a rationale.

Tiers

ANCHOR — Owns developer tooling, platform, or engineering infrastructure decisions for a large engineering population. Their scope statement must contain concrete evidence of this: platform engineering, developer productivity, developer experience, engineering productivity, application engineering, internal developer tooling, or direct ownership of a large software engineering org. Title alone never qualifies someone as ANCHOR.

NOTE: SRE, DevOps and build/release used to count as ANCHOR evidence here. They no longer do, and contacts with those titles never reach you — they are filtered out before scoring. Their tooling budget is CI/CD, observability and deployment pipelines, which is a different purchase.

TARGET — Senior engineering leadership adjacent to the tooling decision. Influences it, uses it, or can bring the anchor into the room, but does not set the toolchain themselves.

ROUTER — Senior enough to redirect you internally but does not own the budget or the decision. Generic CIOs, business-unit CIOs, product executives, and corporate IT leaders belong here. They are worth one message asking who owns developer tooling, not a pitch.

PASS — No plausible connection to how code gets written or what it costs to run agents against it. Hardware-primary engineering, business or GM titles wearing technical labels, individual contributors with no scope.

WHAT SHOULD SURVIVE AS ANCHOR OR TARGET
VP or Director of Software Engineering, Platform Engineering, Developer Experience, Developer Productivity, Engineering Productivity, Application Engineering, or a general Engineering leader with a NAMED PRODUCT SURFACE. "VP Engineering, Checkout" is real. "VP Engineering" with no stated surface and no stated scope is UNSCORED, not TARGET.

Rules

Judge scope, not title. "Chief Information Officer" at a large enterprise usually means corporate IT, security, and vendor management, and at banks and other large firms there are often several divisional CIOs with no authority over product engineering toolchains. Default a bare CIO to ROUTER. Promote only when the profile shows explicit ownership of engineering platform or developer tooling. A combined CIO/CTO title is worth evaluating individually rather than defaulting.

Write a distinct rationale for every contact, grounded in that specific person's scope, title language, or stated responsibilities. Never reuse phrasing across contacts. If two contacts would receive the same rationale, that is a signal you have not actually evaluated them and you should re-read their profiles.

If the available information does not support a confident tier, output UNSCORED with a one-line statement of what is missing. Do not fill the gap with a generic account-level claim about the company.

Do not assert what a contact controls unless the source text supports it. "Dev tooling decisions terminate here" is a claim about a specific person's authority and requires evidence.

Output per contact

Tier, then two sentences maximum: what this person actually owns, and why that does or does not put them near the purchase.

REASON CODE — every verdict carries one, from this fixed vocabulary and no other:
  OWNS_DEV_PLATFORM         they own developer tooling / platform / dev productivity (ANCHOR)
  ENG_LEADER_NAMED_SURFACE  engineering leader with a named product surface (ANCHOR or TARGET)
  ENG_LEADER_ADJACENT       senior engineering leadership near the decision (TARGET)
  CAN_REDIRECT              senior enough to route you, does not own it (ROUTER)
  CIO_CISO_ORG              corporate IT / CIO org (ROUTER or PASS)
  ENTERPRISE_ARCHITECTURE   standards and advisory, no budget (PASS)
  PRODUCT_MANAGEMENT        process and roadmap, not repos (PASS)
  NOT_ENGINEERING           business, GM, or a technical label over a non-technical job (PASS)
  UNKNOWN                   not enough information to tier (UNSCORED)

OUTPUT FORMAT
You will be given a numbered list of contacts. Respond with ONLY a JSON array, no markdown fences, one object per contact IN THE SAME ORDER:
[
  {
    "n": 1,
    "tier": "ANCHOR" | "TARGET" | "ROUTER" | "PASS" | "UNSCORED",
    "reason_code": "<one code from the vocabulary above>",
    "confidence": "high" | "medium" | "low",
    "owns_dev_tooling": true | false,
    "rationale": "<two sentences maximum>",
    "next_step": "<max 12 words>"
  }
]
Return exactly one object for every contact you were given. For UNSCORED, the rationale is the one-line statement of what is missing.`;

const CLASSES: ICPClass[] = ["ANCHOR", "TARGET", "ROUTER", "PASS", "UNSCORED"];

interface RawVerdict {
  n?: unknown;
  tier?: unknown;
  reason_code?: unknown;
  confidence?: unknown;
  owns_dev_tooling?: unknown;
  rationale?: unknown;
  next_step?: unknown;
}

/** Codes the SCORER may return. The exclusion-only codes are reserved for the
 *  deterministic filter, so a model can't quietly relabel a hard exclusion. */
const SCORER_CODES: ICPReasonCode[] = [
  "OWNS_DEV_PLATFORM",
  "ENG_LEADER_NAMED_SURFACE",
  "ENG_LEADER_ADJACENT",
  "CAN_REDIRECT",
  "CIO_CISO_ORG",
  "ENTERPRISE_ARCHITECTURE",
  "PRODUCT_MANAGEMENT",
  "NOT_ENGINEERING",
  "UNKNOWN",
];

/** Fall back to a code implied by the tier when the model omits or invents one,
 *  so the vocabulary is never empty on a card. */
function codeForTier(tier: ICPClass): ICPReasonCode {
  if (tier === "ANCHOR") return "OWNS_DEV_PLATFORM";
  if (tier === "TARGET") return "ENG_LEADER_ADJACENT";
  if (tier === "ROUTER") return "CAN_REDIRECT";
  if (tier === "PASS") return "NOT_ENGINEERING";
  return "UNKNOWN";
}

function toVerdict(raw: RawVerdict | undefined): ICPVerdict {
  const tier = String(raw?.tier ?? "").toUpperCase() as ICPClass;
  const conf = String(raw?.confidence ?? "").toLowerCase() as ICPConfidence;
  if (!CLASSES.includes(tier)) {
    return failedVerdict("Scorer returned no usable tier for this contact");
  }
  const rawCode = String(raw?.reason_code ?? "").toUpperCase() as ICPReasonCode;
  return {
    classification: tier,
    confidence: ["high", "medium", "low"].includes(conf) ? conf : "low",
    ownsDevTooling: raw?.owns_dev_tooling === true,
    reason: String(raw?.rationale ?? "").slice(0, 300),
    recommendedAction: String(raw?.next_step ?? "").slice(0, 120),
    reasonCode: SCORER_CODES.includes(rawCode) ? rawCode : codeForTier(tier),
  };
}

function failedVerdict(why: string): ICPVerdict {
  return {
    classification: "UNSCORED",
    confidence: "low",
    ownsDevTooling: false,
    reason: why,
    recommendedAction: "retry",
    reasonCode: "UNKNOWN",
    failed: true,
  };
}

function renderProfile(p: ICPProfileInput, n: number): string {
  return [
    `${n}. Company: ${p.company || "(unknown)"}`,
    `   Headline: ${p.headline || "(none)"}`,
    `   Current title(s): ${p.titles || "(none)"}`,
    `   Scope / role description: ${p.description || "(none)"}`,
  ].join("\n");
}

/** Score one page of contacts in a single call, so the model can differentiate
 *  their rationales against each other. Never throws. */
async function scoreBatch(items: ICPProfileInput[]): Promise<ICPVerdict[]> {
  const context = items.find((i) => i.companySignals)?.companySignals;
  const user = [
    context ? `Account context (applies to all contacts below):\n${context}\n` : "",
    `Score these ${items.length} contact${items.length === 1 ? "" : "s"}. Return exactly ${items.length} object${items.length === 1 ? "" : "s"} in order.\n`,
    items.map((p, i) => renderProfile(p, i + 1)).join("\n\n"),
  ].join("\n");

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await callClaudeWithWebSearch({
        system: SYSTEM,
        user,
        model: FAST_MODEL,
        webSearch: false, // pure reasoning over supplied text — no search fees
        maxTokens: Math.min(4000, 260 * items.length + 400),
        temperature: 0,
      });
      const arr = extractJSON<RawVerdict[]>(res.text);
      if (Array.isArray(arr) && arr.length > 0) {
        // Map by the model's own `n`. Positional fallback ONLY when the array
        // is exactly the right length — otherwise a short array shifts every
        // later verdict onto the wrong person, which is worse than admitting
        // we did not get one for them.
        const aligned = arr.length === items.length;
        return items.map((_, i) => {
          const byN = arr.find((r) => Number(r?.n) === i + 1);
          if (byN) return toVerdict(byN);
          if (aligned) return toVerdict(arr[i]);
          return failedVerdict("Scorer omitted this contact from its response");
        });
      }
      lastError = "scorer returned no JSON array";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500 + Math.floor(Math.random() * 400)));
  }
  return items.map(() => failedVerdict(`Scorer unavailable (${lastError.slice(0, 80)})`));
}

/** Score a single contact (kept for callers that have exactly one). */
export async function classifyProfile(p: ICPProfileInput): Promise<ICPVerdict> {
  const [v] = await scoreBatch([p]);
  return v ?? failedVerdict("Scorer returned nothing");
}

/** Score many contacts. Batched so rationales are written against each other
 *  rather than in isolation, and so a page is a couple of calls instead of
 *  thirty concurrent ones. */
export async function classifyProfiles<T>(
  items: T[],
  toInput: (item: T) => ICPProfileInput,
  batchSize = 10,
): Promise<ICPVerdict[]> {
  if (items.length === 0) return [];
  const inputs = items.map(toInput);

  // Hard exclusions first. These are policy, not judgement, so they never reach
  // the model — which also means an org full of DevOps and Network titles costs
  // almost nothing to score. Survivors keep their original index so the returned
  // array still lines up with `items`.
  const excluded = inputs.map((p) => hardExclude(p.titles));
  const survivors: { i: number; p: ICPProfileInput }[] = [];
  inputs.forEach((p, i) => {
    if (!excluded[i]) survivors.push({ i, p });
  });

  const out: ICPVerdict[] = excluded.map(
    (v) => v ?? failedVerdict("Not scored"), // placeholder, overwritten below
  );
  if (survivors.length === 0) return out;

  const batches: { i: number; p: ICPProfileInput }[][] = [];
  for (let i = 0; i < survivors.length; i += batchSize) batches.push(survivors.slice(i, i + batchSize));
  // A handful of batches at once is fine; thirty single calls was not.
  const results = await Promise.all(batches.map((b) => scoreBatch(b.map((s) => s.p))));
  batches.forEach((batch, bi) => {
    batch.forEach((s, si) => {
      out[s.i] = results[bi][si] ?? failedVerdict("Scorer returned nothing for this contact");
    });
  });
  return out;
}
