import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { callClaudeWithWebSearch, extractJSON } from "@/lib/anthropic";
import { adminClient, sessionUserId } from "@/lib/supabaseAuth";
import { BITO_CONTEXT } from "@/lib/bito";
import { normCompany } from "@/lib/companyKey";
import type { ProposalFields, ProposalRoi } from "@/lib/proposalDoc";

// POST /api/proposal — generate a personalized Governor proposal for an
// account and store it under an unguessable token; the prospect-facing page
// is served publicly at /p/<token> (middleware exempts that path).
//
// CACHED per rep + account: a repeat click returns the existing link instead
// of generating a duplicate; `force: true` regenerates with the latest facts
// IN PLACE (same token), so a link already emailed out shows the new content.
//
// The canonical sections (solution, rollout, proof points, why-Bito) are
// FIXED copy in lib/proposalDoc.ts, and the ROI table is computed here — the
// model only writes the executive summary and the closing CTA, from facts
// the caller supplies. Thin context degrades to a solid generic summary; it
// must never degrade to invention.
export const maxDuration = 60;

interface Body {
  company?: string;
  /** The feed's stable name for the account — the proposal-cache key. */
  companyKey?: string;
  domain?: string;
  contactName?: string;
  contactTitle?: string;
  /** Whatever the surface knows: signal, blurb, brief summary, call hook. */
  context?: string;
  sweEstimate?: number;
  /** True when the SWE count was confirmed by the account on a call (the
   *  rep's manual override) — changes how the number is framed. */
  sweConfirmed?: boolean;
  employees?: number;
  icpTotal?: number;
  /** Regenerate even when a proposal exists — updates it at the SAME link. */
  force?: boolean;
}

interface GenOut {
  execSummary?: unknown;
  cta?: unknown;
}

const ASSUMED_ALLOWANCE_MO = 1000;

// ROI renders as ADOPTION TIERS (10% / 25% / 50% / full org) for estimates
// above this, a single row below it. One flat "whole org × $1K/mo" number at
// Comcast scale produced a $684M "token spend" that torpedoes credibility; a
// flat 2K cap then undersold a 32,000-engineer bank. Tiers keep the pilot row
// believable AND the full-scale row on the page, each with its assumption
// visible.
const ROI_TIER_THRESHOLD = 2000;

