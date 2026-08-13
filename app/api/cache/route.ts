import { NextRequest, NextResponse } from "next/server";
import { adminClient, sessionUser } from "@/lib/supabaseAuth";

// Shared caches, row-per-entry — WS4. Replaces the whole-blob sync of
// deep-dive scores, company blurbs, the sweep cursor, and the blacklist
// through /api/state: blob-per-store with last-writer-wins loses concurrent
// writes, proven at one user, guaranteed at five. Here every change is one
// row, so two reps writing different companies can never erase each other.
//
// GET returns all four maps in the client stores' shapes. POST upserts one
// entry; DELETE removes one (un-blacklisting is a real delete now). The
// reveal cache is NOT served here — it lives server-side in the person route,
// next to the Apollo spend.
//
// Service-role access, deliberately: shared, non-user-scoped data (the
// session gate still applies — middleware plus the explicit check below).
export const maxDuration = 20;

const KINDS = {
  scores: { table: "bito_scores", key: "company_key", val: "score" },
  blurbs: { table: "bito_company_blurbs", key: "company_key", val: "blurb" },
  sweepCursor: { table: "bito_sweep_cursor", key: "cursor_key", val: "page" },
  blacklist: { table: "bito_blacklist", key: "company_key", val: "company" },
  // Rep review verdicts on contacts ("qualified" | "excluded") — the recorded
  // outcome of the "review the profile" step the UNRESOLVED tier demands.
  contactReviews: { table: "bito_contact_reviews", key: "key", val: "verdict" },
} as const;
type Kind = keyof typeof KINDS;

export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const admin = adminClient();
  const out: Record<string, Record<string, unknown>> = {};
  for (const [kind, cfg] of Object.entries(KINDS)) {
    const map: Record<string, unknown> = {};
    // Page past PostgREST's 1000-row response cap. contactReviews is the first
    // per-CONTACT kind here, so it can realistically outgrow one page — and a
    // silently truncated map gets applied as AUTHORITATIVE by the client's
    // full-replace hydration, erasing real verdicts. `.order()` keeps the
    // pages disjoint.
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from(cfg.table)
        .select(`${cfg.key},${cfg.val}`)
        .order(cfg.key, { ascending: true })
        .range(from, from + PAGE - 1);
      if (error)
        return NextResponse.json({ ok: false, error: `${kind}: ${error.message}` }, { status: 502 });
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      for (const row of rows) map[String(row[cfg.key])] = row[cfg.val];
      if (rows.length < PAGE) break;
    }
    out[kind] = map;
  }
  return NextResponse.json({ ok: true, ...out }, { headers: { "Cache-Control": "no-store" } });
}

function parseKind(v: unknown): Kind | null {
  return typeof v === "string" && v in KINDS ? (v as Kind) : null;
}

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: { kind?: string; key?: string; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const kind = parseKind(body.kind);
  const key = (body.key ?? "").toString().trim();
  if (!kind || !key) return NextResponse.json({ ok: false, error: "Pass kind and key" }, { status: 400 });

  const numeric = kind === "scores" || kind === "sweepCursor";
  const value = numeric ? Number(body.value) : String(body.value ?? "");
  if (numeric && !Number.isFinite(value as number)) {
    return NextResponse.json({ ok: false, error: "Numeric value required" }, { status: 400 });
  }
  if (kind === "contactReviews" && value !== "qualified" && value !== "excluded") {
    return NextResponse.json(
      { ok: false, error: "Verdict must be 'qualified' or 'excluded'" },
      { status: 400 },
    );
  }
  const cfg = KINDS[kind];
  const row: Record<string, unknown> = {
    [cfg.key]: key,
    [cfg.val]: value,
    updated_at: new Date().toISOString(),
  };
  // A verdict carries who made the call and when — "reviewed" only means
  // something if someone owns it.
  if (kind === "contactReviews") {
    row.user_id = user.id;
    row.reviewed_at = new Date().toISOString();
  }
  const { error } = await adminClient()
    .from(cfg.table)
    .upsert(row, { onConflict: cfg.key });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  let body: { kind?: string; key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const kind = parseKind(body.kind);
  const key = (body.key ?? "").toString().trim();
  if (!kind || !key) return NextResponse.json({ ok: false, error: "Pass kind and key" }, { status: 400 });
  const cfg = KINDS[kind];
  const { error } = await adminClient().from(cfg.table).delete().eq(cfg.key, key);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}
