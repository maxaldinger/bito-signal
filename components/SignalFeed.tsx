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
  ChevronLeft,
  ChevronRight,
  DownloadCloud,
  Loader2,
} from "lucide-react";
import type { Signal, SignalTypeId, CompanyIntel as Intel } from "@/lib/types";
import { SIGNAL_TYPE_MAP, type RegionId } from "@/lib/data";
import { MetricCard } from "./MetricCard";
import { SignalCard } from "./SignalCard";
import { AccountPriority } from "./AccountPriority";
import { IntelExpander } from "./IntelExpander";

export function SignalFeed({
  signals,
  loading,
  pulling,
  cacheMode,
  region,
  page,
  totalPages,
  totalCached,
  pageSize,
  historyError,
  pendingBuckets,
  bucketErrors,
  metrics,
  updated,
  unfilteredCount,
  onClearFilters,
  onSelectCompany,
  onGetIntel,
  onRetry,
  onPullMore,
  onPage,
  expandedCompany,
  intel,
  intelLoading,
  intelError,
  onCloseIntel,
  onRefreshIntel,
}: {
  signals: Signal[];
  loading: boolean;
  pulling: boolean;
  cacheMode: boolean;
  region: RegionId;
  page: number;
  totalPages: number;
  totalCached: number;
  pageSize: number;
  historyError: string | null;
  pendingBuckets: SignalTypeId[];
  bucketErrors: Partial<Record<SignalTypeId, string>>;
  metrics: { total: number; accounts: number; avgFit: number; hot: number };
  updated: string;
  /** Rows on the current page BEFORE client-side filters. */
  unfilteredCount: number;
  onClearFilters: () => void;
  onSelectCompany: (c: string) => void;
  onGetIntel: (c: string) => void;
  onRetry: () => void;
  onPullMore: () => void;
  onPage: (p: number) => void;
  expandedCompany: string | null;
  intel: Intel | null;
  intelLoading: boolean;
  intelError: string | null;
  onCloseIntel: () => void;
  onRefreshIntel: (company: string) => void;
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

  // Toggle semantics: clicking the expanded company again closes its brief.
  const toggleCompany = (account: string) =>
    account === expandedCompany ? onCloseIntel() : onSelectCompany(account);

  // The expander renders beneath the FIRST card for the expanded company;
  // a searched company with no card on this page expands at the top.
  const expandAfterIdx = expandedCompany
    ? sorted.findIndex((s) => s.account === expandedCompany)
    : -1;
  const expanderEl = expandedCompany ? (
    <IntelExpander
      key={expandedCompany}
      company={expandedCompany}
      intel={intel}
      loading={intelLoading}
      error={intelError}
      onClose={onCloseIntel}
      onRetry={() => onGetIntel(expandedCompany)}
      onRefresh={() => onRefreshIntel(expandedCompany)}
    />
  ) : null;

  // Booting = nothing has landed yet; afterwards cards render progressively
  // while remaining buckets are still scanning.
  const booting = (loading || pulling) && signals.length === 0;
  const failedBuckets = Object.keys(bucketErrors) as SignalTypeId[];
  const allFailed = !loading && failedBuckets.length >= 5 && signals.length === 0;
  const bucketLabel = (b: SignalTypeId) => SIGNAL_TYPE_MAP[b]?.label ?? b;

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
      </div>

      {/* Metrics — all four describe exactly what's rendered on this page
          right now (after filters). The cache-wide total lives in the
          pagination bar below. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="signals on page" value={metrics.total} icon={Zap} color="text-neon-400" loading={loading} />
        <MetricCard label="accounts" value={metrics.accounts} icon={Building} color="text-sky-400" loading={loading} />
        <MetricCard label="avg icp fit" value={metrics.avgFit} icon={Gauge} color="text-violet-400" loading={loading} />
        <MetricCard label="hot (≥80)" value={metrics.hot} icon={Flame} color="text-amber-400" loading={loading} />
      </div>

      {/* Filters hiding rows — say so loudly instead of looking like a small pull */}
      {!loading && unfilteredCount > signals.length && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2.5">
          <p className="font-mono text-xs text-violet-300">
            ▸ {unfilteredCount - signals.length} of {unfilteredCount} signals on this
            page hidden by your filters
          </p>
          <button
            onClick={onClearFilters}
            className="shrink-0 rounded border border-violet-500/40 px-2.5 py-1 font-mono text-[11px] font-medium text-violet-300 transition-colors hover:bg-violet-500/15"
          >
            clear filters
          </button>
        </div>
      )}

      {/* Error banner — be honest when scans fail (all or some) */}
      {failedBuckets.length > 0 && !booting && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-300">
              {allFailed
                ? "Live signal pass failed"
                : `${failedBuckets.length} of 5 signal scans failed`}
            </p>
            <p className="mt-0.5 break-words text-xs leading-relaxed text-amber-200/80">
              {failedBuckets.map((b) => `${bucketLabel(b)}: ${bucketErrors[b]}`).join(" · ")}
            </p>
          </div>
          <button
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/15"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {/* History read error */}
      {historyError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="min-w-0 flex-1 break-words text-xs leading-relaxed text-red-300">
            Cache read failed: {historyError}
          </p>
        </div>
      )}

      {/* Searched company with no card on this page — brief expands here */}
      {expandedCompany && expandAfterIdx === -1 && expanderEl}

      {/* Account prioritization */}
      {signals.length > 0 && <AccountPriority signals={signals} onSelect={toggleCompany} />}

      {/* Feed header — pagination + pull controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900 px-4 py-3">
        <div className="min-w-0">
          {cacheMode ? (
            <>
              <p className="font-mono text-[12px] text-ink-400">
                <span className="font-semibold text-ink-100">{totalCached}</span> cached{" "}
                <span className="rounded bg-ink-800 px-1 py-0.5 text-[10px] font-bold uppercase text-ink-300">
                  {region}
                </span>{" "}
                signals · <span className="text-ink-300">{pageSize} results per page</span> ·
                page <span className="font-semibold text-ink-100">{page}</span>/{totalPages}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-ink-600">
                updated {updated} · pull more to scan for new signals · prev/next to revisit
                earlier results
              </p>
            </>
          ) : (
            <p className="font-mono text-[12px] text-ink-400">
              <span className="font-semibold text-ink-100">{signals.length}</span> signals
              <span className="text-ink-600"> · updated {updated} · live scan (no cache configured)</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {cacheMode && (
            <>
              <button
                onClick={() => onPage(page - 1)}
                disabled={page <= 1 || pulling}
                title="Previous page"
                className="inline-flex items-center gap-1 rounded border border-ink-700 px-2.5 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <button
                onClick={() => onPage(page + 1)}
                disabled={page >= totalPages || pulling}
                title="Next page"
                className="inline-flex items-center gap-1 rounded border border-ink-700 px-2.5 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onPullMore}
                disabled={pulling}
                title="Run a fresh live scan and add new results to the cache"
                className="inline-flex items-center gap-1.5 rounded border border-neon-600/50 bg-neon-500/15 px-3 py-1.5 text-xs font-semibold text-neon-300 transition-colors hover:bg-neon-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pulling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="h-3.5 w-3.5" />
                )}
                {pulling ? "Pulling…" : "Pull More Signals"}
              </button>
            </>
          )}
          <button
            onClick={() => setSort(nextSort)}
            className="inline-flex items-center gap-1.5 rounded border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:bg-ink-800"
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
            {sortLabel}
          </button>
        </div>
      </div>

      {/* Feed */}
      {booting ? (
        <div className="space-y-4">
          <p className="font-mono text-xs text-neon-400">
            ▸ running 6 parallel scans: hiring, OSS, M&A, funding, AI tooling + Apollo ICP sweep…
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
      ) : cacheMode && totalCached === 0 && failedBuckets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/50 p-12 text-center">
          <p className="text-sm text-ink-300">The signal cache is empty.</p>
          <p className="mt-1 text-xs text-ink-500">
            Run your first pull — six parallel scans (web + Apollo), about a minute.
          </p>
          <button
            onClick={onPullMore}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-neon-600/50 bg-neon-500/15 px-5 py-2.5 text-sm font-semibold text-neon-300 shadow-glow-sm transition-all hover:bg-neon-500/25"
          >
            <DownloadCloud className="h-4 w-4" /> Pull Signals
          </button>
        </div>
      ) : sorted.length === 0 && failedBuckets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/50 p-12 text-center">
          <p className="text-sm text-ink-400">
            No signals on this page match the current filters. Clear a filter above, or
            check the next page.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingBuckets.length > 0 && (
            <p className="animate-pulse-dot font-mono text-xs text-neon-400">
              ▸ still scanning: {pendingBuckets.map(bucketLabel).join(", ")}…
            </p>
          )}
          {sorted.map((s, i) => (
            <div key={s.id}>
              <SignalCard
                signal={s}
                onSelect={toggleCompany}
                expanded={s.account === expandedCompany}
              />
              {i === expandAfterIdx && expanderEl}
            </div>
          ))}
        </div>
      )}

      {/* Honest data-source note */}
      <div className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-900/50 p-3 text-xs text-ink-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" />
        <span>
          Signals are generated live by{" "}
          <span className="font-mono text-ink-400">claude-sonnet-4</span> +{" "}
          <span className="font-mono text-ink-400">web_search</span> and the Apollo ICP
          sweep{cacheMode ? ", then cached in Supabase — each pull adds new results and refreshes repeat sightings" : ""}.
          Strength is an ICP-fit estimate, and sources are linked on each card. Verify
          before outreach.
        </span>
      </div>
    </div>
  );
}
