// WS6 sync history, read in full. Shared by /api/sync-events and its check
// script (scripts/sync-events-check.mts).
//
// Paged on purpose (Max, Oct 26: Rohan's dashboard showed no "synced by Max"
// on the MongoDB contacts). The route used to read the whole table in one
// request; the database returns at most 1,000 rows per request, and reading
// oldest-first meant every event after the 1,000th was silently dropped —
// 637 contact syncs since Aug 28 never reached teammates, and their cards fell
// back to the model's UNRESOLVED verdict.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SyncEventOut {
  by: string;
  user: string;
  at: string;
}

export interface SyncEventMaps {
  companies: Record<string, SyncEventOut>;
  contacts: Record<string, SyncEventOut>;
  /** Events read — equals the table's row count when nothing was dropped. */
  read: number;
}

type EventRow = {
  kind: string;
  key: string | null;
  company_key: string | null;
  contact_key: string | null;
  user_id: string;
  synced_at: string;
};

const PAGE = 1000;
const MAX_PAGES = 200; // 200k events: a backstop, far above real volume

/** Latest event per company / per contact, with display names. Advances by
 *  rows actually returned and stops on an empty page, so a server row cap
 *  smaller than PAGE still reads everything. */
export async function loadSyncEventMaps(
  admin: SupabaseClient,
): Promise<{ ok: true; maps: SyncEventMaps } | { ok: false; error: string }> {
  const events: EventRow[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from("bito_sync_events")
      .select("kind,key,company_key,contact_key,user_id,synced_at")
      .order("synced_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) break;
    events.push(...(data as EventRow[]));
    from += data.length;
  }

  const { data: profiles } = await admin.from("bito_profiles").select("user_id,display_name");
  const names = new Map((profiles ?? []).map((p) => [p.user_id as string, p.display_name as string]));
  const companies: Record<string, SyncEventOut> = {};
  const contacts: Record<string, SyncEventOut> = {};
  // Ascending order + overwrite = latest event per key wins.
  for (const e of events) {
    const out: SyncEventOut = {
      by: names.get(e.user_id) ?? "a teammate",
      user: e.user_id,
      at: e.synced_at,
    };
    if (e.kind === "company" && e.company_key) companies[e.company_key] = out;
    if (e.kind === "contact" && e.contact_key) contacts[e.contact_key] = out;
  }
  return { ok: true, maps: { companies, contacts, read: events.length } };
}
