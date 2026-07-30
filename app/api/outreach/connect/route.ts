// POST /api/outreach/connect — a connect note written for ONE person.
//
// The brief generates linkedinOutreach once per COMPANY, so every contact at
// that company got a byte-identical connect note. When the company signal is
// something an individual did ("Saw your DX podcast"), sending it to five other
// people at the org reads as a mailmerge — the exact failure a connect note has
// to avoid, since its only job is earning the accept.
//
// This regenerates just the connect note for the specific person, using their
// role and ICP classification. Called on demand at task-push time, so it costs
// a Haiku call only for people actually being prospected.

import { NextResponse, type NextRequest } from "next/server";
import { callClaudeWithWebSearch, FAST_MODEL } from "@/lib/anthropic";
import {
  CONNECT_CAP,
  VOICE_SPEC,
  bannedHits,
  enforceLinkedin,
  withinConnectCap,
} from "@/lib/outreachRules";

export const maxDuration = 30;

interface Body {
  company?: string;
  companyLine?: string;
  callHook?: string;
  name?: string;
  title?: string;
  classification?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const company = (body.company || "").trim();
  const callHook = (body.callHook || "").trim();
  if (!company || !callHook) {
    return NextResponse.json(
      { ok: false, error: "Pass company and callHook" },
      { status: 400 },
    );
  }

  // ROUTER is the "too senior / wrong org" case now: they redirect you rather
  // than own the decision, so the note asks rather than pitches.
  const isAnchor = (body.classification || "").toUpperCase() === "ROUTER";

  const system = `You write LinkedIn connect notes for Max, a founding AE at Bito. Bito precomputes a map of a company's code, commits, and tickets and serves it to any coding agent or IDE over MCP, so agents start already knowing the architecture instead of re-learning it every session. Bito is built for big interconnected multi-repo / microservice codebases.

Write ONE connect note for ONE named person. Output the note text ONLY — no JSON, no quotes around it, no preamble.

This is register (A), a CONNECT REQUEST: open "Hey ${(body.name || "").trim().split(/\s+/)[0] || "there"}," then 2-3 sentences, HARD CAP ${CONNECT_CAP} characters including spaces. NO signature — do not sign "Max" on a connect request.

The note's only job is to earn the accept. NOT to pitch. No mechanism-dump, no solution statement, no meeting ask, no links. Never open with a scraped-looking stat. One genuinely specific observation, then a plain reason to connect. It must read like a person noticed something, not like a tool populated a field.

ATTRIBUTION RULE (the most important rule here, and the one most easily got wrong):
The company signal you are given may describe something a DIFFERENT person at the company did — a podcast, a conference talk, a blog post, a named individual's project. You are writing to the person named below, who is probably NOT that person. NEVER write "your podcast" / "your talk" / "your post" unless the signal explicitly names THIS person as the one who did it. When the signal belongs to someone else or to no one in particular, attribute it correctly and naturally: "your team's", "the talk your DX group gave", "what your platform org is shipping", or simply drop the artifact and observe the underlying engineering situation instead. A misattributed compliment is worse than a generic note.

ROLE FIT: shape the observation to what THIS person plausibly owns. ${
    isAnchor
      ? "This person is a senior executive (CIO/CTO/SVP scale). Pitch at their altitude: the engineering-org-wide situation, not a specific tool or pipeline. Do not imply they personally run the toolchain."
      : "This person owns or influences developer tooling directly. It is fair to reference the concrete platform/tooling/developer-experience situation they'd actually touch day to day."
  }

${VOICE_SPEC}`;

  const user = `Company: ${company}
${body.companyLine ? `Company context: ${body.companyLine}\n` : ""}Signal (what Max saw — may describe someone else at the company, read the attribution rule):
${callHook}

WRITE THE CONNECT NOTE FOR:
Name: ${body.name || "(unnamed)"}
Title: ${body.title || "(unknown)"}`;

  // Generate, then ASSERT. The cap and the ban list are checked in code, not
  // just asked for in the prompt: a silent trim mid-sentence is how an over-cap
  // draft used to get discovered on paste. A violation is regenerated with the
  // specific failure named, and only a second failure falls back to trimming.
  try {
    let best = "";
    let lastProblem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await callClaudeWithWebSearch({
        system,
        user: attempt === 0 ? user : `${user}\n\nYour previous draft was rejected: ${lastProblem}. Rewrite it, fixing that specifically. Do not simply shorten by deleting the last sentence; rewrite so it reads whole.`,
        model: FAST_MODEL,
        webSearch: false,
        maxTokens: 400,
        temperature: 0.7, // some spread so two people at one company don't rhyme
      });
      const draft = res.text.replace(/^["'\s]+|["'\s]+$/g, "").trim();
      best = draft;
      const over = !withinConnectCap(draft);
      const hits = bannedHits(draft);
      if (!over && hits.length === 0) {
        return NextResponse.json(
          { ok: true, connect: draft, chars: draft.length },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      lastProblem = [
        over ? `it was ${draft.length} characters, over the ${CONNECT_CAP} cap` : "",
        hits.length ? `it contained banned phrasing (${hits.join(", ")})` : "",
      ]
        .filter(Boolean)
        .join(" and ");
    }
    // Second attempt still failed — trim as a last resort rather than 502, but
    // report the character count so the caller can see it was salvaged.
    const connect = enforceLinkedin(best, CONNECT_CAP);
    if (!connect) {
      return NextResponse.json({ ok: false, error: "Empty draft" }, { status: 502 });
    }
    return NextResponse.json(
      { ok: true, connect, chars: connect.length, salvaged: lastProblem },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Connect-note generation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
