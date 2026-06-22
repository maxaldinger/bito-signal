"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Users,
  GitBranch,
  GitMerge,
  TrendingUp,
  Cpu,
  Crosshair,
  ChevronDown,
  ChevronUp,
  Check,
  Minimize2,
  Maximize2,
  ArrowDownToLine,
  Ban,
  Star,
  Eye,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Signal, SignalTypeId } from "@/lib/types";
import { SIGNAL_TYPE_MAP, SEGMENT_MAP } from "@/lib/data";
import { timeAgo, fmtNum, fmtDate } from "@/lib/format";
import {
  useDeepDiveScore,
  useIsProspected,
  useProspectedAt,
  useIsLowPriority,
  useIsCollapsed,
  toggleLowPriority,
  collapseCard,
  restoreCard,
  toggleBlacklist,
  useIsFavorite,
  toggleFavorite,
  useIsReviewed,
  toggleReviewed,
  unmarkProspected,
  getCompanyBlurb,
  setCompanyBlurb,
} from "@/lib/clientStore";
import { HubSpotActions } from "./HubSpotActions";

// Derive a company domain from a signal's citation URL — skips social/code hosts
// that aren't the company's own site (so Apollo enrich/web search stays accurate).
function domainFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (/linkedin\.com|twitter\.com|x\.com|github\.com|facebook\.com|crunchbase\.com|ycombinator\.com/.test(h))
      return undefined;
    return h;
  } catch {
    return undefined;
  }
}

// A signal's own description, minus the legacy Apollo-sweep boilerplate.
function ownDescription(signal: Signal): string {
  const d = signal.description?.trim();
  if (!d || d.startsWith("Surfaced by Apollo org search")) return "";
  return d;
}

// Lazily fetch the card's lead content once it's on screen (so a page of cards
// doesn't fan out a fetch per card up front), cache + persist it:
//  - Apollo profile-fit cards (type "icp", title still "Profile-fit match…")
//    research the single most relevant buying SIGNAL and lead with it; if none
//    exists they fall back to a company blurb.
//  - Any other card lacking a description just gets a blurb.
// Returns the title / description / source url to display (overriding the raw
// signal fields once enrichment lands).
function useCardContent(signal: Signal, ref: React.RefObject<HTMLDivElement | null>) {
  const own = ownDescription(signal);
  const isProfileFit = signal.type === "icp" && signal.title.startsWith("Profile-fit match");
  const [title, setTitle] = useState(signal.title);
  const [description, setDescription] = useState<string>(
    () => own || getCompanyBlurb(signal.account) || "",
  );
  const [url, setUrl] = useState(signal.url);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Non-profile-fit cards that already have content need nothing.
    if (!isProfileFit && (own || description)) return;
    const el = ref.current;
    if (!el) return;
    let done = false;

    const run = async () => {
      if (done) return;
      done = true;
      setLoading(true);
      try {
        const params = new URLSearchParams({ company: signal.account, type: signal.type });
        const dom = domainFromUrl(signal.url);
        if (dom) params.set("domain", dom);
        const endpoint = isProfileFit ? "company-signal" : "company-blurb";
        const res = await fetch(`/api/enrich/${endpoint}?${params.toString()}`);
        const data = (await res.json()) as {
          blurb?: string;
          signal?: { title?: string; description?: string; url?: string } | null;
        };
        const sig = data.signal;
        if (isProfileFit && sig?.title && sig?.description) {
          setTitle(sig.title);
          setDescription(sig.description);
          if (sig.url) setUrl(sig.url);
        } else if (data.blurb) {
          setDescription(data.blurb);
        }
        if (data.blurb) setCompanyBlurb(signal.account, data.blurb);
      } catch {
        /* leave as-is */
      } finally {
        setLoading(false);
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void run();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal.account, signal.type]);

  return { title, description, url, loading: loading && !description };
}

const TYPE_ICON: Record<SignalTypeId, LucideIcon> = {
  hiring: Users,
  oss: GitBranch,
  ma: GitMerge,
  funding: TrendingUp,
  ai: Cpu,
  icp: Crosshair,
};

function StrengthBar({
  value,
  color,
  fromBrief,
}: {
  value: number;
  color: string;
  /** True when the value is the authoritative score from a generated brief. */
  fromBrief: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2"
      title={
        fromBrief
          ? "Bito ICP fit from the generated brief (0-99)"
          : "Preliminary ICP estimate — open the brief for the scored breakdown (0-99)"
      }
    >
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
      <span className="flex w-9 items-center justify-end gap-0.5 text-right font-mono text-xs font-semibold tabular-nums text-ink-300">
        {value}
        {!fromBrief && <span className="text-[9px] font-normal text-ink-500">~</span>}
      </span>
    </div>
  );
}

