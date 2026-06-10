"use client";

import { Radio, Sparkles, type LucideIcon } from "lucide-react";
import { SEGMENTS, SIGNAL_TYPES } from "@/lib/data";
import type { SegmentId, SignalTypeId } from "@/lib/types";
import { SegmentIcon } from "./SegmentIcon";

export type TabId = "feed" | "assist";

const NAV: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "feed", label: "Signal Feed", icon: Radio },
  { id: "assist", label: "Sales Assist", icon: Sparkles },
];

export function Sidebar({
  activeTab,
  onTab,
  segmentCounts,
  activeSegment,
  onSegment,
  signalCounts,
  activeSignalType,
  onSignalType,
  minStrength,
  onMinStrength,
}: {
  activeTab: TabId;
  onTab: (t: TabId) => void;
  segmentCounts: Record<SegmentId, number>;
  activeSegment: SegmentId | null;
  onSegment: (s: SegmentId | null) => void;
  signalCounts: Record<SignalTypeId, number>;
  activeSignalType: SignalTypeId | null;
  onSignalType: (s: SignalTypeId | null) => void;
  minStrength: number;
  onMinStrength: (v: number) => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-ink-700 bg-ink-950 lg:flex">
      <div className="sticky top-[64px] flex h-[calc(100vh-64px)] flex-col overflow-y-auto p-4">
        {/* Primary nav */}
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTab(item.id)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  active
                    ? "border border-neon-600/30 bg-neon-500/10 text-neon-300"
                    : "border border-transparent text-ink-300 hover:bg-ink-800 hover:text-ink-50"
                }`}
              >
                <item.icon className="h-[17px] w-[17px]" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="my-4 border-t border-ink-700" />

        {/* Segments */}
        <h3 className="mb-3 px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
          segments
        </h3>
        <div className="flex flex-col gap-0.5">
          {SEGMENTS.map((seg) => {
            const active = activeSegment === seg.id;
            return (
              <button
                key={seg.id}
                onClick={() => onSegment(active ? null : seg.id)}
                title={seg.blurb}
                className={`group flex items-center justify-between rounded-lg px-2 py-2 transition-colors ${
                  active ? "bg-ink-800" : "hover:bg-ink-800/60"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <SegmentIcon
                    name={seg.icon}
                    className={`h-4 w-4 ${
                      active ? "text-neon-400" : "text-ink-400 group-hover:text-ink-300"
                    }`}
                  />
                  <span
                    className={`text-left text-sm ${active ? "text-ink-50" : "text-ink-300"}`}
                  >
                    {seg.label}
                  </span>
                </span>
                <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink-400 group-hover:bg-ink-900">
                  {segmentCounts[seg.id] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        <div className="my-4 border-t border-ink-700" />

        {/* Signal types */}
        <h3 className="mb-3 px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
          signal types
        </h3>
        <div className="flex flex-col gap-0.5">
          {SIGNAL_TYPES.map((st) => {
            const active = activeSignalType === st.id;
            return (
              <button
                key={st.id}
                onClick={() => onSignalType(active ? null : st.id)}
                title={st.description}
                className={`group flex items-center justify-between rounded-lg px-2 py-2 transition-colors ${
                  active ? "bg-ink-800" : "hover:bg-ink-800/60"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: st.color }}
                  />
                  <span className={`text-sm ${active ? "text-ink-50" : "text-ink-300"}`}>
                    {st.label}
                  </span>
                </span>
                <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink-400 group-hover:bg-ink-900">
                  {signalCounts[st.id] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        <div className="my-4 border-t border-ink-700" />

        {/* Min ICP fit */}
        <h3 className="mb-3 px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
          min icp fit: <span className="text-neon-400">{minStrength}</span>
        </h3>
        <input
          type="range"
          min={0}
          max={100}
          value={minStrength}
          onChange={(e) => onMinStrength(Number(e.target.value))}
          className="w-full"
        />
        <div className="mt-1.5 flex justify-between px-0.5 font-mono text-[10px] text-ink-500">
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>

        <p className="mt-auto pt-6 text-center font-mono text-[10px] text-ink-500">
          built for bito.ai
        </p>
      </div>
    </aside>
  );
}
