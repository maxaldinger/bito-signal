import { NextRequest, NextResponse } from "next/server";
import { fetchState, upsertState } from "@/lib/supabase";

// Cross-device user state. GET returns every store's value as a map; POST
// upserts one store. Single-user / no auth — the same shared state for every
// device (same posture as the signal cache). Unconfigured Supabase → no-op.
export const maxDuration = 20;

// Only the client store keys we actually sync — guards the table against junk.
// ".v2" matches clientStore's KEY_VERSION (bumped 2026-07-16 for the factory
// reset); un-versioned names from stale pre-reset tabs are rejected so old
// state can't re-seed the wiped table.
const ALLOWED = new Set(
  [
    "bito-prospected",
    "bito-deepdive-scores",
    "bito-lowpriority",
    "bito-collapsed",
    "bito-hs-presence",
    "bito-blacklist",
    "bito-reviewed",
    "bito-favorites",
    "bito-last-due",
    "bito-sweep-cursor",
    "bito-company-blurbs",
    "bito-apollo-reveals",
  ].map((k) => `${k}.v2`),
);

export async function GET() {
  const r = await fetchState();
  return NextResponse.json({ configured: r.configured, ok: r.ok, state: r.state });
}

export async function POST(req: NextRequest) {
  let body: { store?: string; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  if (!body.store || !ALLOWED.has(body.store)) {
    return NextResponse.json({ ok: false, error: "Unknown store" }, { status: 400 });
  }
  const r = await upsertState(body.store, body.value ?? {});
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
