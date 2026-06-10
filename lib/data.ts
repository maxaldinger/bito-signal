import type { Segment, SignalType, SegmentId } from "./types";

// ---------------------------------------------------------------------------
// Bito's ICP segments — the kinds of SWE-heavy orgs we sell into.
// ---------------------------------------------------------------------------
export const SEGMENTS: Segment[] = [
  {
    id: "saas",
    label: "B2B SaaS",
    icon: "Cloud",
    blurb: "growth-stage SaaS with 50-500 engineers and an aging core codebase",
  },
  {
    id: "fintech",
    label: "Fintech / Payments",
    icon: "CircleDollarSign",
    blurb: "payments, banking, trading — strict review bar, large monorepos",
  },
  {
    id: "devtools",
    label: "Dev Infra / Tools",
    icon: "Terminal",
    blurb: "platform & developer tools — heavy OSS footprint and PR throughput",
  },
  {
    id: "marketplace",
    label: "Marketplace / E-comm",
    icon: "Store",
    blurb: "high-throughput marketplaces with sprawling service architectures",
  },
  {
    id: "ai",
    label: "AI-Native",
    icon: "Sparkles",
    blurb: "AI / ML companies shipping fast — already token-spending, code-heavy",
  },
  {
    id: "enterprise",
    label: "Enterprise Modernizing",
    icon: "Building2",
    blurb: "large enterprises with legacy code modernizing on AI tooling",
  },
];

export const SEGMENT_MAP: Record<SegmentId, Segment> = Object.fromEntries(
  SEGMENTS.map((s) => [s.id, s])
) as Record<SegmentId, Segment>;

// ---------------------------------------------------------------------------
// Signal taxonomy — sources we ask claude-sonnet-4 to search for.
// ---------------------------------------------------------------------------
export const SIGNAL_TYPES: SignalType[] = [
  {
    id: "hiring",
    label: "Engineering Hiring",
    color: "#34d399",
    description: "Job posts, hiring sprees, eng team build-out language",
  },
  {
    id: "oss",
    label: "OSS / GitHub Activity",
    color: "#a78bfa",
    description: "Major releases, repo activity, OSS commentary",
  },
  {
    id: "ma",
    label: "M&A",
    color: "#f59e0b",
    description: "Acquisitions & mergers creating codebase complexity",
  },
  {
    id: "funding",
    label: "Funding + Eng Build-out",
    color: "#38bdf8",
    description: "Rounds explicitly earmarked for engineering / platform",
  },
  {
    id: "ai",
    label: "AI Tooling Signals",
    color: "#f472b6",
    description: "Public commentary on AI tooling spend, adoption or pain",
  },
];

export const SIGNAL_TYPE_MAP: Record<string, SignalType> = Object.fromEntries(
  SIGNAL_TYPES.map((s) => [s.id, s])
);

// ---------------------------------------------------------------------------
// Example companies for the quick-search row. The search is open — the model
// will resolve to canonical names — but these give the user a fast on-ramp.
// ---------------------------------------------------------------------------
export const EXAMPLE_COMPANIES = [
  "Ramp",
  "Mercury",
  "Linear",
  "Vercel",
  "Notion",
  "Datadog",
  "Plaid",
  "Brex",
  "Faire",
];
