import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch, extractJSON } from "@/lib/anthropic";
import { BITO_CONTEXT } from "@/lib/bito";
import { apolloIcpSweep, type IcpSweepOrg } from "@/lib/enrich/apollo";
import { upsertSignals, supabaseConfigured } from "@/lib/supabase";
import type { Signal, SignalTypeId, SegmentId } from "@/lib/types";

// Live feed — we ask claude-sonnet-4 to search the public web for fresh
// buying signals across the five Bito ICP categories, then return them
// in a normalized shape the UI already understands.
//
// Two shapes:
//   GET /api/signals?type=hiring  → ONE bucket (~3 searches, ~25s). The UI
//     fires all five buckets in parallel and renders them as they land —
//     this is the fast path.
//   GET /api/signals              → full five-bucket pass in a single turn
//     (slow, kept for API consumers / curl).
//
// Force dynamic so `next build` never tries to prerender this route (that
// would call Anthropic at build time). CDN caching is handled by the
// Cache-Control header below — per-bucket URLs cache independently;
// "Refresh" in the UI busts it with a &fresh= param.
export const dynamic = "force-dynamic";
// The full pass can run past 90s — use the platform maximum.
export const maxDuration = 300;

const VALID_TYPES: SignalTypeId[] = ["hiring", "oss", "ma", "funding", "ai", "icp"];
// Buckets the model searches for; "icp" is served by Apollo, not Anthropic.
type SearchBucket = Exclude<SignalTypeId, "icp">;
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

const SYSTEM = `${BITO_CONTEXT}

You are Bito's GTM intelligence analyst. Your job is to surface concrete, real-world buying signals from the public web that point to SWE-heavy companies likely to need Bito's AI code-review platform.

Use the web_search tool aggressively. Every signal you return MUST be backed by a real, recent (last ~60 days when possible), public source — a news article, press release, job board, GitHub release, blog post, podcast transcript, conference talk, etc.

For each candidate signal you find, you score the company's Bito ICP fit on a 0-99 scale using five sub-criteria (each 0-20):
1. SWE headcount in the 50-500 sweet spot (20 = bullseye, taper outside)
2. Codebase age / complexity (monorepo, polyrepo, legacy modernization, microservices sprawl)
3. Multi-repo indicators (multiple repos, services, languages — Bito's grounding shines here)
4. Recent scaling activity (hiring sprees, new offices, customer growth driving eng load)
5. AI tooling spend signals (already paying for Copilot/Cursor; complaints about cost; AI build-out)

Cast a wide net beyond obvious tech companies. Retailers, automakers, industrials, healthcare systems, logistics carriers and media companies run some of the LARGEST software organizations anywhere — Walmart, Toyota, Siemens, FedEx and Disney all employ thousands of engineers with old, sprawling codebases and heavy review burden. A hiring push, AI-tooling story or M&A at a traditional-industry company is exactly as relevant as a startup's.

Be honest. If a signal isn't strong, give it a lower score and say why in the description. Do NOT fabricate signals. If you cannot find enough live signals, return fewer rather than inventing them.

Output ONLY a single JSON object — no prose, no code fences — matching this schema:
{
  "signals": [
    {
      "account": "Canonical company name",
      "segment": "${SEGMENT_ENUM}",
      "type": "hiring | oss | ma | funding | ai",
      "strength": 0-99,
      "title": "one-line hook (max ~70 chars)",
      "description": "1-2 sentences that quote or paraphrase the live evidence and explain Bito relevance",
      "tags": ["short fact chip", "another"],
      "source": "publisher / domain in plain English",
      "url": "https://primary-citation-url",
      "date": "YYYY-MM-DD of the underlying event",
      "sweEstimate": number or null,
      "codebaseHint": "short phrase or null"
    }
  ]
}`;

const BUCKET_BRIEFS: Record<SearchBucket, string> = {
  hiring:
    "Engineering hiring announcements: companies posting waves of senior SWE / staff / platform-engineering / DevEx roles in the last 60 days. Use sources like LinkedIn announcements, company engineering blogs, hiring trackers, TechCrunch hiring stories.",
  oss: "Major OSS / GitHub activity: notable releases, new flagship repos, or unusual repo growth from companies with paid commercial products. Use GitHub trending, company engineering blogs, HN front page.",
  ma: "M&A creating codebase complexity: acquisitions or mergers in the last ~6 months where the acquirer now has to integrate a second non-trivial codebase. Use TechCrunch, Crunchbase News, M&A wires.",
  funding:
    'Funding rounds with explicit engineering build-out language: rounds where the announcement specifically says "hire engineers", "scale platform", "build the team" — not generic "growth". Use TechCrunch, business wires.',
  ai: "AI tooling spend signals: public commentary (engineering blogs, podcasts, conference talks, Twitter/X threads) about AI dev-tool cost, adoption, or pain. Bonus if the company complains about Copilot/Cursor token cost.",
};

