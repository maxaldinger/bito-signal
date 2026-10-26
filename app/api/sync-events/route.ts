import { NextResponse } from "next/server";
import { adminClient, sessionUserId } from "@/lib/supabaseAuth";
import { loadSyncEventMaps } from "@/lib/syncEventMaps";

// GET /api/sync-events — WS6: who synced what to their HubSpot, latest event
// per company / per contact, with display names. Shared truth: every signed-in
// user sees the same map, which is what makes "synced by Rohan · Aug 3"
// possible on a card Max is looking at. `me` lets the client suppress chips
// for the viewer's own events (their orange badge already covers those).
// The table is read in pages (lib/syncEventMaps): one capped request dropped
// every event after the 1,000th.
export const maxDuration = 20;

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const res = await loadSyncEventMaps(adminClient());
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });

  return NextResponse.json(
    { ok: true, me: uid, companies: res.maps.companies, contacts: res.maps.contacts },
    { headers: { "Cache-Control": "no-store" } },
  );
}
