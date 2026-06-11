import { NextRequest, NextResponse } from "next/server";
import { fetchSignalPage, supabaseConfigured } from "@/lib/supabase";
import { isRegionId, type RegionId } from "@/lib/data";

// Paged read over the Supabase signal cache. 50 results per page.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  if (!supabaseConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        signals: [],
        total: 0,
        page: 1,
        pageSize: PAGE_SIZE,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  const regionParam = req.nextUrl.searchParams.get("region")?.trim().toLowerCase();
  const region: RegionId = isRegionId(regionParam) ? regionParam : "us";
  const result = await fetchSignalPage(page, PAGE_SIZE, region);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, configured: true },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      configured: true,
      signals: result.signals,
      total: result.total,
      page,
      pageSize: PAGE_SIZE,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
