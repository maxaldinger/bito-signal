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

export default function Page() {
  const [tab, setTab] = useState<TabId>("feed");

  const [signals, setSignals] = useState<Signal[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Anchored to the last SUCCESSFUL fetch — a failed refresh must not claim
  // "just now". `now` ticks to re-derive the label.
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [selected, setSelected] = useState<string | null>(null);
  const [intel, setIntel] = useState<Intel | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  // Monotonic id so a slow, superseded intel request can't clobber the state
  // of a newer selection (intel calls run 30-60s; overlap is the normal case).
  const intelReqId = useRef(0);

  const [minStrength, setMinStrength] = useState(0);
  const [segment, setSegment] = useState<SegmentId | null>(null);
  const [signalType, setSignalType] = useState<SignalTypeId | null>(null);
  const [sweBand, setSweBand] = useState<SweBandId | null>(null);
  const [search, setSearch] = useState("");

  const loadSignals = useCallback(async (force = false) => {
    setFeedError(null);
    try {
      // `cache: no-store` only bypasses the browser cache; the CDN cache keyed
      // on s-maxage needs a unique URL to actually re-run the live pass.
      const url = force ? `/api/signals?fresh=${Date.now()}` : "/api/signals";
      const res = await fetch(url, force ? { cache: "no-store" } : {});
      const data = await readJson(res);
      if (!res.ok) {
        setSignals([]);
        setFeedError(
          typeof data.error === "string" ? data.error : `Signal pass failed (${res.status})`,
        );
      } else {
        setSignals(Array.isArray(data.signals) ? (data.signals as Signal[]) : []);
        setLastFetchAt(Date.now());
      }
    } catch (e) {
      setSignals([]);
      setFeedError(String((e as Error)?.message || e));
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

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
    return signals.filter(
      (s) =>
        s.strength >= minStrength &&
        (!segment || s.segment === segment) &&
        (!signalType || s.type === signalType) &&
        (!sweBand || sweBandOf(s.sweEstimate) === sweBand) &&
        (!q ||
          s.account.toLowerCase().includes(q) ||
          s.title.toLowerCase().includes(q)),
    );
  }, [signals, minStrength, segment, signalType, sweBand, search]);

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
      if (reqId !== intelReqId.current) return; // superseded by a newer selection
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
    setFeedLoading(true);
    loadSignals(true).finally(() => setTimeout(() => setRefreshing(false), 400));
  };

  // Leaving the brief invalidates any in-flight intel request.
  const clearSelection = useCallback(() => {
    intelReqId.current++;
    setSelected(null);
    setIntelLoading(false);
    setIntelError(null);
  }, []);

  return (
    <div className="min-h-screen bg-ink-950">
      <Header
        search={search}
        onSearch={setSearch}
        onRefresh={refresh}
        refreshing={refreshing}
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
          activeSegment={segment}
          onSegment={setSegment}
          sweBandCounts={sweBandCounts}
          unknownSweCount={unknownSweCount}
          activeSweBand={sweBand}
          onSweBand={setSweBand}
          signalCounts={signalCounts}
          activeSignalType={signalType}
          onSignalType={setSignalType}
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
                error={feedError}
                metrics={metrics}
                updated={lastUpdated}
                onSelectCompany={getIntel}
                onGetIntel={getIntel}
                onRetry={refresh}
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
