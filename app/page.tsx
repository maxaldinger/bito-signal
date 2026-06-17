"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { Sidebar, type TabId } from "@/components/Sidebar";
import { SignalFeed, type FeedSort } from "@/components/SignalFeed";
import { SalesAssist } from "@/components/SalesAssist";
import { PullControls } from "@/components/PullControls";
import {
  useDeepDiveScores,
  useProspectedCompanies,
  useLowPriorityCompanies,
  useHubspotPresence,
  companyInMap,
  companyValue,
} from "@/lib/clientStore";
import {
  SEGMENTS,
  SIGNAL_TYPES,
  SWE_BANDS,
  sweBandOf,
  isRegionId,
  type SweBandId,
  type RegionId,
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

// GDELT (used by the hiring/ma/funding/ai buckets' free fetchers) hard-limits
// to ~1 request per 5s per IP — stagger those bucket launches so their GDELT
// calls land ≥6s apart. icp/oss don't touch GDELT and start immediately.
const BUCKET_STAGGER_MS: Record<SignalTypeId, number> = {
  icp: 0,
  oss: 0,
  hiring: 0,
  ma: 6000,
  funding: 12000,
  ai: 18000,
};

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

  // Intel region (US / India). The ref mirrors state so long-lived callbacks
  // never read a stale region; persisted in localStorage.
  const [region, setRegion] = useState<RegionId>("us");
  const regionRef = useRef<RegionId>("us");

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
  const [sort, setSort] = useState<FeedSort>("feed");
  const [search, setSearch] = useState("");

  // ---- Live bucket scans (shared by both modes) -------------------------
  const scanBuckets = useCallback(
    async (opts: { force: boolean; appendLive: boolean; reqId: number }) => {
      setBucketErrors({});
      setPendingBuckets([...BUCKETS]);
      await Promise.allSettled(
        BUCKETS.map(async (bucket) => {
          try {
            const delay = BUCKET_STAGGER_MS[bucket] ?? 0;
            if (delay > 0) await new Promise((r) => setTimeout(r, delay));
            const url =
              `/api/signals?type=${bucket}&region=${regionRef.current}` +
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
      const res = await fetch(
        `/api/signals/history?page=${p}&region=${regionRef.current}`,
        { cache: "no-store" },
      );
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

  // Boot: restore the saved region, then load what's already cached —
  // scanning ONLY happens when the user explicitly clicks "Pull More
  // Signals". (Ephemeral mode has no cache, so it must scan to show
  // anything at all.)
  useEffect(() => {
    (async () => {
      try {
        const saved = localStorage.getItem("bito-region");
        if (isRegionId(saved)) {
          regionRef.current = saved;
          setRegion(saved);
        }
      } catch {
        /* private mode — default region stands */
      }
      const { configured } = await loadHistory(1);
      if (!configured) {
        await runEphemeralScan(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching region swaps the whole feed: close any open brief, reload
  // page 1 of that region's cache.
  const changeRegion = useCallback(
    (r: RegionId) => {
      if (r === regionRef.current) return;
      regionRef.current = r;
      setRegion(r);
      try {
        localStorage.setItem("bito-region", r);
      } catch {
        /* private mode */
      }
      clearSelection();
      setBucketErrors({});
      setPendingBuckets([]);
      setFeedLoading(true);
      loadHistory(1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadHistory],
  );

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
        // A missing SWE estimate is not evidence the company is OUTSIDE the
        // band — most signals (esp. the Apollo ICP sweep) have no SWE count, so
        // hiding them would nuke the feed. Only exclude KNOWN out-of-band sizes.
        if (band !== null && !bands.includes(band)) return false;
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

  // Feed sort lives here (driven by the in-feed dropdown) so the order is
  // applied once, upstream of the feed. Uses the displayed score (brief total
  // overrides the per-signal estimate) and sinks low-priority cards to the end.
  const scoresMap = useDeepDiveScores();
  const prospectedMap = useProspectedCompanies();
  const lowPriMap = useLowPriorityCompanies();
  const presenceMap = useHubspotPresence();
  const sortedFiltered = useMemo(() => {
    const scoreOf = (s: Signal) => companyValue(scoresMap, s.account) ?? s.strength;
    // In HubSpot = the live card check (1/0) when available, else the local
    // prospected flag. Live results trickle in as the staggered checks finish,
    // so this sort settles over a few seconds after a pull/page change.
    const inHubspot = (s: Signal): boolean => {
      const live = companyValue(presenceMap, s.account);
      if (live !== undefined) return live === 1;
      return companyInMap(prospectedMap, s.account);
    };
    const cmp = (a: Signal, b: Signal): number => {
      switch (sort) {
        case "fit":
          return scoreOf(b) - scoreOf(a);
        case "size":
          return (b.sweEstimate ?? 0) - (a.sweEstimate ?? 0);
        case "recent":
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        case "az":
          return a.account.localeCompare(b.account);
        case "hubspot":
          return Number(inHubspot(b)) - Number(inHubspot(a));
        case "nothubspot":
          return Number(inHubspot(a)) - Number(inHubspot(b));
        default:
          return 0; // "feed": keep the original pull order
      }
    };
    return [...filtered].sort((a, b) => {
      // Minimized / low-priority cards always sink to the bottom, any sort.
      const low =
        Number(companyInMap(lowPriMap, a.account)) -
        Number(companyInMap(lowPriMap, b.account));
      if (low !== 0) return low;
      return cmp(a, b);
    });
  }, [filtered, sort, scoresMap, prospectedMap, lowPriMap, presenceMap]);

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

  const getIntel = useCallback(async (company: string, fresh = false) => {
    const reqId = ++intelReqId.current;
    setSelected(company);
    setIntel(null);
    setIntelError(null);
    setIntelLoading(true);
    setTab("feed");
    try {
      const res = await fetch(
        `/api/intel?company=${encodeURIComponent(company)}${fresh ? "&fresh=1" : ""}`,
      );
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

  // Header refresh: re-read the cache (cheap, no scans). Live scanning is
  // exclusively behind the "Pull More Signals" button.
  const refresh = () => {
    setRefreshing(true);
    const done = () => setTimeout(() => setRefreshing(false), 400);
    if (cacheMode) loadHistory(page).finally(done);
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
        region={region}
        onRegion={changeRegion}
      />
      <div className="flex">
        <Sidebar
          activeTab={tab}
          onTab={(t) => {
            setTab(t);
            clearSelection();
          }}
          pullControls={
            tab === "feed" ? (
              <PullControls
                cacheMode={cacheMode}
                region={region}
                page={page}
                totalPages={totalPages}
                totalCached={total}
                signalCount={filtered.length}
                updated={lastUpdated}
                pulling={pulling}
                onPullMore={runPull}
                onPage={(p) => loadHistory(p)}
              />
            ) : null
          }
          segmentCounts={segmentCounts}
          selectedSegments={segments}
          onToggleSegment={(id) => setSegments((prev) => toggleIn(prev, id))}
          onSetSegments={setSegments}
          sweBandCounts={sweBandCounts}
          unknownSweCount={unknownSweCount}
          selectedSweBands={bands}
          onToggleSweBand={(id) => setBands((prev) => toggleIn(prev, id))}
          onSetSweBands={setBands}
          signalCounts={signalCounts}
          selectedSignalTypes={types}
          onToggleSignalType={(id) => setTypes((prev) => toggleIn(prev, id))}
          onSetSignalTypes={setTypes}
          minStrength={minStrength}
          onMinStrength={setMinStrength}
        />

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-5xl">
            {tab === "feed" ? (
              <>
                {/* Mobile pull controls — the sidebar (and its copy) is desktop-only */}
                <div className="mb-4 lg:hidden">
                  <PullControls
                    cacheMode={cacheMode}
                    region={region}
                    page={page}
                    totalPages={totalPages}
                    totalCached={total}
                    signalCount={filtered.length}
                    updated={lastUpdated}
                    pulling={pulling}
                    onPullMore={runPull}
                    onPage={(p) => loadHistory(p)}
                  />
                </div>
                <SignalFeed
                  signals={sortedFiltered}
                  sort={sort}
                  onSort={setSort}
                  loading={feedLoading}
                  pulling={pulling}
                  cacheMode={cacheMode}
                  totalCached={total}
                  historyError={historyError}
                  pendingBuckets={pendingBuckets}
                  bucketErrors={bucketErrors}
                  metrics={metrics}
                  unfilteredCount={signals.length}
                onClearFilters={() => {
                  setSegments([]);
                  setTypes([]);
                  setBands([]);
                  setMinStrength(0);
                  setSearch("");
                }}
                onSelectCompany={getIntel}
                onGetIntel={getIntel}
                onRetry={refresh}
                onPullMore={runPull}
                expandedCompany={selected}
                intel={intel}
                intelLoading={intelLoading}
                intelError={intelError}
                onCloseIntel={clearSelection}
                onRefreshIntel={(c) => getIntel(c, true)}
                />
              </>
            ) : (
              <SalesAssist />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
