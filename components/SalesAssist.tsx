"use client";

import { useRef, useState } from "react";
import {
  Send,
  Loader2,
  RotateCcw,
  ArrowUpRight,
  Sparkles,
  Plus,
  Trash2,
  Copy,
  ChevronDown,
  Users,
  Lightbulb,
  FileSpreadsheet,
} from "lucide-react";
import type { LiveCitation } from "@/lib/types";

// ---------------------------------------------------------------------------
// Modes — chat modes stream a conversation; tool modes render structured UIs.
// ---------------------------------------------------------------------------
const MODES: { id: string; label: string; dot: string }[] = [
  { id: "ask", label: "Ask Anything", dot: "#9aa3b2" },
  { id: "lou", label: "LOU", dot: "#06b6d4" },
  { id: "meddpicc", label: "MEDDPICC", dot: "#f59e0b" },
  { id: "threading", label: "Threading", dot: "#8b5cf6" },
  { id: "proposal", label: "Proposal", dot: "#ec4899" },
  { id: "deck", label: "Deck", dot: "#a855f7" },
];
const CHAT_MODES = new Set(["ask"]);

const TONES = ["Direct", "Consultative", "Concise", "Technical"];
const PERSONAS = [
  "VP Engineering",
  "CTO",
  "Head of Platform / DevEx",
  "Staff Engineer",
  "Security Lead",
];

interface Ctx {
  tone: string;
  persona: string;
}

async function postAssist(body: Record<string, unknown>) {
  const res = await fetch("/api/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    return await res.json();
  } catch {
    return { error: `HTTP ${res.status} — ${res.statusText || "non-JSON response"}` };
  }
}

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------
function Notice({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-300">
      {text}
    </div>
  );
}

function GenerateButton({
  onClick,
  loading,
  disabled,
  label,
}: {
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex items-center gap-2 rounded-lg border border-neon-600/50 bg-neon-500/15 px-5 py-2.5 text-sm font-semibold text-neon-300 shadow-glow-sm transition-all hover:bg-neon-500/25 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {label}
    </button>
  );
}

function ToolHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-bold text-ink-50">{title}</h3>
      <p className="mt-0.5 text-sm text-ink-400">{desc}</p>
    </div>
  );
}

const notesArea =
  "w-full resize-none rounded-xl border border-ink-700 bg-ink-950 px-4 py-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-neon-600/50 focus:outline-none";
const inputCls =
  "rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-neon-600/50 focus:outline-none";

// ---------------------------------------------------------------------------
// Chat tool (Ask / Cold Email / Objections / Live Research)
// ---------------------------------------------------------------------------
type Msg = {
  role: "user" | "assistant" | "notice";
  content: string;
  citations?: LiveCitation[];
};

const QUICK = [
  {
    label: "Draft a cold email",
    prompt:
      "Draft a cold email to a VP of Engineering at a 200-engineer fintech that just raised a Series C and is hiring platform engineers. Angle: AI coding tools are shipping context-blind code across their repos — Bito AI Architect is the context layer that grounds them.",
  },
  {
    label: '"We already have Copilot"',
    prompt:
      'Prospect says: "We already pay for GitHub Copilot — why would we add Bito?" Handle it (Bito AI Architect grounds Copilot in their real cross-repo codebase, it is not a replacement).',
  },
  {
    label: "Prep a discovery call",
    prompt:
      "Plan a 30-minute first discovery call with a Head of Platform at a Series C marketplace company — agenda, the five questions that matter, and what good answers sound like.",
  },
];

