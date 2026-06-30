import { NextRequest, NextResponse } from "next/server";
import { apolloIcpSweep, type IcpSweepOrg } from "@/lib/enrich/apollo";
import { upsertDirectory } from "@/lib/supabase";
import type { DirectoryEntry, SegmentId } from "@/lib/types";
import type { RegionId } from "@/lib/data";

// Populate the Signal 2000 directory from Apollo org search (free, no credits):
// a broad sweep across tech-native AND traditional industries (retail, auto,
// manufacturing, healthcare, logistics, media at 5,000+ employees — the
// Walmart/Toyota class) ranked by modeled engineering size. Short brief comes
// from Apollo's short_description; the full intel brief is generated on demand.
//
//   POST /api/directory/populate?pages=8&region=us
//
// Each page fetches a fresh result set per (keyword × band), so more pages =
// more distinct companies. ~8 pages ≈ ~2,000 distinct orgs after dedup.
export const maxDuration = 300;

const SEGMENT: Record<string, SegmentId> = {
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
const TECH_NATIVE = new Set(["developer tools", "saas", "fintech", "artificial intelligence"]);

function modeledSwe(org: IcpSweepOrg): number | undefined {
  const techNative = TECH_NATIVE.has(org.matchedKeyword);
  const total =
    org.estimatedEmployees && org.estimatedEmployees > 0 ? org.estimatedEmployees : techNative ? 600 : 15000;
  const swe = Math.round(total * (techNative ? 0.35 : 0.03));
  return swe > 0 ? swe : undefined;
}

function modeledStrength(swe?: number): number {
  const base = 72;
  if (!swe) return base;
  let adj = 0;
  if (swe >= 50 && swe <= 500) adj = 8;
  else if (swe < 50) adj = -18 + Math.round((swe / 50) * 8);
  else if (swe <= 1500) adj = 2;
  else if (swe <= 5000) adj = -6;
  else adj = -14;
  return Math.max(40, Math.min(92, base + adj));
}

function briefAbout(text?: string): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return first.length > 200 ? `${clean.slice(0, 197).trimEnd()}…` : first;
}

function normKey(name: string): string {
  return name.toLowerCase().replace(/[.,]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

async function runPopulate(pages: number, region: RegionId) {
  const byKey = new Map<string, DirectoryEntry>();
  const errors: string[] = [];

  for (let page = 1; page <= pages; page++) {
    const res = await apolloIcpSweep(page, region);
    if (!res.ok) {
      errors.push(`page ${page}: ${res.error}`);
      if (!res.configured) break; // no API key — bail
      continue;
    }
    for (const org of res.orgs) {
      if (!org.name) continue;
      const key = normKey(org.name);
      if (!key || byKey.has(key)) continue;
      const swe = modeledSwe(org);
      byKey.set(key, {
        companyKey: key,
        company: org.name,
        domain: org.domain,
        segment: SEGMENT[org.matchedKeyword] ?? "enterprise",
        sweEstimate: swe,
        shortBrief: briefAbout(org.about) || `${org.matchedKeyword} company (${org.employeeBand}).`,
        employeeBand: org.employeeBand,
        estimatedEmployees: org.estimatedEmployees,
        websiteUrl: org.websiteUrl,
        linkedinUrl: org.linkedinUrl,
        strength: modeledStrength(swe),
        source: "Signal 2000",
      });
    }
  }

  const entries = [...byKey.values()];
  let upserted = 0;
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    const r = await upsertDirectory(chunk);
    if (r.ok) upserted += chunk.length;
    else errors.push(r.error || "upsert failed");
  }

  return { ok: errors.length === 0 || upserted > 0, distinct: entries.length, upserted, pages, errors };
}

function params(req: NextRequest) {
  const region = (req.nextUrl.searchParams.get("region") as RegionId) || "us";
  const pages = Math.max(1, Math.min(20, Number(req.nextUrl.searchParams.get("pages")) || 8));
  return { region, pages };
}

export async function POST(req: NextRequest) {
  const { region, pages } = params(req);
  return NextResponse.json(await runPopulate(pages, region));
}

// GET alias so the populate can be kicked off from a browser/curl without a body.
export async function GET(req: NextRequest) {
  const { region, pages } = params(req);
  return NextResponse.json(await runPopulate(pages, region));
}
