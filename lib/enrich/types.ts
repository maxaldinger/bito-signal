// Shared contract for the enrichment layer.
//
// Each provider client (apollo.ts, hunter.ts, github.ts, proxycurl.ts,
// crunchbase.ts) exports a single async function that NEVER throws and
// resolves to a ProviderResult<T>. The orchestrator route fans out to all
// configured providers and merges what came back into an EnrichmentRollup.
//
// Hard rule (project-wide): no mock or fabricated data. A provider either
// returns real API fields or an honest error — the UI renders both states.

export type ProviderId = "apollo" | "hunter" | "github" | "proxycurl" | "crunchbase";

export interface ProviderResult<T> {
  provider: ProviderId;
  /** Whether the required API key / credentials are present at all. */
  configured: boolean;
  /** Whether the call succeeded and `data` is populated. */
  ok: boolean;
  error?: string;
  data?: T;
  fetchedAt: string; // ISO timestamp
}

export interface EnrichContact {
  name: string;
  title?: string;
  email?: string;
  /** e.g. "verified" | "guessed" | "unavailable" — provider's own wording. */
  emailStatus?: string;
  confidence?: number; // 0-100 when the provider scores it
  linkedinUrl?: string;
  phone?: string;
  seniority?: string;
  department?: string;
}

// --------- Apollo.io ---------
export interface ApolloData {
  name?: string;
  domain?: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  industry?: string;
  estimatedEmployees?: number;
  annualRevenueUsd?: number;
  city?: string;
  state?: string;
  country?: string;
  /** Raw technology names Apollo reports for the org. */
  techStack: string[];
  /** Subset of techStack matching AI dev tooling (Copilot, Cursor, …). */
  aiDevTools: string[];
  /** Engineering-leadership people surfaced by people search. */
  people: EnrichContact[];
  fundingTotalUsd?: number;
  latestFundingRound?: string;
  latestFundingDate?: string;
}

// --------- Hunter.io ---------
export interface HunterData {
  domain: string;
  organization?: string;
  /** e.g. "{first}.{last}" */
  emailPattern?: string;
  emails: EnrichContact[];
  /** Present only when an explicit ?email= was verified. */
  verification?: { email: string; status: string; score?: number };
}

// --------- GitHub ---------
export interface GitHubRepoSummary {
  name: string;
  fullName: string;
  url: string;
  stars: number;
  forks: number;
  language?: string;
  pushedAt?: string;
  openIssues?: number;
  isFork: boolean;
  description?: string;
}

export interface GitHubData {
  org: string;
  orgUrl: string;
  name?: string;
  publicRepos: number;
  followers?: number;
  createdAt?: string;
  totalStars: number;
  /** language -> number of repos whose primary language it is. */
  languages: Record<string, number>;
  topRepos: GitHubRepoSummary[];
  /** Unique-contributor floor estimate across top repos (see client notes). */
  contributorEstimate?: number;
  /** Commits across the most active repos in the last 90 days (capped sample). */
  commitsLast90d?: number;
  activeReposLast90d?: number;
}

// --------- Proxycurl (LinkedIn) ---------
export interface ProxycurlData {
  name?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  totalEmployees?: number;
  employeeRange?: string;
  engineeringHeadcount?: number;
  jobOpenings?: number;
  engineeringJobOpenings?: number;
  industry?: string;
  foundedYear?: number;
  hq?: string;
  description?: string;
}

// --------- Crunchbase ---------
export interface CrunchbaseData {
  name?: string;
  permalink?: string;
  crunchbaseUrl?: string;
  website?: string;
  description?: string;
  foundedYear?: number;
  employeeRange?: string;
  totalRaisedUsd?: number;
  lastRound?: {
    type?: string;
    amountUsd?: number;
    announcedOn?: string;
    leadInvestors?: string[];
  };
  investors: string[];
  categories: string[];
}

// --------- Orchestrator output ---------
export interface EnrichmentRollup {
  domain?: string;
  totalHeadcount?: number;
  /** Only populated from a real engineering-headcount signal — never inferred. */
  sweHeadcount?: number;
  techStack: string[];
  aiDevTools: string[];
  repoCount?: number;
  totalStars?: number;
  commitsLast90d?: number;
  contributorEstimate?: number;
  topLanguages: string[];
  totalRaisedUsd?: number;
  lastRound?: string;
  emailPattern?: string;
  contacts: EnrichContact[];
}

export interface EnrichmentProfile {
  company: string;
  domain?: string;
  generatedAt: string;
  providers: {
    apollo: ProviderResult<ApolloData>;
    hunter: ProviderResult<HunterData>;
    github: ProviderResult<GitHubData>;
    proxycurl: ProviderResult<ProxycurlData>;
    crunchbase: ProviderResult<CrunchbaseData>;
  };
  rollup: EnrichmentRollup;
}

/** Names treated as AI dev tooling when found in a tech stack. */
export const AI_DEV_TOOL_MARKERS = [
  "github copilot",
  "copilot",
  "cursor",
  "codeium",
  "windsurf",
  "tabnine",
  "sourcegraph",
  "cody",
  "codewhisperer",
  "amazon q",
  "claude",
  "openai",
  "anthropic",
  "replit",
  "jetbrains ai",
];

export function pickAiDevTools(stack: string[]): string[] {
  return stack.filter((t) => {
    const v = t.toLowerCase();
    return AI_DEV_TOOL_MARKERS.some((m) => v.includes(m));
  });
}
