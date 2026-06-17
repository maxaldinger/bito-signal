"use client";

import {
  Users,
  GitBranch,
  GitMerge,
  TrendingUp,
  Cpu,
  Crosshair,
  ArrowRight,
  ChevronUp,
  ExternalLink,
  Check,
  Minimize2,
  Maximize2,
  type LucideIcon,
} from "lucide-react";
import type { Signal, SignalTypeId } from "@/lib/types";
import { SIGNAL_TYPE_MAP, SEGMENT_MAP } from "@/lib/data";
import { timeAgo, fmtNum, fmtDate } from "@/lib/format";
import {
  useDeepDiveScore,
  useIsProspected,
  useProspectedAt,
  useIsLowPriority,
  toggleLowPriority,
} from "@/lib/clientStore";
import { HubSpotActions } from "./HubSpotActions";

const TYPE_ICON: Record<SignalTypeId, LucideIcon> = {
  hiring: Users,
  oss: GitBranch,
  ma: GitMerge,
  funding: TrendingUp,
  ai: Cpu,
  icp: Crosshair,
};

function StrengthBar({
  value,
  color,
  fromBrief,
}: {
  value: number;
  color: string;
  /** True when the value is the authoritative score from a generated brief. */
  fromBrief: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2"
      title={
        fromBrief
          ? "Bito ICP fit from the generated brief (0-99)"
          : "Preliminary ICP estimate — open the brief for the scored breakdown (0-99)"
      }
    >
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
      <span className="flex w-9 items-center justify-end gap-0.5 text-right font-mono text-xs font-semibold tabular-nums text-ink-300">
        {value}
        {!fromBrief && <span className="text-[9px] font-normal text-ink-500">~</span>}
      </span>
    </div>
  );
}

