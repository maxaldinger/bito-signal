import { NextRequest, NextResponse } from "next/server";
import { fetchDirectory } from "@/lib/supabase";

// GET /api/directory?region=us|in — one region's Signal 2000 directory
// (strongest-fit first). The client sorts/filters/paginates in memory, same
// as the signal feed. Region follows the header's US/IN toggle.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const region = req.nextUrl.searchParams.get("region") === "in" ? "in" : "us";
  const r = await fetchDirectory(region);
  return NextResponse.json(r);
}