const SHARED_RULES = `Hard rules:
- "account" must be the canonical name of a REAL company — never an aggregator, website, list, or repo name (e.g. "GitHub Trending Projects" is invalid; the company behind the repo is what we want).
- Recency: prefer events from the last 60 days; never include anything older than 6 months.
- Never include <cite> tags or any citation markup inside JSON string values — write plain prose; sources belong only in the "url" and "source" fields.
- Avoid: companies under ~50 engineers, hobby OSS, generic funding news. Prefer companies headquartered in the US/EU with English-language sources.

Return ONLY the JSON object described in the system prompt.`;

const FULL_PROMPT = `Search the public web for 10-14 fresh buying signals that point to companies in Bito's ICP. Spread the signals across these five buckets — find 2-3 in each where possible:

1. ${BUCKET_BRIEFS.hiring}
2. ${BUCKET_BRIEFS.oss}
3. ${BUCKET_BRIEFS.ma}
4. ${BUCKET_BRIEFS.funding}
5. ${BUCKET_BRIEFS.ai}

${SHARED_RULES}`;

const bucketPrompt = (type: SearchBucket) =>
  `Search the public web for 5-8 fresh buying signals in ONE category for Bito's ICP. Each signal must be a DIFFERENT company.

CATEGORY: ${BUCKET_BRIEFS[type]}

Every signal's "type" field must be "${type}".

${SHARED_RULES}`;

interface ModelSignal {
  account: string;
  segment: string;
  type: string;
  strength: number;
  title: string;
  description: string;
  tags?: string[];
  source: string;
  url?: string;
  date?: string;
  sweEstimate?: number | null;
  codebaseHint?: string | null;
}

