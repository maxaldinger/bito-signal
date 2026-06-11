"use client";

import { useState } from "react";
import {
  X,
  Target,
  Zap,
  AlertTriangle,
  Swords,
  Users,
  Coins,
  GaugeCircle,
  Compass,
  Send,
  Link2,
  ArrowUpRight,
  Copy,
  Check,
  type LucideIcon,
} from "lucide-react";
import type { CompanyIntel as Intel, Stakeholder } from "@/lib/types";
import { fmtUSD, fmtNum } from "@/lib/format";
import { EnrichmentPanel } from "./EnrichmentPanel";

function Section({
  title,
  icon: Icon,
  iconColor,
  children,
}: {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-fade-in rounded-lg border border-ink-700 bg-ink-900 p-6">
      <h3 className="mb-4 flex items-center gap-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-ink-200">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        {title}
      </h3>
      {children}
    </section>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  HIGH: "bg-red-500/15 text-red-400",
  MEDIUM: "bg-amber-500/15 text-amber-400",
  LOW: "bg-sky-500/15 text-sky-400",
};

const STAKEHOLDER_BADGE: Record<Stakeholder["type"], { label: string; cls: string }> = {
  "feels-pain": { label: "feels the pain", cls: "bg-amber-500/15 text-amber-400" },
  signs: { label: "signs", cls: "bg-neon-500/15 text-neon-300" },
  champion: { label: "champion", cls: "bg-sky-500/15 text-sky-400" },
  blocker: { label: "blocker", cls: "bg-red-500/15 text-red-400" },
  influencer: { label: "influencer", cls: "bg-violet-500/15 text-violet-400" },
};

const ICP_BARS: { key: keyof Pick<
  Intel["icp"],
  "sweHeadcount" | "codebaseComplexity" | "multiRepo" | "scalingActivity" | "aiToolingSpend"
>; label: string }[] = [
  { key: "sweHeadcount", label: "SWE headcount (50-500)" },
  { key: "codebaseComplexity", label: "Codebase age & complexity" },
  { key: "multiRepo", label: "Multi-repo indicators" },
  { key: "scalingActivity", label: "Recent scaling activity" },
  { key: "aiToolingSpend", label: "AI tooling spend signals" },
];

function MotionBadge({ motion }: { motion: Intel["motion"]["primary"] }) {
  return (
    <span className="rounded border border-neon-600/40 bg-neon-500/10 px-2.5 py-1 font-mono text-sm font-bold text-neon-300">
      {motion}
    </span>
  );
}

function StakeholderCard({ s, company }: { s: Stakeholder; company: string }) {
  const badge = STAKEHOLDER_BADGE[s.type];
  const q = s.linkedinQuery || `${company} ${s.role}`;
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="min-w-0 truncate text-sm font-semibold text-ink-100">
          {s.name ? `${s.name} — ${s.role}` : s.role}
        </h4>
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{s.rationale}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-300">
        <span className="font-semibold text-neon-300">Hook: </span>
        {s.outreachHook}
      </p>
      <a
        href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-neon-400 hover:text-neon-300"
      >
        Find on LinkedIn <ArrowUpRight className="h-3 w-3" />
      </a>
    </div>
  );
}

