// Teammate-view check — what one teammate's browser receives from
// /api/sync-events for one account, and the "synced by" chip text each
// contact card renders for them. Read-only; uses the same loader the live
// route runs (lib/syncEventMaps) and the chip's own date format.
//
// Usage: npx tsx scripts/teammate-view-check.mts <viewer display name> <company key>
//   e.g. npx tsx scripts/teammate-view-check.mts Rohan mongodb

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const viewerName = process.argv[2] ?? "Rohan";
const companyKey = process.argv[3] ?? "mongodb";

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { loadSyncEventMaps } = await import("../lib/syncEventMaps");
const { fmtDate } = await import("../lib/format");

const { data: profiles } = await admin.from("bito_profiles").select("user_id,display_name");
const viewer = (profiles ?? []).find((p) => String(p.display_name).toLowerCase() === viewerName.toLowerCase());
if (!viewer) throw new Error(`no profile named ${viewerName}`);

const res = await loadSyncEventMaps(admin);
if (!res.ok) throw new Error(res.error);

// The account's contact events, named via the shared reveal cache.
const { data: rows } = await admin
  .from("bito_sync_events")
  .select("contact_key")
  .eq("company_key", companyKey)
  .eq("kind", "contact");
const ids = [...new Set((rows ?? []).map((r) => String(r.contact_key)))];
const { data: reveals } = await admin.from("bito_reveal_cache").select("apollo_id,name").in("apollo_id", ids);
const nameOf = new Map((reveals ?? []).map((r) => [String(r.apollo_id), String(r.name)]));

console.log(`Viewer: ${viewer.display_name}. Account: ${companyKey}. Events served to every signed-in user: ${res.maps.read}.`);
let shown = 0;
const lines: string[] = [];
for (const id of ids) {
  const e = res.maps.contacts[id];
  if (!e) continue;
  // The card renders the teammate chip only when the event isn't the viewer's own.
  const chip = e.user !== viewer.user_id ? `synced by ${e.by} · ${fmtDate(Date.parse(e.at))}` : "(own sync: orange badge instead)";
  if (e.user !== viewer.user_id) shown += 1;
  lines.push(`${(nameOf.get(id) ?? id).padEnd(20)} ${chip}`);
}
for (const l of lines.sort()) console.log(`  ${l}`);
console.log(`${shown} of ${ids.length} ${companyKey} contacts render a "synced by" chip for ${viewer.display_name}.`);