export function SignalCard({
  signal,
  onSelect,
  expanded = false,
}: {
  signal: Signal;
  onSelect: (company: string) => void;
  /** Whether this card's inline brief is currently expanded beneath it. */
  expanded?: boolean;
}) {
  const type = SIGNAL_TYPE_MAP[signal.type];
  const Icon = TYPE_ICON[signal.type];
  const color = type.color;
  const segment = SEGMENT_MAP[signal.segment];

  // Once a brief has been generated for this company, its real ICP total is the
  // score we show — not the rougher per-signal estimate.
  const briefScore = useDeepDiveScore(signal.account);
  const score = briefScore ?? signal.strength;
  const prospected = useIsProspected("company", signal.account);
  const prospectedAt = useProspectedAt("company", signal.account);
  const lowPriority = useIsLowPriority(signal.account);

  // Minimized (low-priority) cards collapse to a slim row — name + score + a
  // restore button — so they stay on the page without dominating it.
  if (lowPriority) {
    return (
      <div className="animate-fade-in flex items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-500">
            low priority
          </span>
          <button
            onClick={() => onSelect(signal.account)}
            className="min-w-0 truncate font-mono text-sm text-ink-300 transition-colors hover:text-neon-300"
            title="Open brief"
          >
            {signal.account}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-xs tabular-nums text-ink-500">{score}</span>
          <button
            onClick={() => toggleLowPriority(signal.account)}
            title="Restore card"
            className="inline-flex items-center gap-1 rounded border border-ink-700 px-2 py-1 font-mono text-[11px] text-ink-400 transition-colors hover:border-neon-600/40 hover:text-neon-200"
          >
            <Maximize2 className="h-3 w-3" /> Restore
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`animate-fade-in rounded-lg border bg-ink-900 p-5 transition-colors ${
        prospected
          ? "border-orange-500/60 ring-1 ring-orange-500/40"
          : expanded
            ? "border-neon-600/40"
            : "border-ink-700 hover:border-ink-600"
      }`}
    >
      {prospected && (
        <div
          title="Already prospected — a HubSpot task exists for this company or one of its contacts"
          className="mb-3 flex items-center gap-2 rounded-md border border-orange-500/40 bg-orange-500/15 px-3 py-2"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neon-500 text-ink-950">
            <Check className="h-4 w-4" strokeWidth={3.5} />
          </span>
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-orange-200">
            Prospected · sent to HubSpot{prospectedAt ? ` · ${fmtDate(prospectedAt)}` : ""}
          </span>
        </div>
      )}

      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] font-medium"
            style={{ backgroundColor: `${color}1c`, color }}
          >
            <Icon className="h-3.5 w-3.5" />
            {type.label}
          </span>
          <span className="rounded border border-ink-700 bg-ink-950 px-2 py-1 text-[11px] text-ink-400">
            {segment.label}
          </span>
        </div>
        <StrengthBar value={score} color={color} fromBrief={briefScore !== undefined} />
      </div>

      <button
        onClick={() => onSelect(signal.account)}
        className="mb-2 inline-block max-w-full truncate rounded border border-neon-600/30 bg-neon-500/10 px-2.5 py-1 font-mono text-sm font-semibold text-neon-300 transition-colors hover:bg-neon-500/20"
      >
        {signal.account}
      </button>

      <h3 className="mb-1.5 text-[15px] font-semibold leading-snug text-ink-50">
        {signal.title}
      </h3>
      <p className="text-sm leading-relaxed text-ink-300">{signal.description}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {signal.sweEstimate ? (
          <span className="rounded border border-ink-700 bg-ink-950 px-1.5 py-0.5 font-mono text-[11px] text-neon-300">
            ~{fmtNum(signal.sweEstimate)} SWEs
          </span>
        ) : null}
        {signal.codebaseHint ? (
          <span className="rounded border border-ink-700 bg-ink-950 px-1.5 py-0.5 font-mono text-[11px] text-ink-300">
            {signal.codebaseHint}
          </span>
        ) : null}
        {signal.tags.map((tag, i) =>
          /kubernetes/i.test(tag) ? (
            <span
              key={`${tag}-${i}`}
              title="K8s shops typically run 10+ services across multiple repos — strong Bito fit."
              className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-sky-400"
            >
              ⎈ {tag}
            </span>
          ) : (
            <span
              key={`${tag}-${i}`}
              className="rounded border border-ink-700 bg-ink-950 px-1.5 py-0.5 text-[11px] text-ink-400"
            >
              {tag}
            </span>
          ),
        )}
      </div>

      {/* HubSpot — check the account / create a quick task without opening the
          brief. Manual check only (no autoCheck) so a full feed doesn't fire
          dozens of HubSpot searches at once and trip the ~4 req/s limit. */}
      <div className="mt-4 border-t border-ink-700 pt-3">
        <HubSpotActions
          kind="company"
          name={signal.account}
          compact
          defaultSubject={`Prospect ${signal.account} — Bito Signal (fit ${score})`}
          defaultBody={
            `${signal.account} — ${segment.label}` +
            `${signal.sweEstimate ? `, ~${fmtNum(signal.sweEstimate)} SWEs` : ""}.\n` +
            `SIGNAL: ${signal.title}\n${signal.description}\n` +
            `${signal.url ? `SOURCE: ${signal.source} — ${signal.url}\n` : ""}`
          }
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-700 pt-3">
        <span className="min-w-0 truncate font-mono text-[11px] text-ink-500">
          {timeAgo(signal.date)} · {signal.source}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => toggleLowPriority(signal.account)}
            title="Minimize — mark low priority"
            className="inline-flex items-center gap-1 rounded border border-ink-700 px-2.5 py-1.5 text-xs font-medium text-ink-400 transition-colors hover:border-ink-600 hover:text-ink-200"
          >
            <Minimize2 className="h-3 w-3" /> Minimize
          </button>
          {signal.url && (
            <a
              href={signal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-ink-700 px-2.5 py-1.5 text-xs font-medium text-ink-400 transition-colors hover:text-ink-200"
              title="View source"
            >
              Source <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            onClick={() => onSelect(signal.account)}
            className={`inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
              expanded
                ? "border-neon-600/40 bg-neon-500/10 text-neon-300 hover:bg-neon-500/20"
                : "border-ink-700 text-ink-300 hover:border-neon-600/40 hover:bg-ink-800 hover:text-ink-50"
            }`}
          >
            {expanded ? (
              <>
                Close Brief <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                View Brief <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
