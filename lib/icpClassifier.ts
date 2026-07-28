// ICP persona classifier — decides whether a surfaced profile is someone who
// actually buys developer tooling, before they reach the review queue.
//
// This replaces title regexes as the qualification gate. A regex can't tell
// "Senior Director, Engineering and Asset Optimization" (a plant job) from
// "Director of Engineering Platform" (the buyer), and the previous one silently
// rejected "Chief Technology Officer" for a word-boundary reason. Titles are
// natural language; classify them with a model.
//
// Runs on FAST_MODEL (Haiku) with web_search OFF — pure reasoning over text the
// caller already has, so it bills tokens only, no search fees.

import { callClaudeWithWebSearch, extractJSON, FAST_MODEL } from "./anthropic";

export type ICPClass = "TARGET" | "ACCOUNT_ANCHOR" | "INFLUENCER" | "REJECT";
export type ICPConfidence = "high" | "medium" | "low";

export interface ICPVerdict {
  classification: ICPClass;
  confidence: ICPConfidence;
  ownsDevTooling: boolean;
  reason: string;
  recommendedAction: string;
}

export interface ICPProfileInput {
  company?: string;
  headline?: string;
  titles?: string;
  description?: string;
  /** Company-level signals (eng headcount, job-post keywords). Materially
   *  improves ACCOUNT_ANCHOR vs REJECT at big diversified companies where the
   *  division matters more than the logo (Thermo Fisher, Danaher). */
  companySignals?: string;
}

/** Classifications that belong in the main review queue. */
export const QUEUE_CLASSES: ICPClass[] = ["TARGET", "ACCOUNT_ANCHOR"];

export function isQueueWorthy(v?: ICPVerdict | null): boolean {
  return !!v && QUEUE_CLASSES.includes(v.classification);
}

