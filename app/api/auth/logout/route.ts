import { NextResponse } from "next/server";
import { routeClient } from "@/lib/supabaseAuth";

// POST /api/auth/logout — end the Supabase session (clears its cookies).
export async function POST() {
  const sb = await routeClient();
  await sb.auth.signOut();
  return NextResponse.json({ ok: true });
}
