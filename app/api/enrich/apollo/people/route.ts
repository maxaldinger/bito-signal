import { NextRequest, NextResponse } from "next/server";
import { apolloPeopleByTitle } from "@/lib/enrich/apollo";

// GET /api/enrich/apollo/people?company=Ramp[&domain=ramp.com]
// Free people-by-title search — returns real engineering leaders with stable
// Apollo ids (last names obfuscated until revealed per-person). Drives the
// stakeholder cards in a deep dive.
// 60s: the Apollo search is fast, but the ICP classifier adds a few Haiku
// waves over the page. The s-maxage below means a reopened brief serves from
// the CDN and re-classifies nothing.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company")?.trim() || "";
  const domain = req.nextUrl.searchParams.get("domain")?.trim() || undefined;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  // Only look up the pinned (motion) contact on the first page.
  const pin = page <= 1 ? req.nextUrl.searchParams.get("pin")?.trim() || undefined : undefined;
  // The brief's "what I saw" signal, forwarded so the ICP classifier can reason
  // about THIS account rather than the job title alone. Capped: it only needs
  // to be context, and it rides in a URL.
  const signal = req.nextUrl.searchParams.get("signal")?.trim().slice(0, 600) || undefined;

  if (!company && !domain) {
    return NextResponse.json({ error: "Pass ?company= and/or ?domain=" }, { status: 400 });
  }

  const result = await apolloPeopleByTitle(company, domain, page, pin, signal);
  const status = result.ok ? 200 : result.configured ? 502 : 501;
  return NextResponse.json(result, {
    status,
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
