import { NextResponse } from "next/server";
import { fetchDirectory } from "@/lib/supabase";

// GET /api/directory — the whole Signal 2000 directory (strongest-fit first).
// The client sorts/filters/paginates in memory, same as the signal feed.
export const maxDuration = 30;

export async function GET() {
  const r = await fetchDirectory();
  return NextResponse.json(r);
}