export async function POST(req: NextRequest) {
  const uid = await sessionUserId();
  if (!uid) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const company = body.company?.trim();
  if (!company) return NextResponse.json({ ok: false, error: "Pass company" }, { status: 400 });
  const contactName = body.contactName?.trim() || undefined;
  // The >= 20 floor sanity-filters MODELED estimates; a rep-confirmed count
  // from a call is exactly the case where a small number is trustworthy, so
  // confirmation lowers the floor to 1 (matching what the SweChip accepts).
  const swe =
    typeof body.sweEstimate === "number" && body.sweEstimate >= (body.sweConfirmed === true ? 1 : 20)
      ? Math.round(body.sweEstimate)
      : undefined;
  const sweConfirmed = body.sweConfirmed === true && !!swe;

  // Proposal cache: one live proposal per rep + account. A repeat click
  // returns the existing link (no duplicate doc, no duplicate spend); `force`
  // falls through to regenerate and update that row in place.
  const companyKey = normCompany(body.companyKey?.trim() || company);
  const admin = adminClient();
  const { data: existing, error: lookupError } = await admin
    .from("bito_proposals")
    .select("token, fields")
    .eq("created_by", uid)
    .eq("company_key", companyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A failed lookup must FAIL the request — falling through would mint a
  // duplicate proposal at a new URL and strand the link already sent out.
  if (lookupError) {
    return NextResponse.json(
      { ok: false, error: `Proposal lookup failed: ${lookupError.message}` },
      { status: 502 },
    );
  }
  if (existing?.token && !body.force) {
    const f = existing.fields as Partial<ProposalFields> | null;
    return NextResponse.json({
      ok: true,
      url: `${req.nextUrl.origin}/p/${existing.token}`,
      cached: true,
      generatedAt: f?.generatedAt,
    });
  }

  // Facts the CURRENT surface doesn't know must not erase what a richer one
  // already published: an Update clicked on the feed card (which knows no
  // contact or employee count) would otherwise strip the brief-generated
  // proposal's "Hi <name>," greeting and employees fact from the live link.
  const prev = (existing?.fields ?? undefined) as Partial<ProposalFields> | undefined;
  const mergedContactName =
    contactName ?? (typeof prev?.contactName === "string" && prev.contactName ? prev.contactName : undefined);
  const employees =
    typeof body.employees === "number"
      ? Math.round(body.employees)
      : typeof prev?.employees === "number"
        ? prev.employees
        : undefined;

  // ROI table, computed — never model-written. Only rendered when we actually
  // have an engineer count to anchor it.
  let roi: ProposalRoi | undefined;
  if (swe) {
    const tier = (n: number, label: string) => {
      const spendYr = n * ASSUMED_ALLOWANCE_MO * 12;
      return {
        engineers: n,
        label,
        spendYr,
        savedAt47: Math.round(spendYr * 0.47),
        savedAt83: Math.round(spendYr * 0.83),
      };
    };
    // Round tier headcounts to something a human would say (nearest 100).
    const pctOf = (p: number) => Math.max(100, Math.round((swe * p) / 100 / 100) * 100);
    const tiers =
      swe > ROI_TIER_THRESHOLD
        ? [
            tier(pctOf(10), "pilot — 10% of engineers on agents"),
            tier(pctOf(25), "25% of engineers"),
            tier(pctOf(50), "50% of engineers"),
            tier(
              swe,
              sweConfirmed
                ? `full engineering org (${swe.toLocaleString()} confirmed)`
                : `full engineering org (~${swe.toLocaleString()} estimated)`,
            ),
          ]
        : [
            tier(
              swe,
              sweConfirmed
                ? `${swe.toLocaleString()} engineers (confirmed)`
                : `~${swe.toLocaleString()} estimated engineers`,
            ),
          ];
    roi = { allowanceMo: ASSUMED_ALLOWANCE_MO, sweEstimate: swe, tiers };
  }

  const facts = [
    `Company: ${company}`,
    body.domain ? `Domain: ${body.domain}` : "",
    mergedContactName
      ? `Recipient: ${mergedContactName}${contactName && body.contactTitle ? `, ${body.contactTitle}` : ""}`
      : "",
    typeof employees === "number" ? `Total employees: ~${employees.toLocaleString()}` : "",
    swe
      ? sweConfirmed
        ? `Software engineers: ${swe.toLocaleString()} (confirmed by the account on a call — reliable, may be stated plainly)`
        : `Estimated software engineers: ~${swe.toLocaleString()} (LinkedIn-derived headcount data — approximate, never quote as fact)`
      : "",
    typeof body.icpTotal === "number" ? `Bito ICP fit score: ${body.icpTotal}/99` : "",
    body.context ? `What we know (signal / brief context):\n${body.context.slice(0, 1500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `${BITO_CONTEXT}

You write the two personalized sections of a Bito GOVERNOR proposal document. Governor is Bito's context-driven model router: a transparent layer between a team's coding harness (Claude Code, Cursor, Codex, Copilot) and the models — the Code Context Engine injects the right code up front (−47% token cost per task, up to −68%), and the Model Router sends each request to the lowest-cost model that clears the quality bar. Drop-in: point the harness's base URL at Governor, nothing else changes.

Write in a direct, senior, vendor-to-engineering-leader register. No hype words, no em dashes.

HARD RULES:
- Use ONLY the account facts provided. NEVER invent initiatives, names, numbers, quotes, or events for the company. If the facts are thin, write about the cost mechanics of agentic coding at a company of their kind in general terms.
- Do not repeat the company name more than twice across everything you write.
- No statistics other than these, verbatim if used: 47% lower token cost per task; up to 68% on individual tasks; $4.12 to $2.14 per task; $6.81 to $1.13 for a full session; 51.9% to 70.1% on SWE-Bench Pro. At most two figures total.

Return ONLY JSON: {"execSummary": ["paragraph 1", "paragraph 2"], "cta": "one closing next-steps paragraph"}.
- execSummary: exactly 2 paragraphs, 50-90 words each. Paragraph 1: their situation — the unit economics of scaling coding agents, tied to the provided facts. Paragraph 2: what Governor changes for them specifically.
- cta: 40-70 words proposing the controlled A/B benchmark on THEIR codebase and tasks, ending with scheduling a brief technical kickoff. No exclamation marks.`;

  let gen: GenOut | null = null;
  try {
    const result = await callClaudeWithWebSearch({
      system,
      user: `Account facts:\n${facts}\n\nWrite the JSON now.`,
      webSearch: false,
      maxTokens: 1200,
    });
    gen = extractJSON<GenOut>(result.text);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Generation failed" },
      { status: 502 },
    );
  }
  const execSummary = Array.isArray(gen?.execSummary)
    ? gen.execSummary.map((p) => String(p)).filter(Boolean).slice(0, 3)
    : [];
  const cta = typeof gen?.cta === "string" ? gen.cta.trim() : "";
  if (execSummary.length === 0 || !cta) {
    return NextResponse.json(
      { ok: false, error: "The generator returned an unusable draft — try again" },
      { status: 502 },
    );
  }

  const fields: ProposalFields = {
    company,
    contactName: mergedContactName,
    execSummary,
    cta,
    engineers: swe,
    employees,
    roi,
    generatedAt: new Date().toISOString(),
  };

  // Regenerating keeps the SAME token — the link the rep already sent out
  // starts showing the updated content. The update matches on the KEY, not
  // one token: pre-cache double-clicks left duplicate rows for a few accounts
  // (two live tokens each), and updating only the newest would leave whichever
  // link was actually emailed serving stale content forever. Matching the key
  // converges every live link for the account onto the new content.
  const updateAllForKey = async () => {
    const { error } = await admin
      .from("bito_proposals")
      .update({
        company,
        contact_name: mergedContactName ?? null,
        fields,
        updated_at: new Date().toISOString(),
      })
      .eq("created_by", uid)
      .eq("company_key", companyKey);
    return error;
  };

  if (existing?.token) {
    const error = await updateAllForKey();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    return NextResponse.json({ ok: true, url: `${req.nextUrl.origin}/p/${existing.token}`, updated: true });
  }

  // The lookup → generate → insert sequence spans the ~15s generation, and a
  // second click can land in that window (the card and the open brief each
  // mount their own button; propBusy doesn't cross instances or tabs).
  // Re-check before inserting: if a row appeared, update it instead of
  // minting a second link for the same account.
  const { data: raced } = await admin
    .from("bito_proposals")
    .select("token")
    .eq("created_by", uid)
    .eq("company_key", companyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (raced?.token) {
    const error = await updateAllForKey();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    return NextResponse.json({ ok: true, url: `${req.nextUrl.origin}/p/${raced.token}`, updated: true });
  }

  const token = randomBytes(16).toString("hex");
  const { error } = await admin
    .from("bito_proposals")
    .insert({ token, company, company_key: companyKey, contact_name: mergedContactName ?? null, fields, created_by: uid });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });

  return NextResponse.json({ ok: true, url: `${req.nextUrl.origin}/p/${token}` });
}
