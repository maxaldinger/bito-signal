import { NextResponse } from "next/server";
import { upsertDirectory } from "@/lib/supabase";
import { FORTUNE_US_DIRECTORY } from "@/lib/fortune1000";

// Populate the Signal 2000 directory from the Fortune 1000 (US) seed — the
// ~1,000 largest US companies across every sector (retail, energy, financials,
// auto, healthcare, industrials — broad, not just tech), each with a domain,
// sector brief, and modeled engineering headcount. Fast (no Apollo, no LLM):
// just a chunked upsert. The full intel brief is generated on demand per company.
//
//   POST (or GET) /api/directory/populate
export const maxDuration = 60;

async function seed() {
  const entries = FORTUNE_US_DIRECTORY;
  let upserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    const r = await upsertDirectory(chunk);
    if (r.ok) upserted += chunk.length;
    else errors.push(r.error || "upsert failed");
  }
  return NextResponse.json({ ok: errors.length === 0, total: entries.length, upserted, errors });
}

export async function POST() {
  return seed();
}

export async function GET() {
  return seed();
}