const SYSTEM = `You are a lead qualification classifier for Bito, which sells AI coding
infrastructure (a context-aware gateway that reduces token cost and improves
output quality for agentic coding tools like Copilot, Cursor, and Claude Code).

Bito's buyer is the person who owns or influences decisions about SOFTWARE
DEVELOPER TOOLING — the tools software engineers use to write, review, and
ship code — at companies with large software engineering organizations.

CRITICAL DISAMBIGUATION RULES (most misclassifications happen here):

1. "Engineering" does NOT mean software engineering by default.
   Manufacturing engineering, process engineering, plant engineering,
   validation engineering, device engineering, asset optimization, MSAT,
   operational readiness, and quality engineering are PHYSICAL-WORLD roles.
   These are automatic REJECTS regardless of seniority.

2. "AI" in a title is NEUTRAL TO NEGATIVE, not positive. Most "AI" titled
   executives are commercial AI leaders, AI governance/policy owners,
   clinical/molecular/scientific AI leaders, or data science executives.
   None of them buy developer tooling. Only score "AI" positively when it
   appears alongside software engineering ownership (e.g., "VP AI Platform
   Engineering").

3. Data/analytics executives (CDO, VP Analytics, Head of Data) are REJECTS.
   They own data platforms, not coding tools.

3b. "CIO" IS AMBIGUOUS AT FINANCIAL FIRMS. At asset managers, banks and
   insurers it usually means Chief INVESTMENT Officer, which is a
   portfolio-management role with no connection to software tooling. Titles
   like "Client Chief Investment Officer", "Deputy CIO, Fixed Income",
   "Index Equity CIO Office" are REJECTS. Only read CIO as Chief INFORMATION
   Officer when the surrounding context is technology, IT or engineering.
   The same caution applies to "Managing Director" at a bank: it is a rank,
   not a function, so classify on the rest of the title and REJECT when there
   is no engineering scope.

4. The company does NOT need to be a software company. Banks, retailers,
   grocers, manufacturers, and insurers qualify if they have a large
   software engineering org (roughly 300+ software engineers). Legacy code,
   modernization initiatives, and mainframe-to-cloud programs are POSITIVE
   signals — old sprawling codebases are the strongest fit.

CLASSIFICATION (choose exactly one):

TARGET — A senior SOFTWARE engineering leader worth contacting first. An
  explicit developer-tooling title is the strongest form of this, but it is
  NOT required — anyone leading a real software engineering organization at
  director level or above is a TARGET.
  Qualifies:
  - Explicit tooling remit: VP/Director/Head of Platform Engineering,
    Developer Productivity, Developer Experience (DevEx), Engineering
    Effectiveness, Engineering Enablement, Engineering Infrastructure,
    Developer Platform, Engineering Systems.
  - General software engineering leadership at director level or above:
    SVP/VP/Head/Senior Director/Director of Software Engineering,
    Engineering, Application Development, Software Development, Cloud
    Engineering, or a named platform/product engineering org. These people
    set or approve the toolchain their org uses even when the title does not
    say "tooling".
  - VPE or CTO at companies small enough (roughly under 5,000 engineers)
    that dev tooling rolls up to them directly.
  Do NOT reject a genuine software engineering leader merely because the
  title lacks the word "tooling", "platform", or "developer". Seniority plus
  a software (not physical-world) remit is enough.

ACCOUNT_ANCHOR — Reserved for the TOP of the house at a large enterprise:
  the person a deal terminates with, too senior to be the first touch. Use
  it ONLY for chief-level scope — CIO, CTO, Chief Digital/Technology Officer
  — at 5,000+ engineer or Fortune 500 scale. Map their org downward for the
  TARGET.
  An SVP or VP of Software Engineering is a TARGET, not an anchor, even at a
  very large company: they run an org and can start a real evaluation.

INFLUENCER — Adjacent to the buying process but not the buyer. Worth
  logging in the account map, not worth first outreach. Examples: AI
  governance/policy owners who gate which AI tools employees may use,
  enterprise architecture leaders, procurement-adjacent strategy execs at
  qualified companies.

REJECT — Everyone else. Includes ALL of: physical-world engineering roles
  (see rule 1), commercial/GTM AI executives, clinical or scientific or
  molecular AI leaders, data/analytics executives, manufacturing and
  operations leaders, consulting/GSI partner executives, product-line
  engineering leaders whose teams BUILD a product but who don't own
  company-wide dev tooling (unless the company is small enough that they
  effectively do).

Respond with ONLY valid JSON, no markdown fences, in this exact schema:

{
  "classification": "TARGET" | "ACCOUNT_ANCHOR" | "INFLUENCER" | "REJECT",
  "confidence": "high" | "medium" | "low",
  "owns_dev_tooling": true | false,
  "one_line_reason": "<max 20 words — see the rule below>",
  "recommended_action": "<max 15 words>"
}

If the role description is ambiguous between software and physical-world
engineering, classify REJECT with confidence "low" — a false negative costs
one missed lead; a false positive costs review time on every run.

ONE_LINE_REASON RULE. The reason must add information the reader does not
already have. They can see the person's name, title and company on the card, so
restating the title in other words is worthless — "likely owns or gates dev
tooling decisions" for a VP of Engineering tells them nothing.
- When "Company context" is supplied, tie the reason to THAT: what the company
  is doing and why this person's remit intersects it.
- When no company context is supplied, do not pad. Say what is genuinely
  distinguishing about the ROLE (its scope, its department, whether it is
  platform-wide or product-line), or state the honest limit, e.g. "Title only,
  no signal on their remit". An admission is more useful than filler.
NEVER phrase the reason as a paraphrase of the title.

CALIBRATION EXAMPLES

EXAMPLE 1
Company: Thermo Fisher Scientific
Title: Senior Director, Engineering and Asset Optimization, Clinical Trial Division
Description: Previously Director of Engineering at Patheon (pharma CDMO).
Correct output: {"classification": "REJECT", "confidence": "high",
"owns_dev_tooling": false, "one_line_reason": "Plant/asset engineering at
pharma manufacturing division, no software org", "recommended_action": "discard"}

EXAMPLE 2
Company: Danaher Corporation
Title: VP and Enterprise Head for AI Molecular Design
Description: Applying large-scale GenAI to protein engineering, chemistry,
and genomics.
Correct output: {"classification": "REJECT", "confidence": "high",
"owns_dev_tooling": false, "one_line_reason": "Scientific AI for drug R&D,
not software engineering", "recommended_action": "discard"}

EXAMPLE 3
Company: Thermo Fisher Scientific
Title: Senior Vice President and Chief Information Officer
Description: Enterprise IT strategy, infrastructure, vendor management.
Correct output: {"classification": "ACCOUNT_ANCHOR", "confidence": "high",
"owns_dev_tooling": true, "one_line_reason": "CIO of Fortune 150; dev
tooling decisions terminate in his org", "recommended_action": "map org
downward for platform/DevProd leader"}

EXAMPLE 4
Company: Cisco
Title: VP, Enterprise AI Strategy (AI and Automation Center)
Description: Ex-BCG partner. Leading enterprise AI strategy and governance.
Correct output: {"classification": "INFLUENCER", "confidence": "medium",
"owns_dev_tooling": false, "one_line_reason": "AI governance gate at
qualified account; not the tooling buyer", "recommended_action": "log to
account map, find platform engineering owner"}

EXAMPLE 5
Company: Intel
Title: Director of Engineering (Telemetry Based Validation)
Description: Silicon/system validation, dogfood testing, wireless QA.
Correct output: {"classification": "REJECT", "confidence": "high",
"owns_dev_tooling": false, "one_line_reason": "Hardware validation
engineering, not software developer tooling", "recommended_action": "discard"}

EXAMPLE 5b (a general software-engineering leader — TARGET, not a reject)
Company: American Express
Title: SVP, Software Engineering
Description: Leads engineering for global payments platform.
Correct output: {"classification": "TARGET", "confidence": "high",
"owns_dev_tooling": true, "one_line_reason": "Runs the payments platform org
adopting agentic AI; sets its toolchain", "recommended_action": "outreach with
TOKEN template"}
(Note: no "tooling"/"platform"/"DevEx" in the title. Senior software
engineering leadership is sufficient on its own.)

EXAMPLE 6
Company: Albertsons
Title: VP, Engineering Platform & Developer Experience
Description: Own CI/CD, internal developer platform, and engineering
tooling standards across digital and e-commerce engineering.
Correct output: {"classification": "TARGET", "confidence": "high",
"owns_dev_tooling": true, "one_line_reason": "Directly owns developer
platform and tooling at large non-tech enterprise", "recommended_action":
"outreach with TOKEN template"}`;

