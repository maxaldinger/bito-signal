import { NextRequest, NextResponse } from "next/server";
import { apolloPeopleByTitle } from "@/lib/enrich/apollo";

// GET /api/enrich/apollo/people?company=Ramp[&domain=ramp.com]
// Free people-by-title search — returns real engineering leaders with stable
// Apollo ids (last names obfuscated until revealed per-person). Drives the
// stakeholder cards in a deep dive.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company")?.trim() || "";
  const domain = req.nextUrl.searchParams.get("domain")?.trim() || undefined;

  if (!company && !domain) {
    return NextResponse.json({ error: "Pass ?company= and/or ?domain=" }, { status: 400 });
  }

  const result = await apolloPeopleByTitle(company, domain);
  const status = result.ok ? 200 : result.configured ? 502 : 501;
  return NextResponse.json(result, {
    status,
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
