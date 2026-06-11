"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Header } from "@/components/Header";
import { Sidebar, type TabId } from "@/components/Sidebar";
import { SignalFeed } from "@/components/SignalFeed";
import { SalesAssist } from "@/components/SalesAssist";
import { CompanyIntel } from "@/components/CompanyIntel";
import {
  SEGMENTS,
  SIGNAL_TYPES,
  SWE_BANDS,
  sweBandOf,
  type SweBandId,
} from "@/lib/data";
import type {
  Signal,
  SegmentId,
  SignalTypeId,
  CompanyIntel as Intel,
} from "@/lib/types";

// Read a response body honestly: non-JSON error bodies (gateway timeouts etc.)
// become "HTTP <status>" instead of a cryptic JSON-parse exception.
async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return await res.json();
  } catch {
    return { error: `HTTP ${res.status} — ${res.statusText || "non-JSON response"}` };
  }
}

const BUCKETS: SignalTypeId[] = ["hiring", "oss", "ma", "funding", "ai", "icp"];
const PAGE_SIZE = 50;

const toggleIn = <T,>(arr: T[], v: T): T[] =>
  arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

export default function Page() {
  const [tab, setTab] = useState<TabId>("feed");

  // Feed state. Two modes:
  //  - cache mode (Supabase configured): the feed shows a 50-per-page window
  //    over accumulated history; "Pull more" runs live scans that upsert.
  //  - ephemeral mode (no Supabase): live scans append progressively, nothing
  //    persists between loads.
  const [signals, setSignals] = useState<Signal[]>([]);
  const [cacheMode, setCacheMode] = useState<boolean>(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [bucketErrors, setBucketErrors] = useState<Partial<Record<SignalTypeId, string>>>({});
  const [pendingBuckets, setPendingBuckets] = useState<SignalTypeId[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Guards against superseded requests mutating newer state.
  const feedReqId = useRef(0);
  const autoPulled = useRef(false);

  // Anchored to the last SUCCESSFUL data load — a failed refresh must not
  // claim "just now". `now` ticks to re-derive the label.
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [selected, setSelected] = useState<string | null>(null);
  const [intel, setIntel] = useState<Intel | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const intelReqId = useRef(0);

  // Multi-select filters — empty selection means "all".
  const [segments, setSegments] = useState<SegmentId[]>([]);
  const [types, setTypes] = useState<SignalTypeId[]>([]);
  const [bands, setBands] = useState<SweBandId[]>([]);
  const [minStrength, setMinStrength] = useState(0);
  const [search, setSearch] = useState("");

  // ---- Live bucket scans (shared by both modes) -------------------------
  const scanBuckets = useCallback(
    async (opts: { force: boolean; appendLive: boolean; reqId: number }) => {
      setBucketErrors({});
      setPendingBuckets([...BUCKETS]);
      await Promise.allSettled(
        BUCKETS.map(async (bucket) => {
          try {
            const url =
              `/api/signals?type=${bucket}` +
              (opts.force ? `&fresh=${Date.now()}` : "");
            const res = await fetch(url, opts.force ? { cache: "no-store" } : {});
            const data = await readJson(res);
            if (opts.reqId !== feedReqId.current) return;
            if (!res.ok) {
              setBucketErrors((prev) => ({
                ...prev,
                [bucket]:
                  typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
              }));
            } else if (data.skipped) {
              // Bucket not configured (e.g. ICP sweep without APOLLO_API_KEY).
            } else if (opts.appendLive) {
              const fresh = Array.isArray(data.signals)
                ? (data.signals as Signal[])
                : [];
              setSignals((prev) => [...prev, ...fresh]);
              setLastFetchAt(Date.now());
            }
          } catch (e) {
            if (opts.reqId !== feedReqId.current) return;
            setBucketErrors((prev) => ({
              ...prev,
              [bucket]: String((e as Error)?.message || e),
            }));
          } finally {
            if (opts.reqId === feedReqId.current) {
              setPendingBuckets((prev) => prev.filter((b) => b !== bucket));
            }
          }
        }),
      );
    },
    [],
  );

  // ---- Cache mode: paged history ----------------------------------------
  const loadHistory = useCallback(async (p: number): Promise<{ configured: boolean; total: number }> => {
    const reqId = ++feedReqId.current;
    setHistoryError(null);
    try {
      const res = await fetch(`/api/signals/history?page=${p}`, { cache: "no-store" });
      const data = await readJson(res);
      if (reqId !== feedReqId.current) return { configured: true, total: 0 };
      if (!res.ok) {
        setHistoryError(
          typeof data.error === "string" ? data.error : `History read failed (${res.status})`,
        );
        setFeedLoading(false);
        return { configured: true, total: 0 };
      }
      const configured = Boolean(data.configured);
      setCacheMode(configured);
      if (configured) {
        setSignals(Array.isArray(data.signals) ? (data.signals as Signal[]) : []);
        setTotal(Number(data.total) || 0);
        setPage(p);
        setLastFetchAt(Date.now());
        setFeedLoading(false);
      }
      return { configured, total: Number(data.total) || 0 };
    } catch (e) {
      if (reqId === feedReqId.current) {
        setHistoryError(String((e as Error)?.message || e));
        setFeedLoading(false);
      }
      return { configured: true, total: 0 };
    }
  }, []);

  // Pull = live scans (which upsert server-side) + reload page 1.
  const runPull = useCallback(async () => {
    if (pulling) return;
    setPulling(true);
    const reqId = ++feedReqId.current;
    await scanBuckets({ force: true, appendLive: false, reqId });
    if (reqId === feedReqId.current) {
      await loadHistory(1);
      setPulling(false);
    }
  }, [pulling, scanBuckets, loadHistory]);

  // Ephemeral mode (no Supabase): progressive append, like before.
  const runEphemeralScan = useCallback(
    async (force: boolean) => {
      const reqId = ++feedReqId.current;
      setSignals([]);
      setFeedLoading(true);
      await scanBuckets({ force, appendLive: true, reqId });
      if (reqId === feedReqId.current) setFeedLoading(false);
    },
    [scanBuckets],
  );

  // Boot: try the cache first; fall back to ephemeral scanning.
  useEffect(() => {
    (async () => {
      const { configured, total: cachedTotal } = await loadHistory(1);
      if (!configured) {
        await runEphemeralScan(false);
      } else if (cachedTotal === 0 && !autoPulled.current) {
        // First ever load on an empty cache — run the initial pull.
        autoPulled.current = true;
        runPull();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(i);
  }, []);

  const lastUpdated = useMemo(() => {
    if (lastFetchAt === null) return "—";
    const min = Math.floor((now - lastFetchAt) / 60000);
    return min <= 0 ? "just now" : `${min}m ago`;
  }, [lastFetchAt, now]);

  const segmentCounts = useMemo(() => {
    const c = {} as Record<SegmentId, number>;
    for (const s of SEGMENTS) c[s.id] = 0;
    for (const sig of signals) c[sig.segment] = (c[sig.segment] ?? 0) + 1;
    return c;
  }, [signals]);

  const signalCounts = useMemo(() => {
    const c = {} as Record<SignalTypeId, number>;
    for (const s of SIGNAL_TYPES) c[s.id] = 0;
    for (const sig of signals) c[sig.type] = (c[sig.type] ?? 0) + 1;
    return c;
  }, [signals]);

  const { sweBandCounts, unknownSweCount } = useMemo(() => {
    const counts = {} as Record<SweBandId, number>;
    for (const b of SWE_BANDS) counts[b.id] = 0;
    let unknown = 0;
    for (const sig of signals) {
      const band = sweBandOf(sig.sweEstimate);
      if (band) counts[band] += 1;
      else unknown += 1;
    }
    return { sweBandCounts: counts, unknownSweCount: unknown };
  }, [signals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return signals.filter((s) => {
      if (s.strength < minStrength) return false;
      if (segments.length > 0 && !segments.includes(s.segment)) return false;
      if (types.length > 0 && !types.includes(s.type)) return false;
      if (bands.length > 0) {
        const band = sweBandOf(s.sweEstimate);
        if (band === null || !bands.includes(band)) return false;
      }
      if (
        q &&
        !s.account.toLowerCase().includes(q) &&
        !s.title.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [signals, minStrength, segments, types, bands, search]);

  const metrics = useMemo(() => {
    const accounts = new Set(filtered.map((s) => s.account));
    const avgFit = filtered.length
      ? Math.round(filtered.reduce((sum, s) => sum + s.strength, 0) / filtered.length)
      : 0;
    return {
      total: filtered.length,
      accounts: accounts.size,
      avgFit,
      hot: filtered.filter((s) => s.strength >= 80).length,
    };
  }, [filtered]);

  const getIntel = useCallback(async (company: string) => {
    const reqId = ++intelReqId.current;
    setSelected(company);
    setIntel(null);
    setIntelError(null);
    setIntelLoading(true);
    setTab("feed");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const res = await fetch(`/api/intel?company=${encodeURIComponent(company)}`);
      if (reqId !== intelReqId.current) return;
      const data = await readJson(res);
      if (reqId !== intelReqId.current) return;
      if (!res.ok) {
        setIntelError(
          typeof data.error === "string" ? data.error : `Intel pass failed (${res.status})`,
        );
      } else {
        const briefing = (data.intel as Intel | undefined) ?? null;
        setIntel(briefing);
        if (!briefing) setIntelError("No brief returned — try again.");
      }
    } catch (e) {
      if (reqId !== intelReqId.current) return;
      setIntelError(String((e as Error)?.message || e));
    } finally {
      if (reqId === intelReqId.current) setIntelLoading(false);
    }
  }, []);

  const refresh = () => {
    setRefreshing(true);
    const done = () => setTimeout(() => setRefreshing(false), 400);
    if (cacheMode) runPull().finally(done);
    else {
      setFeedLoading(true);
      runEphemeralScan(true).finally(done);
    }
  };

  // Leaving the brief invalidates any in-flight intel request.
  const clearSelection = useCallback(() => {
    intelReqId.current++;
    setSelected(null);
    setIntelLoading(false);
    setIntelError(null);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-ink-950">
      <Header
        search={search}
        onSearch={setSearch}
        onRefresh={refresh}
        refreshing={refreshing || pulling}
        lastUpdated={lastUpdated}
      />
      <div className="flex">
        <Sidebar
          activeTab={tab}
          onTab={(t) => {
            setTab(t);
            clearSelection();
          }}
          segmentCounts={segmentCounts}
          selectedSegments={segments}
          onToggleSegment={(id) => setSegments((prev) => toggleIn(prev, id))}
          onClearSegments={() => setSegments([])}
          sweBandCounts={sweBandCounts}
          unknownSweCount={unknownSweCount}
          selectedSweBands={bands}
          onToggleSweBand={(id) => setBands((prev) => toggleIn(prev, id))}
          onClearSweBands={() => setBands([])}
          signalCounts={signalCounts}
          selectedSignalTypes={types}
          onToggleSignalType={(id) => setTypes((prev) => toggleIn(prev, id))}
          onClearSignalTypes={() => setTypes([])}
          minStrength={minStrength}
          onMinStrength={setMinStrength}
        />

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-5xl">
            {selected ? (
              intelLoading ? (
                <IntelSkeleton company={selected} />
              ) : intelError || !intel ? (
                <IntelError
                  company={selected}
                  error={intelError || "No brief returned."}
                  onRetry={() => getIntel(selected)}
                  onBack={clearSelection}
                />
              ) : (
                <CompanyIntel intel={intel} onBack={clearSelection} />
              )
            ) : tab === "feed" ? (
              <SignalFeed
                signals={filtered}
                loading={feedLoading}
                pulling={pulling}
                cacheMode={cacheMode}
                page={page}
                totalPages={totalPages}
                totalCached={total}
                pageSize={PAGE_SIZE}
                historyError={historyError}
                pendingBuckets={pendingBuckets}
                bucketErrors={bucketErrors}
                metrics={metrics}
                updated={lastUpdated}
                onSelectCompany={getIntel}
                onGetIntel={getIntel}
                onRetry={refresh}
                onPullMore={runPull}
                onPage={(p) => loadHistory(p)}
              />
            ) : (
              <SalesAssist />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

const LOADING_LINES = [
  "▸ searching news, engineering blogs, job boards…",
  "▸ estimating SWE headcount and codebase complexity…",
  "▸ scoring ICP fit across five criteria…",
  "▸ mapping stakeholders — who feels the pain vs who signs…",
  "▸ estimating AI-tooling cost exposure…",
  "▸ drafting the outreach angle…",
];

function IntelSkeleton({ company }: { company: string }) {
  const [lineIdx, setLineIdx] = useState(0);
  useEffect(() => {
    const i = setInterval(
      () => setLineIdx((n) => (n + 1) % LOADING_LINES.length),
      2600,
    );
    return () => clearInterval(i);
  }, []);

  return (
    <div className="space-y-5">
      <div className="skeleton h-4 w-32 rounded" />
      <div className="skeleton h-9 w-72 rounded-lg" />
      <p className="font-mono text-sm text-neon-400">
        researching {company} live — {LOADING_LINES[lineIdx]}
      </p>
      <p className="font-mono text-xs text-ink-500">
        claude-sonnet-4 + web_search · typically 30-60s
      </p>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-ink-700 bg-ink-900 p-6">
          <div className="skeleton mb-4 h-4 w-40 rounded" />
          <div className="skeleton mb-2 h-4 w-full rounded" />
          <div className="skeleton mb-2 h-4 w-5/6 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
        </div>
      ))}
    </div>
  );
}

function IntelError({
  company,
  error,
  onRetry,
  onBack,
}: {
  company: string;
  error: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="text-sm text-ink-400 transition-colors hover:text-ink-50"
      >
        ← Back to Signal Feed
      </button>
      <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-5">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-300">
            Intel brief for {company} failed
          </p>
          <p className="mt-1 break-words text-xs leading-relaxed text-red-200/80">
            {error}
          </p>
        </div>
        <button
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1.5 rounded border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/15"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    </div>
  );
}
