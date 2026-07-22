"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { Sidebar, type TabId } from "@/components/Sidebar";
import { SignalFeed, type FeedSort } from "@/components/SignalFeed";
import { FavoritesView } from "@/components/FavoritesView";
import { DirectoryView } from "@/components/DirectoryView";
import { GitHubProspecting } from "@/components/GitHubProspecting";
import { SalesAssist } from "@/components/SalesAssist";
import { PullControls } from "@/components/PullControls";
import {
  useDeepDiveScores,
  useProspectedCompanies,
  useLowPriorityCompanies,
  useHubspotPresence,
  useBlacklist,
  useReviewedCompanies,
  markReviewed,
  getSweepPage,
  setSweepPage,
  companyInMap,
  companyValue,
  initStateSync,
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
  BriefState,
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
  const [mobileNav, setMobileNav] = useState(false);

  // Feed state. Two modes:
  //  - cache mode (Supabase configured): the feed shows a 50-per-page window
  //    over accumulated history; "Pull more" runs live scans that upsert.
  //  - ephemeral mode (no Supabase): live scans append progressively, nothing
  //    persists between loads.
  const [signals, setSignals] = useState<Signal[]>([]);
  const [cacheMode, setCacheMode] = useState<boolean>(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Mirror of `total` for stale-free reads inside long-lived callbacks.
  const totalRef = useRef(0);
  // Outcome of the last "Pull More" — drives the post-pull feedback line.
  const [pullResult, setPullResult] = useState<{ added: number; failed: SignalTypeId[] } | null>(
    null,
  );
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

  // Multiple briefs can be open at once — keyed by company. Each has its own
  // load/error/intel so opening one never tears down another.
  const [briefs, setBriefs] = useState<Record<string, BriefState>>({});
  const briefReqIds = useRef<Record<string, number>>({});

  // Multi-select filters — empty selection means "all".
  const [segments, setSegments] = useState<SegmentId[]>([]);
  const [types, setTypes] = useState<SignalTypeId[]>([]);
  const [bands, setBands] = useState<SweBandId[]>([]);
  const [minStrength, setMinStrength] = useState(0);
  const [sort, setSort] = useState<FeedSort>("feed");
  // HubSpot presence filter: all / not-in / in.
  const [hubspotFilter, setHubspotFilter] = useState<"all" | "not" | "in">("all");
  // Reviewed filter: all / not-reviewed / reviewed.
  const [reviewedFilter, setReviewedFilter] = useState<"all" | "not" | "reviewed">("all");

  // ---- Live bucket scans (shared by both modes) -------------------------
  const scanBuckets = useCallback(
    async (opts: { force: boolean; appendLive: boolean; reqId: number }): Promise<{
      failed: SignalTypeId[];
    }> => {
      setBucketErrors({});
      setPendingBuckets([...BUCKETS]);
      const failed: SignalTypeId[] = [];
      await Promise.allSettled(
        BUCKETS.map(async (bucket) => {
          try {
            const delay = BUCKET_STAGGER_MS[bucket] ?? 0;
            if (delay > 0) await new Promise((r) => setTimeout(r, delay));
            // Apollo sweep: drive the page from the persisted cursor so each
            // pull fetches NEW orgs (not page 1 over and over).
            const sweepParam =
              bucket === "icp"
                ? `&sweepPage=${getSweepPage(regionRef.current) ?? ""}`
                : "";
            const url =
              `/api/signals?type=${bucket}&region=${regionRef.current}` +
              (opts.force ? `&fresh=${Date.now()}` : "") +
              sweepParam;
            const res = await fetch(url, opts.force ? { cache: "no-store" } : {});
            const data = await readJson(res);
            if (opts.reqId !== feedReqId.current) return;
            if (!res.ok) {
              failed.push(bucket);
              setBucketErrors((prev) => ({
                ...prev,
                [bucket]:
                  typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
              }));
            } else if (data.skipped) {
              // Bucket not configured (e.g. ICP sweep without APOLLO_API_KEY).
            } else {
              // Advance the Apollo sweep cursor so the next pull pages forward.
              if (bucket === "icp" && typeof data.nextSweepPage === "number") {
                setSweepPage(regionRef.current, data.nextSweepPage);
              }
              if (opts.appendLive) {
                const fresh = Array.isArray(data.signals)
                  ? (data.signals as Signal[])
                  : [];
                setSignals((prev) => [...prev, ...fresh]);
                setLastFetchAt(Date.now());
              }
            }
          } catch (e) {
            if (opts.reqId !== feedReqId.current) return;
            failed.push(bucket);
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
      return { failed };
    },
    [],
  );

  // ---- Cache mode: load the WHOLE region cache, sort/paginate client-side ----
  // (so sort + filters apply globally, not just to one server page).
  const loadAll = useCallback(async (): Promise<{ configured: boolean; total: number }> => {
    const reqId = ++feedReqId.current;
    setHistoryError(null);
    try {
      const res = await fetch(`/api/signals/history?all=1&region=${regionRef.current}`, {
        cache: "no-store",
      });
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
        totalRef.current = Number(data.total) || 0;
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

  // Pull = live scans (which upsert server-side) + reload page 1. Report the net
  // new count (and any failed sources) so a no-op pull is visible, not silent.
  const runPull = useCallback(async () => {
    if (pulling) return;
    setPulling(true);
    setPullResult(null);
    const before = totalRef.current;
    const reqId = ++feedReqId.current;
    const { failed } = await scanBuckets({ force: true, appendLive: false, reqId });
    if (reqId === feedReqId.current) {
      const { total: after } = await loadAll();
      setPullResult({ added: Math.max(0, after - before), failed });
      setPage(1);
      setPulling(false);
    }
  }, [pulling, scanBuckets, loadAll]);

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

  // Cross-device sync: hydrate the per-browser stores (prospected, reviewed,
  // favorites, scores, reveals, …) from Supabase and keep them in sync, so the
  // same data shows whether you prospect from your phone or your desktop.
  useEffect(() => {
    initStateSync();
  }, []);

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
      const { configured } = await loadAll();
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
      setPage(1);
      loadAll();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadAll],
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

  // Drop blacklisted ("not a fit") companies before anything else sees them.
  const blacklistMap = useBlacklist();
  const reviewedMap = useReviewedCompanies();
  const activeSignals = useMemo(
    () => signals.filter((s) => !companyInMap(blacklistMap, s.account)),
    [signals, blacklistMap],
  );

  // HubSpot state (live per-card check, else local prospected flag) — drives the
  // sort AND the "in / not in HubSpot" filter. Live results fill in as the
  // staggered per-card checks finish, so this settles over a few seconds.
  const scoresMap = useDeepDiveScores();
  const prospectedMap = useProspectedCompanies();
  const lowPriMap = useLowPriorityCompanies();
  const presenceMap = useHubspotPresence();
  const isInHubspot = useCallback(
    (s: Signal): boolean => {
      const live = companyValue(presenceMap, s.account);
      return live !== undefined ? live === 1 : companyInMap(prospectedMap, s.account);
    },
    [presenceMap, prospectedMap],
  );

  const segmentCounts = useMemo(() => {
    const c = {} as Record<SegmentId, number>;
    for (const s of SEGMENTS) c[s.id] = 0;
    for (const sig of activeSignals) c[sig.segment] = (c[sig.segment] ?? 0) + 1;
    return c;
  }, [activeSignals]);

  const signalCounts = useMemo(() => {
    const c = {} as Record<SignalTypeId, number>;
    for (const s of SIGNAL_TYPES) c[s.id] = 0;
    for (const sig of activeSignals) c[sig.type] = (c[sig.type] ?? 0) + 1;
    return c;
  }, [activeSignals]);

  const { sweBandCounts, unknownSweCount } = useMemo(() => {
    const counts = {} as Record<SweBandId, number>;
    for (const b of SWE_BANDS) counts[b.id] = 0;
    let unknown = 0;
    for (const sig of activeSignals) {
      const band = sweBandOf(sig.sweEstimate);
      if (band) counts[band] += 1;
      else unknown += 1;
    }
    return { sweBandCounts: counts, unknownSweCount: unknown };
  }, [activeSignals]);

  const filtered = useMemo(() => {
    return activeSignals.filter((s) => {
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
      if (hubspotFilter === "not" && isInHubspot(s)) return false;
      if (hubspotFilter === "in" && !isInHubspot(s)) return false;
      if (reviewedFilter !== "all") {
        const seen = companyInMap(reviewedMap, s.account);
        if (reviewedFilter === "not" && seen) return false;
        if (reviewedFilter === "reviewed" && !seen) return false;
      }
      return true;
    });
  }, [
    activeSignals,
    minStrength,
    segments,
    types,
    bands,
    hubspotFilter,
    isInHubspot,
    reviewedFilter,
    reviewedMap,
  ]);

  // Feed sort lives here (driven by the in-feed dropdown) so the order is
  // applied once, upstream of the feed. Uses the displayed score (brief total
  // overrides the per-signal estimate) and sinks low-priority cards to the end.
  const sortedFiltered = useMemo(() => {
    const scoreOf = (s: Signal) => companyValue(scoresMap, s.account) ?? s.strength;
    const inHubspot = isInHubspot;
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
  }, [filtered, sort, scoresMap, lowPriMap, isInHubspot]);

  // Client-side pagination over the globally sorted+filtered set.
  const pageCount = Math.max(1, Math.ceil(sortedFiltered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageItems = useMemo(
    () => sortedFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedFiltered, safePage],
  );
  // How many (non-blacklisted) cached signals the active filters are hiding.
  const hiddenByFilters = activeSignals.length - filtered.length;

  // Changing filters/sort/region resets to page 1 so you never land past the end.
  useEffect(() => {
    setPage(1);
  }, [segments, types, bands, minStrength, sort, region, hubspotFilter, reviewedFilter]);

  // Metrics describe the current page (label is "signals on page").
  const metrics = useMemo(() => {
    const accounts = new Set(pageItems.map((s) => s.account));
    const avgFit = pageItems.length
      ? Math.round(pageItems.reduce((sum, s) => sum + s.strength, 0) / pageItems.length)
      : 0;
    return {
      total: pageItems.length,
      accounts: accounts.size,
      avgFit,
      hot: pageItems.filter((s) => s.strength >= 80).length,
    };
  }, [pageItems]);

  // Open (or refresh) a company's brief. Each company tracks its own request id
  // so concurrent briefs don't clobber each other, and a stale fetch is ignored.
  const getIntel = useCallback(async (company: string, fresh = false) => {
    const c = company.trim();
    if (!c) return;
    markReviewed(c); // opening a brief = reviewed
    const reqId = (briefReqIds.current[c] ?? 0) + 1;
    briefReqIds.current[c] = reqId;
    setBriefs((prev) => ({
      ...prev,
      [c]: { loading: true, error: null, intel: prev[c]?.intel ?? null },
    }));
    try {
      const res = await fetch(
        `/api/intel?company=${encodeURIComponent(c)}${fresh ? "&fresh=1" : ""}`,
      );
      if (briefReqIds.current[c] !== reqId) return;
      const data = await readJson(res);
      if (briefReqIds.current[c] !== reqId) return;
      if (!res.ok) {
        const error =
          typeof data.error === "string" ? data.error : `Intel pass failed (${res.status})`;
        setBriefs((prev) => ({ ...prev, [c]: { loading: false, error, intel: null } }));
      } else {
        const briefing = (data.intel as Intel | undefined) ?? null;
        setBriefs((prev) => ({
          ...prev,
          [c]: {
            loading: false,
            error: briefing ? null : "No brief returned — try again.",
            intel: briefing,
          },
        }));
      }
    } catch (e) {
      if (briefReqIds.current[c] !== reqId) return;
      setBriefs((prev) => ({
        ...prev,
        [c]: { loading: false, error: String((e as Error)?.message || e), intel: null },
      }));
    }
  }, []);

  // Header refresh: re-read the cache (cheap, no scans). Live scanning is
  // exclusively behind the "Pull More Signals" button.
  const refresh = () => {
    setRefreshing(true);
    const done = () => setTimeout(() => setRefreshing(false), 400);
    if (cacheMode) loadAll().finally(done);
    else {
      setFeedLoading(true);
      runEphemeralScan(true).finally(done);
    }
  };

  // Close one brief — invalidates its in-flight request so a late response is
  // dropped instead of re-opening it.
  const closeBrief = useCallback((company: string) => {
    briefReqIds.current[company] = (briefReqIds.current[company] ?? 0) + 1;
    setBriefs((prev) => {
      if (!(company in prev)) return prev;
      const next = { ...prev };
      delete next[company];
      return next;
    });
  }, []);

  // Close every open brief (tab switch / region change).
  const clearSelection = useCallback(() => {
    for (const k of Object.keys(briefReqIds.current)) briefReqIds.current[k] += 1;
    setBriefs({});
  }, []);

  // Pages now span the full sorted+filtered set (client-side), not a server page.
  const totalPages = pageCount;

  return (
    <div className="min-h-screen overflow-x-hidden bg-ink-950">
      <Header
        onRefresh={refresh}
        refreshing={refreshing || pulling}
        lastUpdated={lastUpdated}
        region={region}
        onRegion={changeRegion}
        onMenu={() => setMobileNav(true)}
      />
      <div className="flex">
        <Sidebar
          activeTab={tab}
          onTab={(t) => {
            setTab(t);
            clearSelection();
          }}
          mobileOpen={mobileNav}
          onMobileClose={() => setMobileNav(false)}
          pullControls={
            tab === "feed" ? (
              <PullControls
                cacheMode={cacheMode}
                region={region}
                page={safePage}
                totalPages={totalPages}
                totalCached={total}
                signalCount={filtered.length}
                updated={lastUpdated}
                pulling={pulling}
                onPullMore={runPull}
                onPage={setPage}
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
          hubspotFilter={hubspotFilter}
          onHubspotFilter={setHubspotFilter}
          reviewedFilter={reviewedFilter}
          onReviewedFilter={setReviewedFilter}
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
                    page={safePage}
                    totalPages={totalPages}
                    totalCached={total}
                    signalCount={filtered.length}
                    updated={lastUpdated}
                    pulling={pulling}
                    onPullMore={runPull}
                    onPage={setPage}
                  />
                </div>
                <SignalFeed
                  signals={pageItems}
                  sort={sort}
                  onSort={setSort}
                  page={safePage}
                  totalPages={totalPages}
                  onPage={setPage}
                  pullResult={pullResult}
                  onDismissPullResult={() => setPullResult(null)}
                  loading={feedLoading}
                  pulling={pulling}
                  cacheMode={cacheMode}
                  totalCached={total}
                  historyError={historyError}
                  pendingBuckets={pendingBuckets}
                  bucketErrors={bucketErrors}
                  metrics={metrics}
                  hiddenCount={hiddenByFilters}
                onClearFilters={() => {
                  setSegments([]);
                  setTypes([]);
                  setBands([]);
                  setMinStrength(0);
                  setHubspotFilter("all");
                  setReviewedFilter("all");
                }}
                onSelectCompany={getIntel}
                onGetIntel={getIntel}
                onRetry={refresh}
                onPullMore={runPull}
                briefs={briefs}
                onCloseIntel={closeBrief}
                onRefreshIntel={(c) => getIntel(c, true)}
                />
              </>
            ) : tab === "directory" ? (
              <DirectoryView
                onSelectCompany={getIntel}
                onGetIntel={getIntel}
                briefs={briefs}
                onCloseIntel={closeBrief}
                onRefreshIntel={(c) => getIntel(c, true)}
              />
            ) : tab === "github" ? (
              <GitHubProspecting />
            ) : tab === "favorites" ? (
              <FavoritesView
                signals={signals}
                onSelectCompany={getIntel}
                onGetIntel={getIntel}
                briefs={briefs}
                onCloseIntel={closeBrief}
                onRefreshIntel={(c) => getIntel(c, true)}
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
