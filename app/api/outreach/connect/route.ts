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
import { BANNED_WRITING, enforceLinkedin } from "@/lib/outreachRules";

export const maxDuration = 30;

const CONNECT_CAP = 200;

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

  const isAnchor = (body.classification || "").toUpperCase() === "ACCOUNT_ANCHOR";

  const system = `You write LinkedIn connect notes for Max, a founding AE at Bito. Bito precomputes a map of a company's code, commits, and tickets and serves it to any coding agent or IDE over MCP, so agents start already knowing the architecture instead of re-learning it every session. Bito is built for big interconnected multi-repo / microservice codebases.

Write ONE connect note for ONE named person. Output the note text ONLY — no JSON, no quotes around it, no preamble, no sign-off.

HARD CAP ${CONNECT_CAP} characters including spaces.

The note's only job is to earn the accept. NOT to pitch. No mechanism-dump, no solution statement, no meeting ask, no links. Never open with a scraped-looking stat. One genuinely specific observation, then a plain reason to connect. It must read like a person noticed something, not like a tool populated a field.

ATTRIBUTION RULE (the most important rule here, and the one most easily got wrong):
The company signal you are given may describe something a DIFFERENT person at the company did — a podcast, a conference talk, a blog post, a named individual's project. You are writing to the person named below, who is probably NOT that person. NEVER write "your podcast" / "your talk" / "your post" unless the signal explicitly names THIS person as the one who did it. When the signal belongs to someone else or to no one in particular, attribute it correctly and naturally: "your team's", "the talk your DX group gave", "what your platform org is shipping", or simply drop the artifact and observe the underlying engineering situation instead. A misattributed compliment is worse than a generic note.

ROLE FIT: shape the observation to what THIS person plausibly owns. ${
    isAnchor
      ? "This person is a senior executive (CIO/CTO/SVP scale). Pitch at their altitude: the engineering-org-wide situation, not a specific tool or pipeline. Do not imply they personally run the toolchain."
      : "This person owns or influences developer tooling directly. It is fair to reference the concrete platform/tooling/developer-experience situation they'd actually touch day to day."
  }

VOICE: plain, direct, peer-to-peer. Max is an engineer-adjacent seller, not a hype man. No compliments about how impressive the company is.

${BANNED_WRITING}`;

  const user = `Company: ${company}
${body.companyLine ? `Company context: ${body.companyLine}\n` : ""}Signal (what Max saw — may describe someone else at the company, read the attribution rule):
${callHook}

WRITE THE CONNECT NOTE FOR:
Name: ${body.name || "(unnamed)"}
Title: ${body.title || "(unknown)"}`;

  try {
    const res = await callClaudeWithWebSearch({
      system,
      user,
      model: FAST_MODEL,
      webSearch: false,
      maxTokens: 400,
      temperature: 0.7, // some spread so two people at one company don't rhyme
    });
    const connect = enforceLinkedin(res.text.replace(/^["'\s]+|["'\s]+$/g, ""), CONNECT_CAP);
    if (!connect) {
      return NextResponse.json({ ok: false, error: "Empty draft" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, connect }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Connect-note generation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
