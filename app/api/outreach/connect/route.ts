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
  connectProblems,
  enforceLinkedin,
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
  const first = (body.name || "").trim().split(/\s+/)[0] || "there";

  const system = `You write LinkedIn connect notes for Max, a founding AE at Bito.

BACKGROUND, FOR YOUR UNDERSTANDING ONLY — this paragraph must NOT appear in the note in any form, paraphrased or otherwise: Bito precomputes a map of a company's code, commits and tickets and serves it to any coding agent over MCP, and it is built for big multi-repo codebases. Drafts that leak this back out ("we index that upfront so agents start knowing the architecture") are rejected. In the note, Bito is mentioned exactly once, as the thing Max works on.

Write ONE connect note for ONE named person. Output the note text ONLY — no JSON, no quotes around it, no preamble.

This is a CONNECT REQUEST: open "Hey ${first}," then AT MOST three short sentences, HARD CAP ${CONNECT_CAP} characters including spaces. Well under the cap is better than near it. NO signature — do not sign "Max" on a connect request.

The note's only job is to earn the accept. It must ASK how they are handling coding agents against their specific situation, mention in one clause that this is what Max works on, and stop. No pitch, no mechanism, no solution statement, no diagnosis of their problem, no meeting ask, no links, no numbers. It should read like a note a person typed in ten seconds, because a real one is.

ATTRIBUTION RULE (the most important rule here, and the one most easily got wrong):
The company signal you are given may describe something a DIFFERENT person at the company did — a podcast, a conference talk, a blog post, a named individual's project. You are writing to the person named below, who is probably NOT that person. NEVER write "your podcast" / "your talk" / "your post" unless the signal explicitly names THIS person as the one who did it. When the signal belongs to someone else or to no one in particular, attribute it correctly and naturally: "your team's", "the talk your DX group gave", "what your platform org is shipping", or simply drop the artifact and observe the underlying engineering situation instead. A misattributed compliment is worse than a generic note.

ROLE FIT: shape the QUESTION to what THIS person plausibly owns. ${
    isAnchor
      ? "This person is a senior executive (CIO/CTO/SVP scale). Ask at their altitude: how the engineering org is approaching it, not about a specific tool or pipeline. Do not imply they personally run the toolchain."
      : "This person owns or influences developer tooling directly. It is fair to ask about the concrete platform/tooling/developer-experience situation they'd actually touch day to day."
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
    // Three attempts, not two. The pitch reflex is strong enough that one
    // rewrite often only half-fixes it, and a Haiku call is cheap next to a
    // connect request that reads like a landing page.
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await callClaudeWithWebSearch({
        system,
        user: attempt === 0 ? user : `${user}\n\nYour previous draft was rejected because ${lastProblem}. Here is that draft:\n\n${best}\n\nRewrite it, fixing that specifically. Do not simply shorten by deleting the last sentence; rewrite so it reads whole, casual, and asks a question.`,
        model: FAST_MODEL,
        webSearch: false,
        maxTokens: 400,
        temperature: 0.7, // some spread so two people at one company don't rhyme
      });
      const draft = res.text.replace(/^["'\s]+|["'\s]+$/g, "").trim();
      best = draft;
      const problems = connectProblems(draft);
      if (problems.length === 0) {
        return NextResponse.json(
          { ok: true, connect: draft, chars: draft.length },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      lastProblem = problems.join("; and ");
    }
    // Three failures. The old behaviour was to TRIM the last draft and ship it,
    // but trimming only fixes length — a note rejected for pitching is still
    // pitching after a trim, and it went out labelled as if it were clean.
    // Fall back to Max's own approved template instead: generic, but never
    // embarrassing, and flagged so the rep knows it isn't the personalized one.
    const connect = enforceLinkedin(
      `Hey ${first},\n\nCurious how you're handling coding agents at ${company}. That's what I work on at Bito, would be good to connect.`,
      CONNECT_CAP,
    );
    return NextResponse.json(
      { ok: true, connect, chars: connect.length, generic: true, rejected: lastProblem, discarded: best },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Connect-note generation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
