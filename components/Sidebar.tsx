"use client";

import { Radio, Sparkles, Check, type LucideIcon } from "lucide-react";
import { SEGMENTS, SIGNAL_TYPES, SWE_BANDS, type SweBandId } from "@/lib/data";
import type { SegmentId, SignalTypeId } from "@/lib/types";
import { SegmentIcon } from "./SegmentIcon";

export type TabId = "feed" | "assist";

const NAV: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "feed", label: "Signal Feed", icon: Radio },
  { id: "assist", label: "Sales Assist", icon: Sparkles },
];

// Section heading with "all" / "clear" affordances.
function FilterHeading({
  label,
  activeCount,
  optionCount,
  onSelectAll,
  onClear,
}: {
  label: string;
  activeCount: number;
  optionCount: number;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mb-3 flex items-center justify-between px-1">
      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
        {label}
        {activeCount > 0 && (
          <span className="ml-1.5 rounded bg-neon-500/15 px-1 py-0.5 text-neon-300">
            {activeCount}
          </span>
        )}
      </h3>
      <span className="flex items-center gap-2">
        {activeCount < optionCount && (
          <button
            onClick={onSelectAll}
            className="font-mono text-[10px] uppercase tracking-wider text-ink-500 transition-colors hover:text-neon-300"
          >
            all
          </button>
        )}
        {activeCount > 0 && (
          <button
            onClick={onClear}
            className="font-mono text-[10px] uppercase tracking-wider text-ink-500 transition-colors hover:text-neon-300"
          >
            clear
          </button>
        )}
      </span>
    </div>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
        checked
          ? "border-neon-500 bg-neon-500/20 text-neon-300"
          : "border-ink-600 bg-transparent text-transparent"
      }`}
    >
      <Check className="h-2.5 w-2.5" strokeWidth={3} />
    </span>
  );
}

export function Sidebar({
  activeTab,
  onTab,
  segmentCounts,
  selectedSegments,
  onToggleSegment,
  onSetSegments,
  sweBandCounts,
  unknownSweCount,
  selectedSweBands,
  onToggleSweBand,
  onSetSweBands,
  signalCounts,
  selectedSignalTypes,
  onToggleSignalType,
  onSetSignalTypes,
  minStrength,
  onMinStrength,
}: {
  activeTab: TabId;
  onTab: (t: TabId) => void;
  segmentCounts: Record<SegmentId, number>;
  selectedSegments: SegmentId[];
  onToggleSegment: (s: SegmentId) => void;
  onSetSegments: (s: SegmentId[]) => void;
  sweBandCounts: Record<SweBandId, number>;
  unknownSweCount: number;
  selectedSweBands: SweBandId[];
  onToggleSweBand: (b: SweBandId) => void;
  onSetSweBands: (b: SweBandId[]) => void;
  signalCounts: Record<SignalTypeId, number>;
  selectedSignalTypes: SignalTypeId[];
  onToggleSignalType: (s: SignalTypeId) => void;
  onSetSignalTypes: (s: SignalTypeId[]) => void;
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

        <p className="mt-3 px-1 font-mono text-[10px] leading-relaxed text-ink-500">
          filters stack — pick as many as you need
        </p>

        <div className="my-3 border-t border-ink-700" />

        {/* Segments — multi-select */}
        <FilterHeading
          label="segments"
          activeCount={selectedSegments.length}
          optionCount={SEGMENTS.length}
          onSelectAll={() => onSetSegments(SEGMENTS.map((s) => s.id))}
          onClear={() => onSetSegments([])}
        />
        <div className="flex flex-col gap-0.5">
          {SEGMENTS.map((seg) => {
            const checked = selectedSegments.includes(seg.id);
            return (
              <button
                key={seg.id}
                onClick={() => onToggleSegment(seg.id)}
                title={seg.blurb}
                className={`group flex items-center justify-between rounded-lg px-2 py-2 transition-colors ${
                  checked ? "bg-ink-800" : "hover:bg-ink-800/60"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <CheckBox checked={checked} />
                  <SegmentIcon
                    name={seg.icon}
                    className={`h-4 w-4 ${
                      checked ? "text-neon-400" : "text-ink-400 group-hover:text-ink-300"
                    }`}
                  />
                  <span
                    className={`text-left text-sm ${checked ? "text-ink-50" : "text-ink-300"}`}
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

        {/* Engineering team size — multi-select */}
        <FilterHeading
          label="eng team size"
          activeCount={selectedSweBands.length}
          optionCount={SWE_BANDS.length}
          onSelectAll={() => onSetSweBands(SWE_BANDS.map((b) => b.id))}
          onClear={() => onSetSweBands([])}
        />
        <div className="flex flex-col gap-0.5">
          {SWE_BANDS.map((band) => {
            const checked = selectedSweBands.includes(band.id);
            return (
              <button
                key={band.id}
                onClick={() => onToggleSweBand(band.id)}
                className={`group flex items-center justify-between rounded-lg px-2 py-2 transition-colors ${
                  checked ? "bg-ink-800" : "hover:bg-ink-800/60"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <CheckBox checked={checked} />
                  <span
                    className={`font-mono text-sm tabular-nums ${
                      checked ? "text-ink-50" : "text-ink-300"
                    }`}
                  >
                    {band.label} SWEs
                  </span>
                </span>
                <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink-400 group-hover:bg-ink-900">
                  {sweBandCounts[band.id] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
        {selectedSweBands.length > 0 && unknownSweCount > 0 && (
          <p className="mt-2 px-1 font-mono text-[10px] leading-relaxed text-ink-500">
            {unknownSweCount} signal{unknownSweCount === 1 ? "" : "s"} without a
            size estimate hidden
          </p>
        )}

        <div className="my-4 border-t border-ink-700" />

        {/* Signal types — multi-select */}
        <FilterHeading
          label="signal types"
          activeCount={selectedSignalTypes.length}
          optionCount={SIGNAL_TYPES.length}
          onSelectAll={() => onSetSignalTypes(SIGNAL_TYPES.map((t) => t.id))}
          onClear={() => onSetSignalTypes([])}
        />
        <div className="flex flex-col gap-0.5">
          {SIGNAL_TYPES.map((st) => {
            const checked = selectedSignalTypes.includes(st.id);
            return (
              <button
                key={st.id}
                onClick={() => onToggleSignalType(st.id)}
                title={st.description}
                className={`group flex items-center justify-between rounded-lg px-2 py-2 transition-colors ${
                  checked ? "bg-ink-800" : "hover:bg-ink-800/60"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <CheckBox checked={checked} />
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: st.color }}
                  />
                  <span className={`text-left text-sm ${checked ? "text-ink-50" : "text-ink-300"}`}>
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
