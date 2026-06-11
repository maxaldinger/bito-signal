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

