// Bito Signal — domain types.
//
// Bito's ICP is engineering-heavy companies with large, complex codebases.
// All signals (and the intel briefs built on top of them) are generated
// live by Anthropic claude-sonnet-4 with the web_search tool — no static
// catalogues, no scraped feeds, no warehoused data.

// --------- Signals ---------

// Signal taxonomy — what *kind* of buying signal it is.
export type SignalTypeId =
  | "hiring"   // engineering hiring announcements / surges
  | "oss"      // major OSS / GitHub activity (releases, stars, big repos)
  | "ma"       // M&A creating codebase complexity (merges, acquisitions)
  | "funding"  // funding rounds with explicit engineering build-out
  | "ai"       // AI tooling spend / public AI tooling commentary
  | "icp";     // Apollo org-search sweep — profile-fit match, no event

// Company segment — what kind of SWE-heavy org this is. Deliberately wider
// than "tech": retailers, automakers and industrials run some of the largest
// software organizations anywhere (Walmart, Toyota, Siemens class).
export type SegmentId =
  | "saas"        // pure SaaS / B2B software
  | "fintech"     // payments, banking, trading, insurance
  | "devtools"    // dev infra / platform / open-source
  | "marketplace" // marketplaces, e-commerce platforms
  | "ai"          // AI-native companies
  | "retail"      // retail & consumer (Walmart, Safeway, Nike)
  | "industrial"  // industrial & manufacturing (Siemens, GE, Bosch)
  | "auto"        // automotive & mobility (Toyota, Rivian)
  | "health"      // healthcare & life sciences (Epic, payers, pharma IT)
  | "media"       // media & entertainment (Netflix, Disney, Spotify)
  | "logistics"   // logistics & supply chain (FedEx, Flexport, Maersk)
  | "defense"     // aerospace & defense (Anduril, primes' software arms)
  | "enterprise"; // everything else with a large legacy codebase

export interface Segment {
  id: SegmentId;
  label: string;
  icon: string; // lucide-react icon name
  blurb: string;
}

export interface SignalType {
  id: SignalTypeId;
  label: string;
  color: string;
  description: string;
}

// One live signal returned by the /api/signals route.
export interface Signal {
  id: string;
  account: string;          // company name
  segment: SegmentId;
  type: SignalTypeId;

  // ICP fit (0-99) computed by the model from publicly observable proof.
  strength: number;

  title: string;            // one-line hook
  description: string;      // 1-2 sentences with concrete proof from the search
  tags: string[];           // short factual chips

  source: string;           // human-readable source (e.g. "TechCrunch")
  url?: string;             // primary citation
  date: string;             // ISO date of the underlying event

  // Optional structured detail used by the card / brief.
  sweEstimate?: number;     // SWE headcount estimate when known
  codebaseHint?: string;    // e.g. "monorepo, ~7M LoC across 40+ services"
}

// --------- ICP scoring ---------
//
// Surfaced both as a structured object (used in the brief) and as the
// overall `strength` on each signal.
export interface ICPScore {
  total: number;            // 0-99 (five sub-scores + kubernetes bonus, capped)
  // Sub-scores — each 0-20 (so five of them sum to ~100).
  sweHeadcount: number;
  codebaseComplexity: number;
  multiRepo: number;
  scalingActivity: number;
  aiToolingSpend: number;
  /**
   * Kubernetes / Distributed Systems bonus signal. Detected from: job posts
   * mentioning Kubernetes/K8s, Platform/SRE/DevOps roles requiring K8s, Helm
   * charts or k8s manifests in repos, or tech-blog microservices content.
   * Optional — briefs generated before this rule lack it.
   */
  kubernetes?: {
    detected: boolean;
    bonus: number;          // 0-10, added to total
    evidence: string;       // the specific evidence found
  };
  rationale: string;        // short markdown-ish rationale
}

// --------- Intel Brief ---------
//
// What we render when a user "Get Intel"s on an account.
// Every field is filled by the model from live web evidence.

export interface PainPoint {
  title: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  evidence: string;       // grounded quote / fact from the search
  bitoSolution: string;   // how Bito addresses it
}

export interface Stakeholder {
  role: string;
  name?: string;          // when the model surfaces a named person
  type: "feels-pain" | "signs" | "champion" | "blocker" | "influencer";
  rationale: string;
  outreachHook: string;
  linkedinQuery?: string; // search string suggestion
}

export interface Competitor {
  name: string;
  category: string;       // "AI code review" | "Copilot-class" | etc.
  weakness: string;
  bitoAdvantage: string;
  pitch: string;
}

export type Motion = "PLG" | "Top-Down" | "Champion-Led" | "Land-and-Expand";

export interface MotionRecommendation {
  primary: Motion;
  reasoning: string;
  firstMove: string;
  watchOuts: string[];
}

export interface TokenCostExposure {
  estimatedMonthlyUsd: number;
  estimatedSeats: number;       // estimated SWE seats using AI tooling
  perSeatUsd: number;            // assumed monthly cost per seat
  notes: string;                 // assumption disclosure
  bitoOffsetUsd?: number;        // how much Bito can save vs. status quo
}

export interface OnboardingFriction {
  score: number;                 // 0-99 (higher = more friction expected)
  level: "Low" | "Medium" | "High";
  drivers: string[];             // concrete reasons (e.g. "Monorepo + custom CI")
  mitigations: string[];         // playbook to reduce friction
}

export interface OutreachAngle {
  hook: string;                  // one-liner that opens a cold message
  channel: "Email" | "LinkedIn" | "Engineering Community" | "Warm Intro";
  proof: string;                 // the specific signal that justifies the angle
  draftMessage: string;          // 3-5 line draft
}

export interface LiveCitation {
  title: string;
  source: string;
  url: string;
  date?: string;
  kind: "hiring" | "oss" | "ma" | "funding" | "ai" | "news" | "other";
}

export interface CompanyIntel {
  name: string;
  domain?: string;
  segment: Segment;
  oneLiner: string;            // what the company does
  hq?: string;
  employeeBand?: string;       // "50-100", "100-500", etc.
  sweEstimate?: number;

  icp: ICPScore;
  generatedAt: string;

  summary: string;             // 2-3 sentence exec summary, evidence-backed

  // Why Bito (segment-tailored, evidence-grounded)
  whyBito: string[];

  // Stakeholder map — who feels the pain vs who signs
  stakeholders: Stakeholder[];

  // Pain points grounded in live web evidence
  painPoints: PainPoint[];

  // Competitive context
  competitors: Competitor[];

  // Motion (PLG vs top-down vs champion-led) with reasoning
  motion: MotionRecommendation;

  // Token / AI tooling cost exposure
  tokenCost: TokenCostExposure;

  // Onboarding friction
  onboarding: OnboardingFriction;

  // Specific outreach angle
  outreach: OutreachAngle;

  // Raw live citations — the actual web pages the model used.
  citations: LiveCitation[];
}
