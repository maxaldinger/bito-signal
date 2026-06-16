import { NextRequest, NextResponse } from "next/server";
import { apolloPersonContact, type RevealKind } from "@/lib/enrich/apollo";

// GET /api/enrich/apollo/person?id=<apolloId>&reveal=email|phone
//   — or — ?name=Jane%20Doe&reveal=…[&company=Ramp][&domain=ramp.com][&linkedin=…]
// Reveals ONE field (email or phone) for a single person on demand. Matching by
// `id` (from a prior people search) is exact; name matching is a fuzzy fallback.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim() || undefined;
  const name = req.nextUrl.searchParams.get("name")?.trim() || undefined;
  const revealParam = req.nextUrl.searchParams.get("reveal")?.trim();
  const company = req.nextUrl.searchParams.get("company")?.trim() || undefined;
  const domain = req.nextUrl.searchParams.get("domain")?.trim() || undefined;
  const linkedinUrl = req.nextUrl.searchParams.get("linkedin")?.trim() || undefined;

  if (!id && !name) {
    return NextResponse.json({ error: "Pass ?id= or ?name=" }, { status: 400 });
  }
  if (revealParam !== "email" && revealParam !== "phone") {
    return NextResponse.json({ error: "Pass ?reveal=email or ?reveal=phone" }, { status: 400 });
  }
  const reveal = revealParam as RevealKind;

  const result = await apolloPersonContact({ id, name, company, domain, linkedinUrl, reveal });
  const status = result.ok ? 200 : result.configured ? 502 : 501;
  return NextResponse.json(result, { status });
}
