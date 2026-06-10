"use client";

import {
  Users,
  GitBranch,
  GitMerge,
  TrendingUp,
  Cpu,
  ArrowRight,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import type { Signal, SignalTypeId } from "@/lib/types";
import { SIGNAL_TYPE_MAP, SEGMENT_MAP } from "@/lib/data";
import { timeAgo, fmtNum } from "@/lib/format";

const TYPE_ICON: Record<SignalTypeId, LucideIcon> = {
  hiring: Users,
  oss: GitBranch,
  ma: GitMerge,
  funding: TrendingUp,
  ai: Cpu,
};

function StrengthBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2" title="ICP fit estimate (0-99)">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-6 text-right font-mono text-xs font-semibold tabular-nums text-ink-300">
        {value}
      </span>
    </div>
  );
}

export function SignalCard({
  signal,
  onSelect,
}: {
  signal: Signal;
  onSelect: (company: string) => void;
}) {
  const type = SIGNAL_TYPE_MAP[signal.type];
  const Icon = TYPE_ICON[signal.type];
  const color = type.color;
  const segment = SEGMENT_MAP[signal.segment];

  return (
    <div className="animate-fade-in rounded-lg border border-ink-700 bg-ink-900 p-5 transition-colors hover:border-ink-600">
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
        <StrengthBar value={signal.strength} color={color} />
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
        {signal.tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="rounded border border-ink-700 bg-ink-950 px-1.5 py-0.5 text-[11px] text-ink-400"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-700 pt-3">
        <span className="min-w-0 truncate font-mono text-[11px] text-ink-500">
          {timeAgo(signal.date)} · {signal.source}
        </span>
        <div className="flex shrink-0 items-center gap-2">
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
            className="inline-flex items-center gap-1 rounded border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:border-neon-600/40 hover:bg-ink-800 hover:text-ink-50"
          >
            View Brief <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
