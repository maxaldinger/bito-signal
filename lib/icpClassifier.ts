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

export interface ICPVerdict {
  classification: ICPClass;
  confidence: ICPConfidence;
  ownsDevTooling: boolean;
  reason: string;
  recommendedAction: string;
  /** The call failed or returned something unparseable. The classification
   *  field is a placeholder, NOT a judgement — never count it as "screened
   *  out", and fall back to the seniority heuristic instead. */
  failed?: boolean;
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

ANCHOR — Owns developer tooling, platform, or engineering infrastructure decisions for a large engineering population. Their scope statement must contain concrete evidence of this: platform engineering, developer productivity, developer experience, engineering technology, SRE, DevOps, build and release, internal tooling, or direct ownership of a large application engineering org. Title alone never qualifies someone as ANCHOR.

TARGET — Senior engineering leadership adjacent to the tooling decision. Influences it, uses it, or can bring the anchor into the room, but does not set the toolchain themselves.

ROUTER — Senior enough to redirect you internally but does not own the budget or the decision. Generic CIOs, business-unit CIOs, product executives, and corporate IT leaders belong here. They are worth one message asking who owns developer tooling, not a pitch.

PASS — No plausible connection to how code gets written or what it costs to run agents against it. Hardware-primary engineering, business or GM titles wearing technical labels, individual contributors with no scope.

Rules

Judge scope, not title. "Chief Information Officer" at a large enterprise usually means corporate IT, security, and vendor management, and at banks and other large firms there are often several divisional CIOs with no authority over product engineering toolchains. Default a bare CIO to ROUTER. Promote only when the profile shows explicit ownership of engineering platform or developer tooling. A combined CIO/CTO title is worth evaluating individually rather than defaulting.

Write a distinct rationale for every contact, grounded in that specific person's scope, title language, or stated responsibilities. Never reuse phrasing across contacts. If two contacts would receive the same rationale, that is a signal you have not actually evaluated them and you should re-read their profiles.

If the available information does not support a confident tier, output UNSCORED with a one-line statement of what is missing. Do not fill the gap with a generic account-level claim about the company.

Do not assert what a contact controls unless the source text supports it. "Dev tooling decisions terminate here" is a claim about a specific person's authority and requires evidence.

Output per contact

Tier, then two sentences maximum: what this person actually owns, and why that does or does not put them near the purchase.

OUTPUT FORMAT
You will be given a numbered list of contacts. Respond with ONLY a JSON array, no markdown fences, one object per contact IN THE SAME ORDER:
[
  {
    "n": 1,
    "tier": "ANCHOR" | "TARGET" | "ROUTER" | "PASS" | "UNSCORED",
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
  confidence?: unknown;
  owns_dev_tooling?: unknown;
  rationale?: unknown;
  next_step?: unknown;
}

function toVerdict(raw: RawVerdict | undefined): ICPVerdict {
  const tier = String(raw?.tier ?? "").toUpperCase() as ICPClass;
  const conf = String(raw?.confidence ?? "").toLowerCase() as ICPConfidence;
  if (!CLASSES.includes(tier)) {
    return {
      classification: "UNSCORED",
      confidence: "low",
      ownsDevTooling: false,
      reason: "Scorer returned no usable tier for this contact",
      recommendedAction: "retry",
      failed: true,
    };
  }
  return {
    classification: tier,
    confidence: ["high", "medium", "low"].includes(conf) ? conf : "low",
    ownsDevTooling: raw?.owns_dev_tooling === true,
    reason: String(raw?.rationale ?? "").slice(0, 300),
    recommendedAction: String(raw?.next_step ?? "").slice(0, 120),
  };
}

function failedVerdict(why: string): ICPVerdict {
  return {
    classification: "UNSCORED",
    confidence: "low",
    ownsDevTooling: false,
    reason: why,
    recommendedAction: "retry",
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
  const batches: ICPProfileInput[][] = [];
  for (let i = 0; i < inputs.length; i += batchSize) batches.push(inputs.slice(i, i + batchSize));
  // A handful of batches at once is fine; thirty single calls was not.
  const results = await Promise.all(batches.map((b) => scoreBatch(b)));
  return results.flat();
}
