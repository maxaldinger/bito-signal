import { NextRequest, NextResponse } from "next/server";
import { apolloPersonContact, type RevealKind } from "@/lib/enrich/apollo";

// GET /api/enrich/apollo/person?name=Jane%20Doe&reveal=email|phone
//   [&company=Ramp][&domain=ramp.com][&linkedin=https://linkedin.com/in/...]
// Reveals ONE field (email or phone) for a single named person on demand.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  const revealParam = req.nextUrl.searchParams.get("reveal")?.trim();
  const company = req.nextUrl.searchParams.get("company")?.trim() || undefined;
  const domain = req.nextUrl.searchParams.get("domain")?.trim() || undefined;
  const linkedinUrl = req.nextUrl.searchParams.get("linkedin")?.trim() || undefined;

  if (!name) {
    return NextResponse.json({ error: "Pass ?name=" }, { status: 400 });
  }
  if (revealParam !== "email" && revealParam !== "phone") {
    return NextResponse.json({ error: "Pass ?reveal=email or ?reveal=phone" }, { status: 400 });
  }
  const reveal = revealParam as RevealKind;

  const result = await apolloPersonContact(name, { company, domain, linkedinUrl, reveal });
  const status = result.ok ? 200 : result.configured ? 502 : 501;
  return NextResponse.json(result, { status });
}