const CLASSES: ICPClass[] = ["TARGET", "ACCOUNT_ANCHOR", "INFLUENCER", "REJECT"];

interface RawVerdict {
  classification?: unknown;
  confidence?: unknown;
  owns_dev_tooling?: unknown;
  one_line_reason?: unknown;
  recommended_action?: unknown;
}

/** Parse + validate. Anything unrecognized falls back to a low-confidence
 *  REJECT, matching the spec's rule that ambiguity costs one lead, not a
 *  polluted queue. */
function parseVerdict(text: string): ICPVerdict {
  const raw = extractJSON<RawVerdict>(text);
  const cls = String(raw?.classification ?? "").toUpperCase() as ICPClass;
  const conf = String(raw?.confidence ?? "").toLowerCase() as ICPConfidence;
  return {
    classification: CLASSES.includes(cls) ? cls : "REJECT",
    confidence: ["high", "medium", "low"].includes(conf) ? conf : "low",
    ownsDevTooling: raw?.owns_dev_tooling === true,
    reason: String(raw?.one_line_reason ?? "").slice(0, 200) || "Unparseable classifier response",
    recommendedAction: String(raw?.recommended_action ?? "").slice(0, 200) || "discard",
  };
}

/** Classify one profile. Never throws — a failed call returns a low-confidence
 *  REJECT so a classifier outage can't silently promote junk into the queue. */
export async function classifyProfile(p: ICPProfileInput): Promise<ICPVerdict> {
  const user = [
    `Company: ${p.company || "(unknown)"}`,
    `Headline: ${p.headline || "(none)"}`,
    `Current title(s): ${p.titles || "(none)"}`,
    `Role description: ${p.description || "(none)"}`,
    `Company context (if available): ${p.companySignals || "(none)"}`,
  ].join("\n");

  try {
    const res = await callClaudeWithWebSearch({
      system: SYSTEM,
      user: `PROFILE TO CLASSIFY:\n${user}`,
      model: FAST_MODEL,
      webSearch: false, // pure reasoning over supplied text — no search fees
      maxTokens: 300,
      temperature: 0,
    });
    return parseVerdict(res.text);
  } catch {
    return {
      classification: "REJECT",
      confidence: "low",
      ownsDevTooling: false,
      reason: "Classifier call failed",
      recommendedAction: "retry",
    };
  }
}

/** Classify many profiles with bounded concurrency. Haiku is cheap but a page
 *  of 30 sequential calls is slow, and unbounded parallelism trips rate limits. */
export async function classifyProfiles<T>(
  items: T[],
  toInput: (item: T) => ICPProfileInput,
  concurrency = 8,
): Promise<ICPVerdict[]> {
  const out: ICPVerdict[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await classifyProfile(toInput(items[i]));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return out;
}