interface ModelResponse {
  signals?: ModelSignal[];
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Returns undefined (instead of inventing a midpoint) when the model omitted
// the score — callers drop those signals rather than fabricate a strength.
function clampScore(n: unknown): number | undefined {
  const x = Number(n);
  if (!Number.isFinite(x)) return undefined;
  return Math.max(0, Math.min(99, Math.round(x)));
}

function normalizeType(t: string): SignalTypeId {
  const v = String(t || "").toLowerCase().trim();
  return (VALID_TYPES as string[]).includes(v) ? (v as SignalTypeId) : "ai";
}

function normalizeSegment(s: string): SegmentId {
  const v = String(s || "").toLowerCase().trim();
  return (VALID_SEGMENTS as string[]).includes(v) ? (v as SegmentId) : "saas";
}

function normalizeDate(d: string | undefined): string {
  if (!d) return todayISO();
  // Accept YYYY-MM-DD, ISO, or human dates.
  const time = Date.parse(d);
  if (Number.isNaN(time)) return todayISO();
  return new Date(time).toISOString().slice(0, 10);
}

// Deterministic profile-fit score for Apollo sweep rows, by Bito affinity of
// the matched keyword. A disclosed rule, not a model guess — every card
// states the exact filters that produced it.
const ICP_KEYWORD_STRENGTH: Record<string, number> = {
  "developer tools": 78,
  "artificial intelligence": 76,
  fintech: 74,
  saas: 72,
  // Traditional industries: large in-house software orgs, but SWE share of
  // total headcount is unverified — score lower until the brief confirms.
  retail: 66,
  automotive: 66,
  manufacturing: 66,
  healthcare: 66,
  logistics: 66,
  media: 66,
};

const ICP_KEYWORD_SEGMENT: Record<string, SegmentId> = {
  "developer tools": "devtools",
  "artificial intelligence": "ai",
  fintech: "fintech",
  saas: "saas",
  retail: "retail",
  automotive: "auto",
  manufacturing: "industrial",
  healthcare: "health",
  logistics: "logistics",
  media: "media",
};

function icpSweepToSignals(orgs: IcpSweepOrg[]): Signal[] {
  return orgs.map((org, i) => ({
    id: `icp-${i}-${Date.now().toString(36)}`,
    account: org.name,
    segment: ICP_KEYWORD_SEGMENT[org.matchedKeyword] ?? "saas",
    type: "icp" as const,
    strength: ICP_KEYWORD_STRENGTH[org.matchedKeyword] ?? 70,
    title: `Profile-fit match: ${org.matchedKeyword} · ${org.employeeBand}`,
    description:
      `Surfaced by Apollo org search on Bito's ICP filters — matched "${org.matchedKeyword}" within the ${org.employeeBand} band. ` +
      `Fit score is a rule-based profile estimate; no event signal yet — run the brief for live research.`,
    tags: [org.matchedKeyword, org.employeeBand],
    source: "Apollo org search",
    url: org.linkedinUrl || org.websiteUrl,
    date: todayISO(),
    sweEstimate: undefined, // total headcount ≠ SWE count — never conflate
    codebaseHint: undefined,
  }));
}

export async function GET(req: NextRequest) {
  const typeParam = req.nextUrl.searchParams.get("type")?.trim().toLowerCase();
  const bucket: SignalTypeId | null = (VALID_TYPES as string[]).includes(
    typeParam ?? "",
  )
    ? (typeParam as SignalTypeId)
    : null;

  // Apollo-powered bucket: structured org search, no Anthropic involved.
  if (bucket === "icp") {
    const sweep = await apolloIcpSweep();
    if (!sweep.configured) {
      // Not an error — just absent. The client treats `skipped` as a quiet no-op
      // so keyless deployments don't show a permanent failure banner.
      return NextResponse.json(
        { signals: [], skipped: sweep.error },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!sweep.ok || sweep.orgs.length === 0) {
      return NextResponse.json(
        { error: sweep.error || "Apollo ICP sweep returned no organizations." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const icpSignals = icpSweepToSignals(sweep.orgs);
    const persisted = supabaseConfigured()
      ? (await upsertSignals(icpSignals)).ok
      : false;
    return NextResponse.json(
      {
        signals: icpSignals,
        persisted,
        updated: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  }

  try {
    const result = await callClaudeWithWebSearch({
      system: SYSTEM,
      user: bucket ? bucketPrompt(bucket as SearchBucket) : FULL_PROMPT,
      maxSearches: bucket ? 4 : Number(process.env.ANTHROPIC_WEB_SEARCH_MAX || 8),
      maxTokens: bucket ? 3500 : 6000,
      temperature: 0.4,
    });

    const parsed = extractJSON<ModelResponse>(result.text);
    if (!parsed || !Array.isArray(parsed.signals)) {
      const cause = result.truncated
        ? `the response was cut off (stop_reason: ${result.stopReason})`
        : "this is usually a transient issue";
      return NextResponse.json(
        {
          error: `Live search returned no parseable signals — ${cause}. Try Refresh.`,
          searchCount: result.searchCount,
          searchErrors: result.searchErrors,
          rawPreview: result.text.slice(0, 500),
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Normalize and trust the model's `url` first; only fall back to a search
    // citation if it's missing — Anthropic citations don't always line up 1:1
    // with the items the model picked.
    const citationUrls = new Set(result.citations.map((c) => c.url));
    const signals: Signal[] = parsed.signals
      .filter((s) => s && s.account && s.title && clampScore(s.strength) !== undefined)
      .map((s, i) => {
        const url = s.url && /^https?:\/\//.test(s.url) ? s.url : undefined;
        const type = bucket ?? normalizeType(s.type);
        return {
          id: `${type}-${i}-${Date.now().toString(36)}`,
          account: String(s.account).trim(),
          segment: normalizeSegment(s.segment),
          type,
          strength: clampScore(s.strength)!,
          title: String(s.title).trim(),
          description: String(s.description || "").trim(),
          tags: Array.isArray(s.tags)
            ? s.tags.map((t) => String(t)).filter(Boolean).slice(0, 6)
            : [],
          source: String(s.source || hostOf(url || "") || "Web").trim(),
          url,
          date: normalizeDate(s.date),
          sweEstimate:
            typeof s.sweEstimate === "number" && s.sweEstimate > 0
              ? Math.round(s.sweEstimate)
              : undefined,
          codebaseHint: s.codebaseHint ? String(s.codebaseHint).trim() : undefined,
        };
      });

    // Zero signals is a failed pass, not an empty market — report it as such
    // (uncached) so Refresh actually retries instead of serving a frozen miss.
    if (signals.length === 0) {
      const failedSearches =
        result.searchErrors.length > 0
          ? ` ${result.searchErrors.length} web search(es) failed (${result.searchErrors.join(", ")}).`
          : "";
      return NextResponse.json(
        {
          error: `The live pass completed but produced no usable signals.${failedSearches} Try Refresh.`,
          searchCount: result.searchCount,
          searchErrors: result.searchErrors,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Persist into the Supabase cache (upsert on account+type) so pulls
    // accumulate history; non-fatal if unconfigured or down.
    const persisted = supabaseConfigured()
      ? (await upsertSignals(signals)).ok
      : false;

    return NextResponse.json(
      {
        signals,
        persisted,
        updated: new Date().toISOString(),
        searchCount: result.searchCount,
        searchErrors: result.searchErrors,
        citations: result.citations,
        // Useful in the UI footer to be honest about what was actually fetched.
        sources: Array.from(citationUrls).slice(0, 12),
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
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
    return "";
  }
}