export function SignalCard({
  signal,
  onSelect,
  expanded = false,
  index = 0,
  brief,
}: {
  signal: Signal;
  onSelect: (company: string) => void;
  /** Whether this card's inline brief is currently expanded beneath it. */
  expanded?: boolean;
  /** Position in the feed — staggers the HubSpot auto-check to respect the
   *  ~4 req/s search limit when a whole page of cards mounts at once. */
  index?: number;
  /** The intel brief, rendered INSIDE the card so it expands from the card. */
  brief?: ReactNode;
}) {
  const type = SIGNAL_TYPE_MAP[signal.type];
  const Icon = TYPE_ICON[signal.type];
  const color = type.color;
  const segment = SEGMENT_MAP[signal.segment];

  // Once a brief has been generated for this company, its real ICP total is the
  // score we show — not the rougher per-signal estimate.
  const briefScore = useDeepDiveScore(signal.account);
  const score = briefScore ?? signal.strength;
  const prospected = useIsProspected("company", signal.account);
  const prospectedAt = useProspectedAt("company", signal.account);
  const lowPriority = useIsLowPriority(signal.account);
  const collapsed = useIsCollapsed(signal.account);
  const favorite = useIsFavorite(signal.account);
  const reviewed = useIsReviewed(signal.account);

  // Lead content — the signal's own title/description/url, or lazily researched
  // ones (most-relevant signal for Apollo profile-fit cards; else a blurb).
  const cardRef = useRef<HTMLDivElement>(null);
  const {
    title: displayTitle,
    description: displayDesc,
    url: displayUrl,
    loading: contentLoading,
  } = useCardContent(signal, cardRef);

  // Minimized cards collapse to a slim row — name + score + restore — so they
  // stay on the page without dominating it. Low-priority cards also sink to the
  // bottom (page.tsx sort); a plain-collapsed card keeps its place.
  if (lowPriority || collapsed) {
    return (
      <div
        className={`animate-fade-in flex items-center justify-between gap-3 rounded-lg border bg-ink-900/40 px-4 py-2 ${
          prospected ? "border-orange-500/50 ring-1 ring-orange-500/30" : "border-ink-800"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-500">
            {lowPriority ? "low priority" : "collapsed"}
          </span>
          {prospected && (
            <span
              title={`Already prospected — sent to HubSpot${prospectedAt ? ` on ${fmtDate(prospectedAt)}` : ""}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-orange-200"
            >
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-neon-500 text-ink-950">
                <Check className="h-2 w-2" strokeWidth={3.5} />
              </span>
              Prospected
            </span>
          )}
          <button
            onClick={() => onSelect(signal.account)}
            className="min-w-0 truncate font-mono text-sm text-ink-300 transition-colors hover:text-neon-300"
            title="Open brief"
          >
            {signal.account}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-xs tabular-nums text-ink-500">{score}</span>
          <button
            onClick={() => restoreCard(signal.account)}
            title="Restore card"
            className="inline-flex items-center gap-1 rounded border border-ink-700 px-2 py-1 font-mono text-[11px] text-ink-400 transition-colors hover:border-neon-600/40 hover:text-neon-200"
          >
            <Maximize2 className="h-3 w-3" /> Restore
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={`animate-fade-in rounded-lg border bg-ink-900 p-4 transition-colors sm:p-5 ${
        prospected
          ? "border-orange-500/60 ring-1 ring-orange-500/40"
          : expanded
            ? "border-neon-600/40"
            : "border-ink-700 hover:border-ink-600"
      }`}
    >
      {prospected && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-orange-500/40 bg-orange-500/15 px-3 py-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neon-500 text-ink-950">
            <Check className="h-4 w-4" strokeWidth={3.5} />
          </span>
          <span className="min-w-0 font-mono text-xs font-semibold uppercase tracking-wide text-orange-200">
            Prospected · sent to HubSpot{prospectedAt ? ` · ${fmtDate(prospectedAt)}` : ""}
          </span>
          <button
            onClick={() => unmarkProspected("company", signal.account)}
            title="Not prospected — clear this marker"
            className="ml-auto shrink-0 rounded p-0.5 text-orange-300/70 transition-colors hover:bg-orange-500/15 hover:text-orange-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
        <StrengthBar value={score} color={color} fromBrief={briefScore !== undefined} />
      </div>

      <button
        onClick={() => onSelect(signal.account)}
        className="mb-2 inline-block max-w-full truncate rounded border border-neon-600/30 bg-neon-500/10 px-2.5 py-1 font-mono text-sm font-semibold text-neon-300 transition-colors hover:bg-neon-500/20"
      >
        {signal.account}
      </button>

      <h3 className="mb-1.5 text-[15px] font-semibold leading-snug text-ink-50">
        {displayTitle}
      </h3>
      {/* Lead text — the most relevant researched signal for Apollo profile-fit
          cards, else the signal's own description or a company blurb. */}
      {displayDesc ? (
        <p className="text-sm leading-relaxed text-ink-300">{displayDesc}</p>
      ) : contentLoading ? (
        <div className="space-y-1.5 py-0.5">
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-2/3 rounded" />
        </div>
      ) : null}

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
        {signal.tags.map((tag, i) =>
          /kubernetes/i.test(tag) ? (
            <span
              key={`${tag}-${i}`}
              title="K8s shops typically run 10+ services across multiple repos — strong Bito fit."
              className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-sky-400"
            >
              ⎈ {tag}
            </span>
          ) : (
            <span
              key={`${tag}-${i}`}
              className="rounded border border-ink-700 bg-ink-950 px-1.5 py-0.5 text-[11px] text-ink-400"
            >
              {tag}
            </span>
          ),
        )}
      </div>

      {/* HubSpot — check the account / create a quick task without opening the
          brief. Manual check only (no autoCheck) so a full feed doesn't fire
          dozens of HubSpot searches at once and trip the ~4 req/s limit. */}
      <div className="mt-4 border-t border-ink-700 pt-3">
        <HubSpotActions
          kind="company"
          name={signal.account}
          compact
          autoCheck
          autoCheckDelayMs={index * 300}
          defaultSubject={`SIGNAL DASH - ${signal.account}`}
          defaultBody={
            `${signal.account} — ${segment.label}` +
            `${signal.sweEstimate ? `, ~${fmtNum(signal.sweEstimate)} SWEs` : ""}.\n` +
            `SIGNAL: ${displayTitle}\n${displayDesc}\n` +
            `${displayUrl ? `SOURCE: ${signal.source} — ${displayUrl}\n` : ""}`
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-ink-700 pt-3">
        <span className="min-w-0 shrink truncate font-mono text-[11px] text-ink-500">
          {timeAgo(signal.date)} · {signal.source}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => toggleReviewed(signal.account)}
            title={reviewed ? "Mark not reviewed" : "Mark reviewed"}
            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              reviewed
                ? "border-neon-600/40 bg-neon-500/10 text-neon-300 hover:bg-neon-500/20"
                : "border-ink-700 text-ink-400 hover:border-neon-600/40 hover:text-neon-200"
            }`}
          >
            <Eye className="h-3 w-3" /> {reviewed ? "Reviewed" : "Review"}
          </button>
          <button
            onClick={() => collapseCard(signal.account)}
            title="Collapse — shrink this card but keep its place in the sort"
            className="inline-flex items-center gap-1 rounded border border-ink-700 px-2.5 py-1.5 text-xs font-medium text-ink-400 transition-colors hover:border-ink-600 hover:text-ink-200"
          >
            <Minimize2 className="h-3 w-3" /> Collapse
          </button>
          <button
            onClick={() => toggleLowPriority(signal.account)}
            title="Low priority — collapse and sink this card to the bottom"
            className="inline-flex items-center gap-1 rounded border border-ink-700 px-2.5 py-1.5 text-xs font-medium text-ink-400 transition-colors hover:border-ink-600 hover:text-ink-200"
          >
            <ArrowDownToLine className="h-3 w-3" /> Low priority
          </button>
          <button
            onClick={() => toggleBlacklist(signal.account)}
            title="Not a fit — remove this company from the feed (kept hidden across pulls)"
            className="inline-flex items-center gap-1 rounded border border-ink-700 px-2.5 py-1.5 text-xs font-medium text-ink-400 transition-colors hover:border-red-500/40 hover:text-red-300"
          >
            <Ban className="h-3 w-3" /> Not a fit
          </button>
          <button
            onClick={() => toggleFavorite(signal.account)}
            title={favorite ? "Remove from favorites" : "Add to Signal favorites"}
            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              favorite
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15"
                : "border-ink-700 text-ink-400 hover:border-amber-500/40 hover:text-amber-300"
            }`}
          >
            <Star className={`h-3 w-3 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} />
            {favorite ? "Favorited" : "Favorite"}
          </button>
        </div>
      </div>

      {/* Full-width toggle that doubles as the divider into the in-card brief. */}
      <button
        onClick={() => onSelect(signal.account)}
        className={`mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
          expanded
            ? "border-neon-600/40 bg-neon-500/10 text-neon-300 hover:bg-neon-500/20"
            : "border-ink-700 text-ink-300 hover:border-neon-600/40 hover:bg-ink-800 hover:text-ink-50"
        }`}
      >
        {expanded ? (
          <>
            Close Brief <ChevronUp className="h-4 w-4" />
          </>
        ) : (
          <>
            View Full Brief <ChevronDown className="h-4 w-4" />
          </>
        )}
      </button>

      {/* Brief expands in place, inside the card, when opened. */}
      {brief}
    </div>
  );
}
