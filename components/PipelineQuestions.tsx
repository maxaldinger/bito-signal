"use client";

// Pipeline Questions — static reference for live calls. Two columns: the
// discovery call on the left, the POC scoping call on the right. Content is
// Max's, verbatim (2026-08-14), including the account references — the
// parentheticals are the reasons a question exists, learned from real deals.

import { ClipboardList, Compass, FlaskConical } from "lucide-react";

interface Q {
  n: number;
  q: string;
  note?: string;
}

interface Group {
  heading: string;
  items: Q[];
}

const DISCOVERY: Group[] = [
  {
    heading: "Scale and shape",
    items: [
      { n: 1, q: "How many developers, and how many repos do they actually work across?" },
      { n: 2, q: "Is the codebase a monorepo, a few large services, or hundreds of small ones?" },
      {
        n: 3,
        q: "When someone builds a feature that touches multiple services, who figures out what to touch and how long does that take?",
      },
    ],
  },
  {
    heading: "Current state",
    items: [
      {
        n: 4,
        q: "Which harness are they on and which models, and do they have an LLM gateway already? If so, what does it do for them today — rate limiting, usage counting, routing?",
      },
      { n: 5, q: "What are they spending per developer per month, and is anyone hitting the cap?" },
      {
        n: 6,
        q: "What have they already built internally to solve this?",
        note: "Navi, MeridianLink, Watermark, Kotak and redBus all had something. Finding out late is what kills these.",
      },
    ],
  },
  {
    heading: "The pain, in their words",
    items: [
      {
        n: 7,
        q: "Where does the agent produce output they can't ship without a senior engineer rewriting it?",
      },
      { n: 8, q: "What kind of task does the agent get wrong most often?" },
      { n: 9, q: "What is the cost of that today, in time or rework, not in tokens?" },
    ],
  },
  {
    heading: "Priority",
    items: [
      {
        n: 10,
        q: "If they could only fix one, cost or quality, which one and why?",
        note: "Every account gives both. Make them rank it.",
      },
      {
        n: 11,
        q: "Is adoption itself still a problem, or are people using the tools heavily already?",
        note: "Ivan ranked adoption above both cost and quality. That changes everything.",
      },
    ],
  },
  {
    heading: "Buying process",
    items: [
      { n: 12, q: "Who owns this decision, and who has to approve it?" },
      { n: 13, q: "Has anything like this gone through InfoSec before, and who runs that?" },
      { n: 14, q: "Is there budget for this, or does it have to come out of something else?" },
      { n: 15, q: "What would have to be true for you to move forward after a POC?" },
    ],
  },
  {
    heading: "The one nobody asks",
    items: [
      {
        n: 16,
        q: "What happened the last time you evaluated a tool like this and didn't buy it?",
        note: "Guidewire had a Qodo failure scar. That's the objection you'd otherwise hit blind.",
      },
    ],
  },
];

const POC: Group[] = [
  {
    heading: "Success definition, first, before anything else",
    items: [
      { n: 1, q: "What number has to move, and by how much, for this to be a yes?" },
      { n: 2, q: "Who inside your organization has to see that number to approve a purchase?" },
      {
        n: 3,
        q: "What does failure look like?",
        note: "If they can't answer this, there are no criteria yet.",
      },
    ],
  },
  {
    heading: "Baseline",
    items: [
      {
        n: 4,
        q: "What is that number today? If they don't know, who can pull it, and by when?",
      },
      { n: 5, q: "Do you have per-task token, time, and tool-call data, or only aggregate spend?" },
      {
        n: 6,
        q: "Can we run the baseline arm on the same tasks with the same model, so the only variable is us?",
        note: "This is exactly what Kotak asked for and Bito couldn't produce.",
      },
    ],
  },
  {
    heading: "Scope",
    items: [
      {
        n: 7,
        q: "Which repos, and are they interdependent?",
        note: "A single clean repo understates the value.",
      },
      {
        n: 8,
        q: "Which specific projects or tickets do you want it pointed at? Ideally work already in flight and already painful.",
      },
      { n: 9, q: "How many engineers, and are they named?" },
    ],
  },
  {
    heading: "Ownership and timeline",
    items: [
      { n: 10, q: "Who is driving this day to day on your side?" },
      { n: 11, q: "How much time can they realistically give it per week?" },
      {
        n: 12,
        q: "What is the start date and the end date?",
        note: "An open-ended POC never ends.",
      },
      { n: 13, q: "When does the readout happen, and who is in the room?" },
    ],
  },
  {
    heading: "Deployment and blockers",
    items: [
      { n: 14, q: "Your environment or ours, and who decides?" },
      { n: 15, q: "Who owns InfoSec approval and what's their typical turnaround?" },
      {
        n: 16,
        q: "What access do we need — GitHub, Jira, an LLM endpoint — and who grants it?",
      },
      { n: 17, q: "What could stop this from starting on time?" },
    ],
  },
  {
    heading: "After",
    items: [
      {
        n: 18,
        q: "If the POC hits the number, what is the next step, and is there a budget cycle it has to fit?",
      },
      { n: 19, q: "Who else needs to be convinced besides the people on this call?" },
    ],
  },
];

function QuestionList({ groups }: { groups: Group[] }) {
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.heading}>
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
            {g.heading}
          </h4>
          <ol className="space-y-2.5">
            {g.items.map((item) => (
              <li key={item.n} className="flex gap-2.5">
                <span className="mt-px w-5 shrink-0 text-right font-mono text-[11px] font-semibold text-neon-400">
                  {item.n}
                </span>
                <div className="min-w-0">
                  <p className="text-sm leading-snug text-ink-100">{item.q}</p>
                  {item.note && (
                    <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{item.note}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

export function PipelineQuestions() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink-50">
          <ClipboardList className="h-5 w-5 text-neon-400" /> Pipeline Questions
        </h2>
        <p className="mt-1 text-sm text-ink-400">
          The two call scripts that move a deal: discovery on the left, POC scoping on the right.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-5">
          <h3 className="mb-4 flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-sky-300">
            <Compass className="h-4 w-4" /> Discovery call
          </h3>
          <QuestionList groups={DISCOVERY} />
        </section>

        <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-5">
          <h3 className="mb-4 flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-violet-300">
            <FlaskConical className="h-4 w-4" /> POC scoping call
          </h3>
          <QuestionList groups={POC} />
        </section>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <p className="text-sm leading-relaxed text-amber-200/90">
          The two most important on the whole list are <strong>POC #1</strong> and{" "}
          <strong>POC #12</strong>. Every stalled deal in the pipeline — Guidewire, Tanium, Capital
          One, Kotak, InMobi — is missing one or both.
        </p>
      </div>
    </div>
  );
}