export function CompanyIntel({
  intel,
  onBack,
}: {
  intel: Intel;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const friction = intel.onboarding;
  const frictionColor =
    friction.level === "Low"
      ? "text-neon-400"
      : friction.level === "Medium"
        ? "text-amber-400"
        : "text-red-400";

  const painSide = intel.stakeholders.filter(
    (s) => s.type === "feels-pain" || s.type === "champion",
  );
  const signSide = intel.stakeholders.filter(
    (s) => s.type === "signs" || s.type === "blocker" || s.type === "influencer",
  );

  const copyDraft = async () => {
    if (!navigator.clipboard) {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
      return;
    }
    try {
      await navigator.clipboard.writeText(intel.outreach.draftMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
    }
  };

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="mb-1 inline-flex items-center gap-1.5 text-sm text-ink-400 transition-colors hover:text-ink-50"
      >
        <X className="h-4 w-4" /> Close brief
      </button>

      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight text-ink-50">{intel.name}</h2>
          {intel.oneLiner ? (
            <p className="mt-1 text-sm text-ink-300">{intel.oneLiner}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded border border-neon-600/30 bg-neon-500/10 px-2 py-0.5 font-mono text-xs font-medium text-neon-300">
              {intel.segment.label}
            </span>
            {intel.employeeBand && (
              <span className="rounded border border-ink-700 bg-ink-950 px-2 py-0.5 font-mono text-xs text-ink-300">
                {intel.employeeBand} employees
              </span>
            )}
            {intel.sweEstimate ? (
              <span className="rounded border border-ink-700 bg-ink-950 px-2 py-0.5 font-mono text-xs text-ink-300">
                ~{fmtNum(intel.sweEstimate)} SWEs
              </span>
            ) : null}
            {intel.hq && (
              <span className="rounded border border-ink-700 bg-ink-950 px-2 py-0.5 font-mono text-xs text-ink-400">
                {intel.hq}
              </span>
            )}
          </div>
          <p className="mt-2 font-mono text-[11px] text-ink-500">
            generated {new Date(intel.generatedAt).toLocaleString("en-US")} · live web research
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
            bito icp fit
          </p>
          <p className="font-mono text-5xl font-bold leading-none text-neon-400">
            {intel.icp.total}
            <span className="text-lg font-medium text-ink-500">/99</span>
          </p>
        </div>
      </div>

      {/* ICP breakdown */}
      <Section title="icp score breakdown" icon={Target} iconColor="text-neon-400">
        <div className="space-y-3">
          {ICP_BARS.map(({ key, label }) => {
            const v = intel.icp[key];
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-56 shrink-0 text-sm text-ink-300">{label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-600 to-neon-400"
                    style={{ width: `${(v / 20) * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right font-mono text-sm font-semibold tabular-nums text-ink-200">
                  {v}/20
                </span>
              </div>
            );
          })}
        </div>
        {intel.icp.rationale && (
          <p className="mt-4 border-t border-ink-700 pt-3 text-sm leading-relaxed text-ink-400">
            {intel.icp.rationale}
          </p>
        )}
      </Section>

      {/* Executive summary */}
      <Section title="executive summary" icon={Zap} iconColor="text-amber-400">
        <p className="text-sm leading-relaxed text-ink-200">{intel.summary}</p>
        {intel.whyBito.length > 0 && (
          <ol className="mt-4 space-y-3 border-t border-ink-700 pt-4">
            {intel.whyBito.map((reason, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neon-600/30 bg-neon-500/10 font-mono text-xs font-semibold text-neon-300">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-ink-300">{reason}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* Stakeholder map */}
      <Section title="stakeholder map" icon={Users} iconColor="text-sky-400">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-amber-400/90">
              feels the pain
            </p>
            <div className="space-y-3">
              {painSide.length === 0 ? (
                <p className="text-xs text-ink-500">None surfaced.</p>
              ) : (
                painSide.map((s, i) => (
                  <StakeholderCard key={i} s={s} company={intel.name} />
                ))
              )}
            </div>
          </div>
          <div>
            <p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neon-400/90">
              signs / gates the deal
            </p>
            <div className="space-y-3">
              {signSide.length === 0 ? (
                <p className="text-xs text-ink-500">None surfaced.</p>
              ) : (
                signSide.map((s, i) => (
                  <StakeholderCard key={i} s={s} company={intel.name} />
                ))
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* Token cost exposure */}
      <Section title="estimated token cost exposure" icon={Coins} iconColor="text-amber-400">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-400">est. monthly spend</p>
            <p className="mt-1 font-mono text-2xl font-bold text-amber-400">
              {intel.tokenCost.estimatedMonthlyUsd > 0
                ? fmtUSD(intel.tokenCost.estimatedMonthlyUsd)
                : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-400">est. ai-tool seats</p>
            <p className="mt-1 font-mono text-2xl font-bold text-ink-100">
              {intel.tokenCost.estimatedSeats > 0
                ? fmtNum(intel.tokenCost.estimatedSeats)
                : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-400">per seat / mo</p>
            <p className="mt-1 font-mono text-2xl font-bold text-ink-100">
              {intel.tokenCost.perSeatUsd > 0 ? fmtUSD(intel.tokenCost.perSeatUsd) : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-neon-600/30 bg-neon-500/5 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-neon-400/80">bito offset potential</p>
            <p className="mt-1 font-mono text-2xl font-bold text-neon-300">
              {intel.tokenCost.bitoOffsetUsd ? fmtUSD(intel.tokenCost.bitoOffsetUsd) : "—"}
            </p>
          </div>
        </div>
        {intel.tokenCost.notes && (
          <p className="mt-3 text-xs italic leading-relaxed text-ink-500">
            Estimate, not fact — assumptions: {intel.tokenCost.notes}
          </p>
        )}
      </Section>

      {/* Onboarding friction */}
      <Section title="onboarding friction" icon={GaugeCircle} iconColor={frictionColor}>
        <div className="flex flex-wrap items-center gap-4">
          <p className={`font-mono text-4xl font-bold leading-none ${frictionColor}`}>
            {friction.score}
            <span className="text-base font-medium text-ink-500">/99</span>
          </p>
          <span className={`rounded px-2 py-1 font-mono text-xs font-bold uppercase ${
            friction.level === "Low"
              ? "bg-neon-500/15 text-neon-300"
              : friction.level === "Medium"
                ? "bg-amber-500/15 text-amber-400"
                : "bg-red-500/15 text-red-400"
          }`}>
            {friction.level} friction
          </span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-red-400/80">
              drivers
            </p>
            <ul className="space-y-1.5 text-sm text-ink-300">
              {friction.drivers.map((d, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-red-400/70">▸</span> {d}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-neon-400/80">
              mitigations
            </p>
            <ul className="space-y-1.5 text-sm text-ink-300">
              {friction.mitigations.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-neon-400/70">▸</span> {m}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* Suggested motion */}
      <Section title="suggested motion" icon={Compass} iconColor="text-violet-400">
        <div className="flex flex-wrap items-center gap-3">
          <MotionBadge motion={intel.motion.primary} />
          <p className="text-sm text-ink-400">recommended GTM motion for this account</p>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-300">{intel.motion.reasoning}</p>
        {intel.motion.firstMove && (
          <p className="mt-3 rounded-lg border border-ink-700 bg-ink-950/60 p-3 text-sm leading-relaxed text-ink-200">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-violet-400">
              first move:{" "}
            </span>
            {intel.motion.firstMove}
          </p>
        )}
        {intel.motion.watchOuts.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-xs text-ink-400">
            {intel.motion.watchOuts.map((w, i) => (
              <li key={i} className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/70" />
                {w}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Outreach angle */}
      <Section title="outreach angle" icon={Send} iconColor="text-neon-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-[11px] font-semibold text-ink-300">
            {intel.outreach.channel}
          </span>
          <p className="text-sm font-semibold italic text-ink-100">
            &ldquo;{intel.outreach.hook}&rdquo;
          </p>
        </div>
        {intel.outreach.proof && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-400">
            <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-ink-500" />
            Backed by: {intel.outreach.proof}
          </p>
        )}
        {intel.outreach.draftMessage && (
          <div className="relative mt-3">
            <pre className="whitespace-pre-wrap rounded-lg border border-ink-700 bg-ink-950 p-4 font-mono text-[13px] leading-relaxed text-ink-200">
              {intel.outreach.draftMessage}
            </pre>
            <button
              onClick={copyDraft}
              className={`absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] font-medium transition-colors ${
                copyFailed ? "text-red-400" : "text-ink-400 hover:text-neon-300"
              }`}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copyFailed ? "copy failed — select manually" : copied ? "copied" : "copy"}
            </button>
          </div>
        )}
      </Section>

      {/* Pain points */}
      {intel.painPoints.length > 0 && (
        <Section title="likely pain points" icon={AlertTriangle} iconColor="text-amber-400">
          <div className="space-y-4">
            {intel.painPoints.map((p, i) => (
              <div key={i} className="border-l-2 border-neon-600/40 pl-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-ink-100">{p.title}</h4>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${SEVERITY_STYLE[p.severity]}`}>
                      {p.severity}
                    </span>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-medium text-ink-300">
                      {p.category}
                    </span>
                  </div>
                </div>
                {p.evidence && (
                  <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-400">
                    evidence: {p.evidence}
                  </p>
                )}
                <p className="mt-1.5 text-sm leading-relaxed text-ink-300">
                  <span className="font-semibold text-neon-300">Bito: </span>
                  {p.bitoSolution}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Competitive context */}
      {intel.competitors.length > 0 && (
        <Section title="competitive context" icon={Swords} iconColor="text-red-400">
          <div className="space-y-4">
            {intel.competitors.map((c, i) => (
              <div key={i} className="rounded-lg border border-ink-700 bg-ink-950/50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h4 className="text-sm font-bold text-ink-100">{c.name}</h4>
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">
                    {c.category}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-red-400/80">
                      their gap
                    </p>
                    <p className="text-xs leading-relaxed text-ink-400">{c.weakness}</p>
                  </div>
                  <div>
                    <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-neon-400/80">
                      bito advantage
                    </p>
                    <p className="text-xs leading-relaxed text-ink-400">{c.bitoAdvantage}</p>
                  </div>
                </div>
                {c.pitch && (
                  <p className="mt-3 border-t border-ink-700 pt-3 text-xs italic leading-relaxed text-ink-300">
                    &ldquo;{c.pitch}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Live enrichment — Apollo / Hunter / GitHub / Proxycurl / Crunchbase */}
      <EnrichmentPanel company={intel.name} domain={intel.domain} />

      {/* Sources */}
      {intel.citations.length > 0 && (
        <div className="rounded-lg border border-ink-700 bg-ink-900/50 p-4">
          <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
            live sources used
          </p>
          <div className="flex flex-wrap gap-2">
            {intel.citations.map((c) => (
              <a
                key={c.url}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                title={c.title}
                className="inline-flex max-w-xs items-center gap-1 truncate rounded border border-ink-700 bg-ink-950 px-2 py-1 text-[11px] text-ink-400 transition-colors hover:border-neon-600/40 hover:text-neon-300"
              >
                <span className="truncate">{c.title}</span>
                <ArrowUpRight className="h-3 w-3 shrink-0" />
              </a>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-600">
            This brief was generated live by claude-sonnet-4 with web search. Scores,
            cost figures and stakeholder mapping are model estimates grounded in the
            sources above — validate in discovery before quoting externally.
          </p>
        </div>
      )}
    </div>
  );
}
