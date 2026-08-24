import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabaseAuth";
import { buildProposalHtml, type ProposalFields } from "@/lib/proposalDoc";

// GET /p/<token> — the PUBLIC prospect-facing proposal page. Exempted from
// the auth middleware; the only key is the unguessable 32-hex token, and the
// page carries only what the rep chose to publish for that one account.
export const maxDuration = 15;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!/^[0-9a-f]{32}$/.test(token ?? "")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const { data, error } = await adminClient()
    .from("bito_proposals")
    .select("fields")
    .eq("token", token)
    .maybeSingle();
  if (error || !data?.fields) {
    return new NextResponse("Not found", { status: 404 });
  }
  const html = buildProposalHtml(data.fields as ProposalFields);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Fine to cache briefly at the CDN — the doc is immutable once created.
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