function ChatTool({ ctx }: { ctx: Ctx }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Bumped on clear so a late in-flight response can't append an orphan
  // assistant message into a fresh conversation.
  const generation = useRef(0);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    const gen = generation.current;
    const history = messages.filter((m) => m.role !== "notice");
    setMessages([...messages, { role: "user", content }]);
    setInput("");
    setLoading(true);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    const data = await postAssist({
      mode: "ask",
      tone: ctx.tone,
      persona: ctx.persona,
      messages: [...history, { role: "user", content }].map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }).catch(() => ({ error: "Network error — try again." }));

    if (gen !== generation.current) return; // conversation cleared mid-flight

    setMessages((m) => {
      const next: Msg[] = [
        ...m,
        data.text
          ? { role: "assistant" as const, content: data.text, citations: data.citations }
          : { role: "notice" as const, content: data.error || "No response." },
      ];
      if (data.text && data.truncated) {
        next.push({
          role: "notice",
          content:
            "⚠ This answer was cut off by the token limit — treat it as incomplete and ask a narrower follow-up.",
        });
      }
      return next;
    });
    setLoading(false);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const quick = (q: (typeof QUICK)[number]) => {
    if (q.prompt) send(q.prompt);
    else inputRef.current?.focus();
  };

  return (
    <div>
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <h2 className="font-mono text-3xl font-bold tracking-tight text-ink-50">
            what do you need<span className="text-neon-400">?</span>
          </h2>
          <p className="mt-2 text-sm text-ink-400">
            Your AI sales engineer for Bito — answers grounded in live web search.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {QUICK.map((q) => (
              <button
                key={q.label}
                onClick={() => quick(q)}
                className="rounded-full border border-ink-700 bg-ink-900 px-4 py-2 text-sm font-medium text-ink-300 transition-colors hover:border-neon-600/40 hover:text-neon-300"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-4 space-y-4">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-neon-600/40 bg-neon-500/10 px-4 py-2.5 text-sm leading-relaxed text-ink-100">
                  {m.content}
                </div>
              </div>
            ) : m.role === "notice" ? (
              <Notice key={i} text={m.content} />
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-ink-700 bg-ink-900 px-4 py-3">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-100">
                    {m.content}
                  </div>
                  {m.citations && m.citations.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-700 pt-2">
                      {m.citations.map((c) => (
                        <a
                          key={c.url}
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={c.title}
                          className="inline-flex max-w-[200px] items-center gap-0.5 truncate rounded border border-ink-700 bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 hover:text-neon-300"
                        >
                          <span className="truncate">{c.source}</span>
                          <ArrowUpRight className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          {loading && (
            <div className="flex items-center gap-2 font-mono text-xs text-neon-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              ▸ thinking…
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {/* Composer */}
      <div className="rounded-2xl border border-ink-700 bg-ink-950 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder="What do you need? (Shift+Enter for newline)"
            className="flex-1 resize-none bg-transparent px-2 py-1.5 font-mono text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
          {messages.length > 0 && (
            <button
              onClick={() => {
                generation.current++;
                setMessages([]);
                setLoading(false);
              }}
              disabled={loading}
              title={loading ? "Wait for the current response" : "Clear conversation"}
              className="rounded-lg border border-ink-700 p-2 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="inline-flex items-center justify-center rounded-lg border border-neon-600/50 bg-neon-500/15 p-2.5 text-neon-300 transition-all hover:bg-neon-500/25 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOU tool — Letter of Understanding builder with branded Excel export
// ---------------------------------------------------------------------------
interface Issue {
  issue: string;
  solution: string;
  category: string;
  priority: string;
  timeframe: string;
}
const PRIO_COLOR: Record<string, string> = {
  High: "text-red-400",
  Medium: "text-amber-400",
  Low: "text-neon-400",
};

function LouTool({ ctx }: { ctx: Ctx }) {
  const [notes, setNotes] = useState("");
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(false);

  const generate = async () => {
    if (!notes.trim()) return;
    setLoading(true);
    setError("");
    const data = await postAssist({
      mode: "lou",
      notes,
      tone: ctx.tone,
      persona: ctx.persona,
    }).catch(() => ({ error: "Network error." }));
    setLoading(false);
    if (data.data?.issues) {
      setIssues(data.data.issues);
      setEditing(false);
    } else setError(data.error || "Could not generate.");
  };

  const update = (i: number, key: keyof Issue, val: string) =>
    setIssues((arr) => arr!.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));

  const exportXlsx = async () => {
    if (!issues || exporting) return;
    setExporting(true);
    try {
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      wb.creator = "Bito Signal";
      wb.created = new Date();
      const ws = wb.addWorksheet("Letter of Understanding", {
        views: [{ state: "frozen", ySplit: 4 }],
      });

      const BRAND = "FF059669"; // Bito green
      const WHITE = "FFFFFFFF";
      const BORDER = "FFD9DEE8";
      const border = {
        top: { style: "thin" as const, color: { argb: BORDER } },
        left: { style: "thin" as const, color: { argb: BORDER } },
        bottom: { style: "thin" as const, color: { argb: BORDER } },
        right: { style: "thin" as const, color: { argb: BORDER } },
      };
      const solid = (argb: string) =>
        ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

      // A is a slim left gutter; B–F hold the content.
      ws.columns = [
        { width: 2.5 },
        { width: 48 },
        { width: 44 },
        { width: 24 },
        { width: 12 },
        { width: 22 },
      ];

      const fmt = (iso: string) => {
        const d = iso ? new Date(`${iso}T00:00:00`) : new Date();
        return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
      };

      ws.getCell("B1").value = `Last Updated: ${fmt(new Date().toISOString().slice(0, 10))}`;
      ws.getCell("B1").font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF64748B" } };

      ws.mergeCells("B2:F2");
      const title = ws.getCell("B2");
      title.value = "Letter of Understanding";
      title.fill = solid(BRAND);
      title.font = { name: "Calibri", size: 20, bold: true, color: { argb: WHITE } };
      title.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      ws.getRow(2).height = 40;

      ws.mergeCells("B3:F3");
      const intro = ws.getCell("B3");
      intro.value =
        `On ${fmt(meetingDate)}, Bito met with your team to understand your critical business issues and how Bito can help. ` +
        `Please correct anything we got wrong, add anything we missed, and provide any additional context.`;
      intro.font = { name: "Calibri", size: 11, color: { argb: "FF334155" } };
      intro.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      ws.getRow(3).height = 48;

      const headers = ["Critical Business Issue", "Can we help? If so, how?", "Category", "Priority", "Timeframe"];
      const headRow = ws.getRow(4);
      headers.forEach((h, i) => {
        const c = headRow.getCell(i + 2);
        c.value = h;
        c.fill = solid(BRAND);
        c.font = { name: "Calibri", size: 12, bold: true, color: { argb: WHITE } };
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.border = border;
      });
      headRow.height = 26;

      const PRIO_FILL: Record<string, string> = { High: "FFFCE8E6", Medium: "FFFFF4E0", Low: "FFE7F6EC" };
      const PRIO_TEXT: Record<string, string> = { High: "FFB91C1C", Medium: "FFB45309", Low: "FF047857" };
      const lines = (txt: string, width: number) => Math.max(1, Math.ceil((txt || "").length / (width * 1.1)));

      issues.forEach((it, idx) => {
        const r = ws.getRow(5 + idx);
        [it.issue, it.solution, it.category, it.priority, it.timeframe].forEach((val, ci) => {
          const c = r.getCell(ci + 2);
          c.value = val || "";
          c.border = border;
          c.font = { name: "Calibri", size: 10, color: { argb: "FF0F172A" } };
          c.alignment = { vertical: "top", horizontal: ci <= 1 ? "left" : "center", wrapText: true };
        });
        const p = r.getCell(5);
        if (PRIO_FILL[it.priority]) {
          p.fill = solid(PRIO_FILL[it.priority]);
          p.font = { name: "Calibri", size: 10, bold: true, color: { argb: PRIO_TEXT[it.priority] } };
          p.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        }
        r.height = Math.min(240, Math.max(lines(it.issue, 48), lines(it.solution, 44)) * 13.5 + 8);
      });

      const last = 4 + issues.length;
      for (let row = 5; row <= last; row++) {
        ws.getCell(`D${row}`).dataValidation = {
          type: "list", allowBlank: true, showErrorMessage: false,
          formulae: ['"Review Throughput,Code Quality & Bugs,Security & Compliance,AI Tooling Cost,Adoption & Process"'],
        };
        ws.getCell(`E${row}`).dataValidation = {
          type: "list", allowBlank: true, showErrorMessage: false,
          formulae: ['"High,Medium,Low"'],
        };
      }

      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `bito-lou-${meetingDate || "draft"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not build the Excel file. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  if (!issues || editing) {
    return (
      <div>
        <ToolHeader
          title="Letter of Understanding Builder"
          desc="Paste meeting notes or a transcript to generate a structured LOU table you can edit and export to a branded Excel file."
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={10}
          placeholder="Paste meeting notes, call transcript, or key discussion points..."
          className={notesArea}
        />
        {error && <div className="mt-3"><Notice text={error} /></div>}
        <div className="mt-3">
          <GenerateButton onClick={generate} loading={loading} disabled={!notes.trim()} label="Generate LOU" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <ToolHeader
        title="Letter of Understanding Builder"
        desc="Review and edit the table, then export a branded Excel file ready to send."
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
            meeting date
          </span>
          <input
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className={`${inputCls} text-ink-200`}
          />
        </label>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm font-medium text-ink-300 hover:bg-ink-800"
          >
            Edit Notes
          </button>
          <button
            onClick={() =>
              setIssues([...issues, { issue: "", solution: "", category: "", priority: "Medium", timeframe: "" }])
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm font-medium text-ink-300 hover:bg-ink-800"
          >
            <Plus className="h-4 w-4" /> Add Issue
          </button>
        </div>
        <button
          onClick={exportXlsx}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neon-600/50 bg-neon-500/15 px-3 py-1.5 text-sm font-medium text-neon-300 hover:bg-neon-500/25 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}{" "}
          Export Excel
        </button>
      </div>
      {error && <div className="mb-3"><Notice text={error} /></div>}
      <div className="overflow-x-auto rounded-xl border border-ink-700 bg-ink-900">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-ink-950 text-left font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              <th className="w-[28%] p-3">Critical Business Issue</th>
              <th className="w-[36%] p-3">Can we help? If so, how?</th>
              <th className="p-3">Category</th>
              <th className="p-3">Priority</th>
              <th className="p-3">Timeframe</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {issues.map((r, i) => (
              <tr key={i} className="border-b border-ink-700 align-top last:border-0">
                <td className="p-2"><Cell value={r.issue} onChange={(v) => update(i, "issue", v)} /></td>
                <td className="p-2"><Cell value={r.solution} onChange={(v) => update(i, "solution", v)} /></td>
                <td className="p-2"><Cell value={r.category} onChange={(v) => update(i, "category", v)} /></td>
                <td className="p-2">
                  <select
                    value={r.priority}
                    onChange={(e) => update(i, "priority", e.target.value)}
                    className={`rounded-md border border-ink-700 bg-ink-950 px-1.5 py-1 text-xs font-semibold ${PRIO_COLOR[r.priority] || "text-ink-300"}`}
                  >
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </td>
                <td className="p-2"><Cell value={r.timeframe} onChange={(v) => update(i, "timeframe", v)} /></td>
                <td className="p-2">
                  <button
                    onClick={() => setIssues(issues.filter((_, idx) => idx !== i))}
                    className="rounded p-1 text-ink-500 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={Math.max(2, Math.ceil((value?.length || 0) / 38))}
      className="w-full resize-none rounded-md border border-transparent bg-transparent p-1.5 text-sm leading-relaxed text-ink-200 hover:border-ink-700 focus:border-neon-600/50 focus:bg-ink-950 focus:outline-none"
    />
  );
}

// ---------------------------------------------------------------------------
// MEDDPICC tool
// ---------------------------------------------------------------------------
const MEDD = [
  { key: "metrics", letter: "M", label: "Metrics" },
  { key: "economicBuyer", letter: "E", label: "Economic Buyer" },
  { key: "decisionCriteria", letter: "D", label: "Decision Criteria" },
  { key: "decisionProcess", letter: "D", label: "Decision Process" },
  { key: "paperProcess", letter: "P", label: "Paper Process" },
  { key: "identifyPain", letter: "I", label: "Implicate the Pain" },
  { key: "champion", letter: "C", label: "Champion" },
  { key: "competition", letter: "C", label: "Competition" },
] as const;
type Elem = { status: string; notes: string; suggestions?: string[] };
const STATUS_STYLE: Record<string, string> = {
  strong: "bg-neon-500/15 text-neon-300",
  weak: "bg-amber-500/15 text-amber-400",
  missing: "bg-red-500/15 text-red-400",
  not_set: "bg-ink-800 text-ink-400",
};

function MeddpiccTool({ ctx }: { ctx: Ctx }) {
  const [account, setAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [elements, setElements] = useState<Record<string, Elem> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async () => {
    if (!notes.trim()) return;
    setLoading(true);
    setError("");
    const data = await postAssist({ mode: "meddpicc", account, notes, tone: ctx.tone, persona: ctx.persona }).catch(() => ({ error: "Network error." }));
    setLoading(false);
    if (data.data?.elements) setElements(data.data.elements);
    else setError(data.error || "Could not analyze.");
  };

  const els = elements || {};
  const get = (k: string): Elem => (els[k] as Elem) || { status: "not_set", notes: "" };
  const counts = MEDD.reduce(
    (a, m) => {
      const s = get(m.key).status || "not_set";
      a[s] = (a[s] || 0) + 1;
      return a;
    },
    {} as Record<string, number>,
  );
  // Strength-weighted: strong = full credit, weak = half, missing/not_set = none.
  const strength = (counts.strong || 0) + 0.5 * (counts.weak || 0);
  const pct = Math.round((strength / 8) * 100);
  const label = pct === 0 ? "Not Started" : pct < 40 ? "Early" : pct < 70 ? "Developing" : "Well Qualified";

  const copy = async () => {
    const txt =
      `MEDDPICC — ${account || "Account"}\n\n` +
      MEDD.map((m) => `${m.label} [${get(m.key).status}]: ${get(m.key).notes || "—"}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed — select the text manually.");
    }
  };

  const updateEl = (k: string, patch: Partial<Elem>) =>
    setElements((e) => ({ ...(e || {}), [k]: { ...get(k), ...patch } }));

  // Append a suggestion into the element's notes and remove it from the list.
  const addSuggestion = (k: string, idx: number) => {
    const cur = get(k);
    const sug = cur.suggestions?.[idx];
    if (!sug) return;
    const notes = cur.notes?.trim() ? `${cur.notes.trim()}\n- ${sug}` : `- ${sug}`;
    updateEl(k, { notes, suggestions: (cur.suggestions || []).filter((_, i) => i !== idx) });
  };

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <ToolHeader
          title="MEDDPICC Scorecard"
          desc="Paste meeting notes and hit Analyze — only the topics you actually discussed get filled in. Edit or add to any field after."
        />
        {elements && (
          <button
            onClick={copy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm font-medium text-ink-300 hover:bg-ink-800"
          >
            <Copy className="h-4 w-4" /> {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>

      <input
        value={account}
        onChange={(e) => setAccount(e.target.value)}
        placeholder="Account name (e.g. Lattice)"
        className={`${inputCls} mb-3 w-full px-3.5 py-2.5`}
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={5}
        placeholder="Paste meeting notes, call transcripts, or email threads here. AI will only fill in the MEDDPICC fields that were actually discussed..."
        className={notesArea}
      />
      {error && <div className="mt-3"><Notice text={error} /></div>}
      <div className="mt-3">
        <GenerateButton onClick={run} loading={loading} disabled={!notes.trim()} label="Analyze & Fill Scorecard" />
      </div>

      {/* Deal Qualification tracker */}
      <div className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-5">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-ink-200">
            <span className="text-neon-400">◎</span> deal qualification
          </h4>
          <span className={`font-mono text-sm font-bold ${pct === 0 ? "text-red-400" : pct < 75 ? "text-amber-400" : "text-neon-400"}`}>
            {pct}% — {label}
          </span>
        </div>
        <div className="my-3 h-2 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-600 to-neon-400"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-4 font-mono text-xs">
          <span className="text-neon-400">{counts.strong || 0} strong</span>
          <span className="text-amber-400">{counts.weak || 0} weak</span>
          <span className="text-red-400">{counts.missing || 0} missing</span>
          <span className="text-ink-500">{counts.not_set || 8} not set</span>
        </div>
      </div>

      {/* Element rows */}
      <div className="mt-3 space-y-2">
        {MEDD.map((m) => {
          const el = get(m.key);
          const isOpen = open === m.key;
          return (
            <div key={m.key + m.label} className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
              <button
                onClick={() => setOpen(isOpen ? null : m.key)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink-800 font-mono text-xs font-bold text-ink-400">
                  {m.letter}
                </span>
                <span className="flex-1 text-sm font-semibold text-ink-100">{m.label}</span>
                <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${STATUS_STYLE[el.status] || STATUS_STYLE.not_set}`}>
                  {(el.status || "not_set").replace("_", " ")}
                </span>
                <ChevronDown className={`h-4 w-4 text-ink-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="border-t border-ink-700 p-4">
                  <div className="mb-2 flex gap-1.5">
                    {["strong", "weak", "missing", "not_set"].map((s) => (
                      <button
                        key={s}
                        onClick={() => updateEl(m.key, { status: s })}
                        className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${el.status === s ? STATUS_STYLE[s] : "bg-ink-800 text-ink-500"}`}
                      >
                        {s.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={el.notes}
                    onChange={(e) => updateEl(m.key, { notes: e.target.value })}
                    rows={3}
                    placeholder="Notes — what you learned, or what to discover…"
                    className={`${notesArea} rounded-lg px-3 py-2 text-ink-200`}
                  />
                  {el.suggestions && el.suggestions.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-neon-400">
                        <Lightbulb className="h-3.5 w-3.5" /> how to strengthen this
                      </div>
                      <ul className="space-y-1.5">
                        {el.suggestions.map((s, si) => (
                          <li
                            key={si}
                            className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm leading-relaxed text-ink-300"
                          >
                            <span className="mt-0.5 shrink-0 text-neon-400">→</span>
                            <span className="flex-1">{s}</span>
                            <button
                              onClick={() => addSuggestion(m.key, si)}
                              title="Add to notes"
                              className="shrink-0 rounded-md border border-ink-700 bg-ink-900 px-2 py-0.5 text-[11px] font-medium text-ink-400 transition-colors hover:border-neon-600/40 hover:text-neon-300"
                            >
                              + Add
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Threading tool
// ---------------------------------------------------------------------------
interface Stake { name: string; title: string; notes: string; }
interface ThreadResult {
  summary: string;
  stakeholders: { name: string; title: string; role: string; disposition: string; strategy: string }[];
  gaps: string[];
  nextActions: string[];
}
function ThreadingTool({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<Stake[]>([{ name: "", title: "", notes: "" }]);
  const [result, setResult] = useState<ThreadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    const valid = rows.filter((r) => r.name.trim() || r.title.trim());
    if (valid.length === 0) return;
    const notes =
      "Stakeholders:\n" +
      valid.map((r) => `- ${r.name || "?"} (${r.title || "?"}): ${r.notes || "no notes"}`).join("\n");
    setLoading(true);
    setError("");
    const data = await postAssist({ mode: "threading", notes, tone: ctx.tone, persona: ctx.persona }).catch(() => ({ error: "Network error." }));
    setLoading(false);
    if (data.data?.stakeholders) setResult(data.data);
    else setError(data.error || "Could not analyze.");
  };

  return (
    <div>
      <ToolHeader
        title="Multi-Threading Analysis"
        desc="Add the people in the deal. We'll classify the buying committee, score coverage, and recommend how to multi-thread."
      />
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={r.name}
              onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))}
              placeholder="Name"
              className={`${inputCls} sm:w-40`}
            />
            <input
              value={r.title}
              onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x)))}
              placeholder="Title"
              className={`${inputCls} sm:w-48`}
            />
            <input
              value={r.notes}
              onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, notes: e.target.value } : x)))}
              placeholder="Notes (e.g., met at discovery call, very engaged)"
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={() => setRows(rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows)}
              className="rounded-lg border border-ink-700 p-2 text-ink-500 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => setRows([...rows, { name: "", title: "", notes: "" }])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm font-medium text-ink-300 hover:bg-ink-800"
        >
          <Plus className="h-4 w-4" /> Add Stakeholder
        </button>
        <GenerateButton onClick={run} loading={loading} label="Analyze Committee" />
      </div>
      {error && <div className="mt-3"><Notice text={error} /></div>}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-ink-700 bg-ink-900 p-4 text-sm leading-relaxed text-ink-300">
            {result.summary}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {result.stakeholders.map((s, i) => (
              <div key={i} className="rounded-xl border border-ink-700 bg-ink-900 p-4">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-ink-100">{s.name}</h5>
                  <span className="rounded bg-neon-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-neon-300">
                    {s.role}
                  </span>
                </div>
                <p className="text-xs text-ink-500">{s.title} · {s.disposition}</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">{s.strategy}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ListCard icon={<Users className="h-4 w-4 text-amber-400" />} title="coverage gaps" items={result.gaps} />
            <ListCard icon={<Sparkles className="h-4 w-4 text-neon-400" />} title="next actions" items={result.nextActions} />
          </div>
        </div>
      )}
    </div>
  );
}

function ListCard({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <h4 className="mb-2 flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-ink-200">
        {icon} {title}
      </h4>
      <ul className="space-y-1.5 text-sm text-ink-300">
        {items?.map((g, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-ink-500">•</span> {g}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposal tool
// ---------------------------------------------------------------------------
function ProposalTool({ ctx }: { ctx: Ctx }) {
  const [notes, setNotes] = useState("");
  const [products, setProducts] = useState("");
  const [result, setResult] = useState<{ title: string; sections: { heading: string; content: string }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    if (!notes.trim()) return;
    setLoading(true);
    setError("");
    const data = await postAssist({ mode: "proposal", notes, extra: products, tone: ctx.tone, persona: ctx.persona }).catch(() => ({ error: "Network error." }));
    setLoading(false);
    if (data.data?.sections) setResult(data.data);
    else setError(data.error || "Could not generate.");
  };
  return (
    <div>
      <ToolHeader
        title="Proposal Builder"
        desc="Turn discovery notes into a structured proposal outline you can polish and send."
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={5}
        placeholder="Paste meeting notes, key requirements, pain points discussed..."
        className={notesArea}
      />
      <textarea
        value={products}
        onChange={(e) => setProducts(e.target.value)}
        rows={3}
        placeholder="List Bito modules or solutions to recommend, one per line..."
        className={`${notesArea} mt-3`}
      />
      {error && <div className="mt-3"><Notice text={error} /></div>}
      <div className="mt-3">
        <GenerateButton onClick={run} loading={loading} disabled={!notes.trim()} label="Generate Proposal" />
      </div>
      {result && (
        <div className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-6">
          <h3 className="mb-4 text-xl font-bold text-ink-50">{result.title}</h3>
          <div className="space-y-5">
            {result.sections.map((s, i) => (
              <div key={i}>
                <h4 className="mb-1 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-neon-400">
                  {s.heading}
                </h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-300">{s.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deck tool
// ---------------------------------------------------------------------------
function DeckTool({ ctx }: { ctx: Ctx }) {
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ slides: { title: string; bullets: string[]; notes?: string }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    if (!notes.trim()) return;
    setLoading(true);
    setError("");
    const data = await postAssist({ mode: "deck", notes, tone: ctx.tone, persona: ctx.persona }).catch(() => ({ error: "Network error." }));
    setLoading(false);
    if (data.data?.slides) setResult(data.data);
    else setError(data.error || "Could not generate.");
  };
  return (
    <div>
      <ToolHeader
        title="Deck Builder"
        desc="Generate structured presentation slide content that you can copy into your deck tool."
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={6}
        placeholder="Add any context: company details, pain points discussed, key stakeholders, industry..."
        className={notesArea}
      />
      {error && <div className="mt-3"><Notice text={error} /></div>}
      <div className="mt-3">
        <GenerateButton onClick={run} loading={loading} disabled={!notes.trim()} label="Generate Deck" />
      </div>
      {result && (
        <div className="mt-6 space-y-3">
          {result.slides.map((s, i) => (
            <div key={i} className="rounded-xl border border-ink-700 bg-ink-900 p-5">
              <div className="mb-2 flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-neon-500/15 font-mono text-xs font-bold text-neon-300">
                  {i + 1}
                </span>
                <h4 className="text-sm font-bold text-ink-100">{s.title}</h4>
              </div>
              <ul className="ml-10 list-disc space-y-1 text-sm text-ink-300">
                {s.bullets?.map((b, j) => <li key={j}>{b}</li>)}
              </ul>
              {s.notes && <p className="ml-10 mt-2 text-xs italic text-ink-500">Speaker note: {s.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls (mode pills + tone/persona) + main
// ---------------------------------------------------------------------------
function Controls({
  mode,
  setMode,
  tone,
  setTone,
  persona,
  setPersona,
}: {
  mode: string;
  setMode: (m: string) => void;
  tone: string;
  setTone: (v: string) => void;
  persona: string;
  setPersona: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-xs font-medium transition-all ${
                active
                  ? "border-neon-600/50 bg-neon-500/10 text-neon-300"
                  : "border-ink-700 bg-ink-900 text-ink-400 hover:border-ink-600 hover:text-ink-200"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.dot }} />
              {m.label}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-5">
        <Dropdown label="tone" value={tone} onChange={setTone} options={TONES} />
        <Dropdown label="selling to" value={persona} onChange={setPersona} options={PERSONAS} />
      </div>
    </div>
  );
}

function Dropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm font-medium text-ink-200 focus:border-neon-600/50 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SalesAssist() {
  const [mode, setMode] = useState("ask");
  const [tone, setTone] = useState("Direct");
  const [persona, setPersona] = useState(PERSONAS[0]);
  const ctx: Ctx = { tone, persona };

  return (
    <div className="space-y-6">
      <Controls mode={mode} setMode={setMode} tone={tone} setTone={setTone} persona={persona} setPersona={setPersona} />

      <div className="border-t border-ink-700 pt-6">
        {/* key=mode resets each tool's internal state when switching modes */}
        {CHAT_MODES.has(mode) ? (
          <ChatTool key="chat" ctx={ctx} />
        ) : mode === "lou" ? (
          <LouTool key="lou" ctx={ctx} />
        ) : mode === "threading" ? (
          <ThreadingTool key="threading" ctx={ctx} />
        ) : mode === "proposal" ? (
          <ProposalTool key="proposal" ctx={ctx} />
        ) : mode === "deck" ? (
          <DeckTool key="deck" ctx={ctx} />
        ) : (
          <MeddpiccTool key="meddpicc" ctx={ctx} />
        )}
      </div>
    </div>
  );
}
