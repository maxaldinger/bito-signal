"use client";

import { useState } from "react";
import {
  Search,
  Sparkles,
  Zap,
  Building,
  Gauge,
  Flame,
  ArrowDownUp,
  Info,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import type { Signal } from "@/lib/types";
import { EXAMPLE_COMPANIES } from "@/lib/data";
import { MetricCard } from "./MetricCard";
import { SignalCard } from "./SignalCard";
import { AccountPriority } from "./AccountPriority";

export function SignalFeed({
  signals,
  loading,
  error,
  metrics,
  updated,
  onSelectCompany,
  onGetIntel,
  onRetry,
}: {
  signals: Signal[];
  loading: boolean;
  error: string | null;
  metrics: { total: number; accounts: number; avgFit: number; hot: number };
  updated: string;
  onSelectCompany: (c: string) => void;
  onGetIntel: (c: string) => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"feed" | "fit" | "recent">("feed");

  const sorted =
    sort === "feed"
      ? signals
      : [...signals].sort((a, b) =>
          sort === "fit"
            ? b.strength - a.strength
            : new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
  const sortLabel =
    sort === "feed" ? "Mixed Feed" : sort === "fit" ? "By ICP Fit" : "Most Recent";
  const nextSort = sort === "feed" ? "fit" : sort === "fit" ? "recent" : "feed";

  const submit = (c: string) => c.trim() && onGetIntel(c.trim());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink-50">Signal Feed</h2>
        <p className="mt-1 text-sm text-ink-300">
          Live buying signals across SWE-heavy companies — hiring, OSS, M&A, funding,
          AI-tooling spend. Generated fresh by claude-sonnet-4 + web search.
        </p>
      </div>

      {/* Search card */}
      <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-ink-700 bg-ink-950 px-3.5 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-ink-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(query)}
              placeholder="Run a live intel brief on any company…"
              className="w-full bg-transparent font-mono text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => submit(query)}
            disabled={!query.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-neon-600/50 bg-neon-500/15 px-5 py-2.5 text-sm font-semibold text-neon-300 shadow-glow-sm transition-all hover:bg-neon-500/25 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Sparkles className="h-4 w-4" />
            Get Intel
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-ink-500">try:</span>
          {EXAMPLE_COMPANIES.map((c) => (
            <button
              key={c}
              onClick={() => onGetIntel(c)}
              className="rounded border border-ink-700 bg-ink-950 px-2.5 py-1 font-mono text-xs text-ink-400 transition-colors hover:border-neon-600/40 hover:text-neon-300"
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="live signals" value={metrics.total} icon={Zap} color="text-neon-400" loading={loading} />
        <MetricCard label="accounts" value={metrics.accounts} icon={Building} color="text-sky-400" loading={loading} />
        <MetricCard label="avg icp fit" value={metrics.avgFit} icon={Gauge} color="text-violet-400" loading={loading} />
        <MetricCard label="hot (≥80)" value={metrics.hot} icon={Flame} color="text-amber-400" loading={loading} />
      </div>

      {/* Error banner — be honest when the live pass fails */}
      {error && !loading && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-300">Live signal pass failed</p>
            <p className="mt-0.5 break-words text-xs leading-relaxed text-amber-200/80">{error}</p>
          </div>
          <button
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/15"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {/* Account prioritization */}
      {!loading && <AccountPriority signals={signals} onSelect={onSelectCompany} />}

      {/* Feed header */}
      <div className="flex items-center justify-between">
        <p className="font-mono text-[12px] text-ink-400">
          <span className="font-semibold text-ink-100">{signals.length}</span> signals
          {updated ? <span className="text-ink-600"> · updated {updated}</span> : null}
        </p>
        <button
          onClick={() => setSort(nextSort)}
          className="inline-flex items-center gap-1.5 rounded border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:bg-ink-800"
        >
          <ArrowDownUp className="h-3.5 w-3.5" />
          {sortLabel}
        </button>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="space-y-4">
          <p className="font-mono text-xs text-neon-400">
            ▸ searching hiring posts, OSS activity, M&A wires, funding news…
          </p>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-ink-700 bg-ink-900 p-5">
              <div className="mb-3 flex gap-2">
                <div className="skeleton h-6 w-24 rounded" />
                <div className="skeleton h-6 w-20 rounded" />
              </div>
              <div className="skeleton mb-2 h-7 w-40 rounded" />
              <div className="skeleton mb-2 h-4 w-3/4 rounded" />
              <div className="skeleton h-4 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 && !error ? (
        <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/50 p-12 text-center">
          <p className="text-sm text-ink-400">
            No live signals match the current filters. Clear a segment / signal-type
            filter or lower the minimum ICP fit.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map((s) => (
            <SignalCard key={s.id} signal={s} onSelect={onSelectCompany} />
          ))}
        </div>
      )}

      {/* Honest data-source note */}
      <div className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-900/50 p-3 text-xs text-ink-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" />
        <span>
          Every signal is generated live by{" "}
          <span className="font-mono text-ink-400">claude-sonnet-4</span> with the
          Anthropic <span className="font-mono text-ink-400">web_search</span> tool at
          refresh time — no static data. Strength is an ICP-fit estimate, and sources
          are linked on each card. Verify before outreach.
        </span>
      </div>
    </div>
  );
}
