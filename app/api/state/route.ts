import { NextRequest, NextResponse } from "next/server";
import { fetchState, upsertState } from "@/lib/supabase";
import { routeClient, sessionUser } from "@/lib/supabaseAuth";

// Cross-device client state — WS3: split per-user vs shared.
//
// PER-USER stores (marks, favorites, review flags…) live in bito_user_state,
// read and written through the caller's OWN Supabase session: RLS
// (auth.uid() = user_id) scopes every query, so this route physically cannot
// serve one user's marks to another even if the code forgets a filter.
//
// SHARED stores (deep-dive scores, sweep cursor, blurbs, reveal blob,
// blacklist) still ride the legacy bito_state path UNTIL WS4 moves them to
// row-per-entry tables. The legacy rows are keyed "<base>.v2" while the
// multi-tenant client uses "<base>.v3" — the route remaps at the boundary in
// both directions, deliberately: writing shared data back under .v2 keeps a
// rollback to the previous build fully functional, and gives WS4 one
// canonical place to migrate from.
export const maxDuration = 20;

/** Per-user under the multi-tenant split. */
const PER_USER = new Set([
  "bito-prospected",
  "bito-favorites",
  "bito-reviewed",
  "bito-collapsed",
  "bito-lowpriority",
  "bito-last-due",
  "bito-hs-presence",
]);

/** Shared until WS4 — legacy bito_state, .v2 rows. */
const SHARED = new Set([
  "bito-deepdive-scores",
  "bito-sweep-cursor",
  "bito-company-blurbs",
  "bito-apollo-reveals",
  "bito-blacklist",
]);

const CLIENT_VERSION = ".v3";
const LEGACY_VERSION = ".v2";

function baseOf(store: string): string {
  return store.replace(/\.v\d+$/, "");
}

export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const state: Record<string, unknown> = {};

  // Shared stores — legacy path, remapped .v2 -> .v3 for the client registry.
  const legacy = await fetchState();
  if (legacy.ok && legacy.state) {
    for (const [key, value] of Object.entries(legacy.state)) {
      const base = baseOf(key);
      if (SHARED.has(base)) state[`${base}${CLIENT_VERSION}`] = value;
    }
  }

  // Per-user stores — the caller's own rows, scoped by RLS.
  const sb = await routeClient();
  const { data, error } = await sb.from("bito_user_state").select("store,value");
  if (error) {
    return NextResponse.json({ ok: false, configured: true, error: error.message }, { status: 502 });
  }
  for (const row of data ?? []) {
    if (PER_USER.has(baseOf(row.store))) state[row.store] = row.value;
  }

  return NextResponse.json({ configured: legacy.configured, ok: true, state });
}

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { store?: string; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const store = body.store ?? "";
  const base = baseOf(store);
  // Version-pinned, same as always: un-versioned names from stale tabs must
  // not re-seed wiped state.
  if (!store.endsWith(CLIENT_VERSION) || (!PER_USER.has(base) && !SHARED.has(base))) {
    return NextResponse.json({ ok: false, error: "Unknown store" }, { status: 400 });
  }

  if (SHARED.has(base)) {
    const r = await upsertState(`${base}${LEGACY_VERSION}`, body.value ?? {});
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  }

  const sb = await routeClient();
  const { error } = await sb
    .from("bito_user_state")
    .upsert(
      { user_id: user.id, store, value: body.value ?? {}, updated_at: new Date().toISOString() },
      { onConflict: "user_id,store" },
    );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}
