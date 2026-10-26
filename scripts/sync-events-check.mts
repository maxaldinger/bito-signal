// Sync-events check (Oct 26) — read-only, against production.
//
// Rohan's dashboard showed no "synced by Max" on MongoDB contacts Max synced on
// Sep 30: /api/sync-events read the whole table in one request and the
// database returns at most 1,000 rows, so every event after the 1,000th was
// dropped. This replays the old single read next to the paged loader the
// route now uses, and asserts the loader sees every row and those contacts.
//
// Usage: npx tsx scripts/sync-events-check.mts

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { loadSyncEventMaps } = await import("../lib/syncEventMaps");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const { count: total } = await admin.from("bito_sync_events").select("*", { count: "exact", head: true });

// The old read: one request, oldest first.
const { data: old } = await admin
  .from("bito_sync_events")
  .select("kind,contact_key,synced_at")
  .order("synced_at", { ascending: true });
const oldContacts = new Set((old ?? []).filter((e) => e.kind === "contact").map((e) => e.contact_key as string));

const res = await loadSyncEventMaps(admin);
if (!res.ok) throw new Error(res.error);
const { maps } = res;

console.log(`table rows: ${total}; old single read: ${old?.length ?? 0}; paged loader: ${maps.read}`);
check(maps.read === total, "the paged loader reads every event", `${maps.read} of ${total}`);

// Max's Sep 30 MongoDB syncs that Rohan's screenshot showed without a chip.
const MONGODB = {
  "Jeff Yemin": "66f5cf2f66b24c000159e74a",
  "Gabriele Cimato": "54a46a6e7468693676f69c45",
  "Marko Vojvodic": "557040d37369644cf43c1f00",
  "Rakesh Ravindran": "57d3471aa6da9865a99041ce",
};
for (const [name, id] of Object.entries(MONGODB)) {
  const e = maps.contacts[id];
  check(e?.by === "Max" && e.at.startsWith("2026-09-30"), `${name} shows "synced by Max · Sep 30"`, e ? `${e.by} ${e.at.slice(0, 10)}` : "missing");
  console.log(`      old read had ${name}: ${oldContacts.has(id)}`);
}
const recovered = Object.keys(maps.contacts).filter((k) => !oldContacts.has(k)).length;
console.log(`contacts the old read dropped, now served: ${recovered}`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
