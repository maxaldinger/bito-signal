// GET /api/auth/status — whether the password gate is enabled. Lets the UI show
// a "sign out" control only when there's something to sign out of. Reveals no
// secret: just whether the env vars are present.

import { NextResponse } from "next/server";
import { authConfigured } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(
    { enabled: authConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
