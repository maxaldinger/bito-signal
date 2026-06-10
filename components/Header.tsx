"use client";

import { Search, RefreshCw, Activity } from "lucide-react";

export function Header({
  search,
  onSearch,
  onRefresh,
  refreshing,
  lastUpdated,
}: {
  search: string;
  onSearch: (v: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  lastUpdated: string;
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-700 bg-ink-950/85 backdrop-blur-xl">
      <div className="flex h-[64px] items-center gap-4 px-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon-600/50 bg-ink-900 shadow-glow-sm">
            <Activity className="h-5 w-5 text-neon-400" />
          </div>
          <div className="leading-tight">
            <h1 className="cursor font-mono text-[16px] font-bold tracking-tight text-ink-50">
              bito<span className="text-neon-400">signal</span>
            </h1>
            <p className="font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-ink-400">
              swe-heavy account intelligence
            </p>
          </div>
        </div>

        {/* Center search */}
        <div className="mx-auto hidden w-full max-w-xl items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2 md:flex">
          <Search className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Filter the feed…"
            className="w-full bg-transparent font-mono text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
        </div>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <div className="hidden items-center gap-1.5 font-mono text-[11px] text-ink-400 sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-neon-400" />
            live · {lastUpdated}
          </div>
          <button
            onClick={onRefresh}
            aria-label="Refresh signals"
            className="rounded-lg border border-ink-700 p-2 text-ink-400 transition-colors hover:border-neon-600/40 hover:text-neon-300"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    </header>
  );
}
