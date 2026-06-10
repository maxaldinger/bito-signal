"use client";

import { useRef, useState } from "react";
import {
  Send,
  Loader2,
  RotateCcw,
  ArrowUpRight,
} from "lucide-react";
import type { LiveCitation } from "@/lib/types";

const MODES: { id: string; label: string; dot: string }[] = [
  { id: "ask", label: "Ask Anything", dot: "#9aa3b2" },
  { id: "email", label: "Cold Email", dot: "#34d399" },
  { id: "objections", label: "Objections", dot: "#f87171" },
  { id: "research", label: "Live Research", dot: "#38bdf8" },
];

const TONES = ["Direct", "Consultative", "Concise", "Technical"];
const PERSONAS = [
  "VP Engineering",
  "CTO",
  "Head of Platform / DevEx",
  "Staff Engineer",
  "Security Lead",
];

type Msg = {
  role: "user" | "assistant" | "notice";
  content: string;
  citations?: LiveCitation[];
};

const QUICK = [
  {
    label: "Draft a cold email",
    mode: "email",
    prompt:
      "Draft a cold email to a VP of Engineering at a 200-engineer fintech that just raised a Series C and is hiring platform engineers. Angle: review bottleneck at scale.",
  },
  {
    label: '"We already have Copilot"',
    mode: "objections",
    prompt:
      'Prospect says: "We already pay for GitHub Copilot — why would we add Bito?" Handle it.',
  },
  {
    label: "Research an account",
    mode: "research",
    prompt: "",
  },
];

export function SalesAssist() {
  const [mode, setMode] = useState("ask");
  const [tone, setTone] = useState("Direct");
  const [persona, setPersona] = useState(PERSONAS[0]);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Bumped on clear so a late in-flight response can't append an orphan
  // assistant message into a fresh conversation.
  const generation = useRef(0);

  const send = async (text: string, modeOverride?: string) => {
    const content = text.trim();
    if (!content || loading) return;
    const gen = generation.current;
    const history = messages.filter((m) => m.role !== "notice");
    setMessages([...messages, { role: "user", content }]);
    setInput("");
    setLoading(true);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    let data: {
      text?: string;
      citations?: LiveCitation[];
      truncated?: boolean;
      error?: string;
    };
    try {
      const res = await fetch("/api/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: modeOverride ?? mode,
          tone,
          persona,
          messages: [...history, { role: "user", content }].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      try {
        data = await res.json();
      } catch {
        data = { error: `HTTP ${res.status} — ${res.statusText || "non-JSON response"}` };
      }
    } catch {
      data = { error: "Network error — try again." };
    }

    if (gen !== generation.current) return; // conversation was cleared mid-flight

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
    setMode(q.mode);
    if (q.prompt) send(q.prompt, q.mode);
    else inputRef.current?.focus();
  };

  return (
    <div className="space-y-6">
      {/* Mode pills + context */}
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

      <div className="border-t border-ink-700 pt-6">
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
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-neon-600/40 bg-neon-500/10 px-4 py-2.5 text-sm leading-relaxed text-neon-100">
                    {m.content}
                  </div>
                </div>
              ) : m.role === "notice" ? (
                <div
                  key={i}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-300"
                >
                  {m.content}
                </div>
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
                {mode === "research"
                  ? "▸ searching the live web…"
                  : "▸ thinking…"}
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
              placeholder={
                mode === "research"
                  ? "Company, person, or market to research… (Shift+Enter for newline)"
                  : "What do you need? (Shift+Enter for newline)"
              }
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
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
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
