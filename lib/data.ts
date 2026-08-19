import type { Segment, SignalType, SegmentId } from "./types";

// ---------------------------------------------------------------------------
// Intel regions — the feed, cache, scans and Apollo sweep are all scoped to
// one region at a time; the header toggle switches between them.
// ---------------------------------------------------------------------------
export const REGIONS = [
  { id: "us", label: "US", blurb: "US / EU headquartered companies" },
  { id: "in", label: "IN", blurb: "India HQ + India engineering arms (GCCs)" },
  // Rest of world: the US and IN lenses already own those two markets, so
  // GLOBAL deliberately excludes both instead of duplicating them.
  { id: "global", label: "GLOBAL", blurb: "Headquartered outside the US and India — EU/UK, APAC, LATAM, MEA, Canada" },
] as const;

export type RegionId = (typeof REGIONS)[number]["id"];

export function isRegionId(v: unknown): v is RegionId {
  return v === "us" || v === "in" || v === "global";
}

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
    blurb: "payments, banking, trading, insurance — strict review bar, large monorepos",
  },
  {
    id: "devtools",
    label: "Dev Infra / Tools",
    icon: "Terminal",
    blurb: "platform & developer tools — heavy OSS footprint and PR throughput",
  },
  {
    id: "ai",
    label: "AI-Native",
    icon: "Sparkles",
    blurb: "AI / ML companies shipping fast — already token-spending, code-heavy",
  },
  {
    id: "marketplace",
    label: "Marketplace / E-comm",
    icon: "Store",
    blurb: "high-throughput marketplaces with sprawling service architectures",
  },
  {
    id: "retail",
    label: "Retail & Consumer",
    icon: "ShoppingCart",
    blurb: "Walmart/Safeway-class retailers — huge in-house software & platform orgs",
  },
  {
    id: "industrial",
    label: "Industrial & Mfg",
    icon: "Factory",
    blurb: "Siemens/GE-class industrials — embedded + enterprise software at scale",
  },
  {
    id: "auto",
    label: "Automotive & Mobility",
    icon: "Car",
    blurb: "Toyota/Rivian-class automakers — software-defined-vehicle teams in the thousands",
  },
  {
    id: "health",
    label: "Healthcare & Life Sci",
    icon: "HeartPulse",
    blurb: "EHR vendors, payers, pharma IT — compliance-heavy review processes",
  },
  {
    id: "media",
    label: "Media & Entertainment",
    icon: "Clapperboard",
    blurb: "streaming & gaming platforms — large consumer-scale eng orgs",
  },
  {
    id: "logistics",
    label: "Logistics & Supply Chain",
    icon: "Truck",
    blurb: "carriers, freight tech, supply-chain platforms — ops-critical codebases",
  },
  {
    id: "defense",
    label: "Aerospace & Defense",
    icon: "Shield",
    blurb: "defense tech & primes' software arms — security review is mandatory",
  },
  {
    id: "enterprise",
    label: "Enterprise / Other",
    icon: "Building2",
    blurb: "everything else with a large legacy codebase modernizing on AI tooling",
  },
];

export const SEGMENT_MAP: Record<SegmentId, Segment> = Object.fromEntries(
  SEGMENTS.map((s) => [s.id, s])
) as Record<SegmentId, Segment>;

// ---------------------------------------------------------------------------
// Signal taxonomy — sources we ask claude-sonnet-4 to search for.
// ---------------------------------------------------------------------------
// Colors are inlined as hex on chips/strength bars, so they must hold up on
// both the light (default) and dark backgrounds — mid-saturation 500/600s.
export const SIGNAL_TYPES: SignalType[] = [
  {
    id: "hiring",
    label: "Engineering Hiring",
    color: "#10b981",
    description: "Job posts, hiring sprees, eng team build-out language",
  },
  {
    id: "oss",
    label: "OSS / GitHub Activity",
    color: "#8b5cf6",
    description: "Major releases, repo activity, OSS commentary",
  },
  {
    id: "ma",
    label: "M&A",
    color: "#d97706",
    description: "Acquisitions & mergers creating codebase complexity",
  },
  {
    id: "funding",
    label: "Funding + Eng Build-out",
    color: "#0284c7",
    description: "Rounds explicitly earmarked for engineering / platform",
  },
  {
    id: "ai",
    label: "AI Tooling Signals",
    color: "#db2777",
    description: "Public commentary on AI tooling spend, adoption or pain",
  },
  {
    id: "icp",
    label: "ICP Sweep (Apollo)",
    color: "#0d9488",
    description:
      "Profile-fit accounts from Apollo org search — headcount + industry match, no event signal",
  },
];

export const SIGNAL_TYPE_MAP: Record<string, SignalType> = Object.fromEntries(
  SIGNAL_TYPES.map((s) => [s.id, s])
);

// ---------------------------------------------------------------------------
// Engineering team-size bands — sidebar filter over each signal's sweEstimate.
// Signals without an estimate match no band (they're only visible with the
// filter off; the sidebar shows how many were hidden).
// ---------------------------------------------------------------------------
export const SWE_BANDS = [
  { id: "0-50", label: "0–50", min: 0, max: 50 },
  { id: "50-250", label: "50–250", min: 50, max: 250 },
  { id: "250-500", label: "250–500", min: 250, max: 500 },
  { id: "500+", label: "500+", min: 500, max: Number.POSITIVE_INFINITY },
] as const;

export type SweBandId = (typeof SWE_BANDS)[number]["id"];

export function sweBandOf(swe?: number): SweBandId | null {
  if (typeof swe !== "number" || !(swe > 0)) return null;
  const band = SWE_BANDS.find((b) => swe >= b.min && swe < b.max);
  return band ? band.id : "500+";
}

