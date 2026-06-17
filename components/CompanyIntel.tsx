"use client";

import { useEffect, useState } from "react";
import {
  X,
  Target,
  Zap,
  AlertTriangle,
  Users,
  Coins,
  Compass,
  Send,
  Link2,
  ArrowUpRight,
  Copy,
  Check,
  RefreshCw,
  Boxes,
  Mail,
  Phone,
  Loader2,
  type LucideIcon,
} from "lucide-react";

// Rendered verbatim whenever the Kubernetes bonus signal is detected.
const K8S_NOTE =
  "K8s shops typically run 10+ services across multiple repos — high probability of agent context failure without live knowledge graph. Strong Bito fit.";
import type { CompanyIntel as Intel } from "@/lib/types";
import type { EnrichContact } from "@/lib/enrich/types";
import { fmtUSD, fmtNum, fmtDate, stripEmDashes } from "@/lib/format";
import { HubSpotActions } from "./HubSpotActions";
import { useIsProspected, useProspectedAt, setDeepDiveScore } from "@/lib/clientStore";

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

type RevealKind = "email" | "phone";

interface ApolloRevealResult {
  ok: boolean;
  error?: string;
  email?: string;
  emailStatus?: string;
  phone?: string;
}

interface ApolloRevealPayload extends ApolloRevealResult {
  name?: string;
}

// Apollo's `seniority` (or title, as a fallback) splits real contacts into the
// two columns the deep dive already uses: economic buyers vs. practitioners.
const DECISION_SENIORITY = new Set([
  "owner",
  "founder",
  "c_suite",
  "partner",
  "vp",
  "head",
  "director",
]);

function isDecisionMaker(c: EnrichContact): boolean {
  const sen = (c.seniority || "").toLowerCase();
  if (sen) return DECISION_SENIORITY.has(sen);
  const t = (c.title || "").toLowerCase();
  return /\b(cto|chief|vp|vice president|head|director)\b/.test(t);
}

// Company-level context woven into each contact's HubSpot task body.
interface ContactTaskContext {
  /** One-line company descriptor (segment, ICP, what they do). */
  companyLine: string;
  /** What the signal was — the synthesized exec summary. */
  signal: string;
  /** Suggested outreach to fall back on when no per-person draft exists. */
  outreach: string;
}

function ApolloPersonCard({
  person,
  company,
  domain,
  ctx,
  autoCheckDelayMs,
}: {
  person: EnrichContact;
  company: string;
  domain?: string;
  ctx: ContactTaskContext;
  /** Stagger this card's auto HubSpot check (HubSpot search caps ~4 req/s). */
  autoCheckDelayMs: number;
}) {
  // One in-flight reveal kind at a time, per card.
  const [loading, setLoading] = useState<RevealKind | null>(null);
  const [result, setResult] = useState<Record<RevealKind, ApolloRevealPayload | undefined>>({
    email: undefined,
    phone: undefined,
  });
  // Apollo un-obfuscates the full name on reveal — swap it in when it arrives.
  const [revealedName, setRevealedName] = useState<string | undefined>(undefined);

  const reveal = async (kind: RevealKind) => {
    if (loading) return;
    setLoading(kind);
    setResult((r) => ({ ...r, [kind]: undefined }));
    try {
      const params = new URLSearchParams({ reveal: kind });
      // Match by id (exact, un-obfuscated); fall back to name if id is missing.
      if (person.apolloId) {
        params.set("id", person.apolloId);
      } else {
        params.set("name", person.name);
        params.set("company", company);
        if (domain) params.set("domain", domain);
      }
      const res = await fetch(`/api/enrich/apollo/person?${params.toString()}`);
      let data: ApolloRevealPayload;
      try {
        data = (await res.json()) as ApolloRevealPayload;
      } catch {
        data = { ok: false, error: `HTTP ${res.status} — ${res.statusText || "bad response"}` };
      }
      setResult((r) => ({ ...r, [kind]: data }));
      if (data.ok && data.name) setRevealedName(data.name);
    } catch (e) {
      setResult((r) => ({
        ...r,
        [kind]: { ok: false, error: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setLoading(null);
    }
  };

  // Per-person cold email draft (AI assist).
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<{ text?: string; error?: string } | null>(null);
  const [draftCopied, setDraftCopied] = useState(false);

  const draftEmail = async () => {
    if (drafting) return;
    setDrafting(true);
    setDraft(null);
    setDraftCopied(false);
    try {
      const who = (revealedName || person.name).split(" ")[0];
      const role = person.title || "an engineering leader";
      const content =
        `Draft a short cold outreach email from a Bito sales rep to ${who} (${role}) at ${company}. ` +
        `Address them by first name only. Subject line + tight body under 120 words + one clear CTA. ` +
        `Tie it to Bito's AI code-review value for an engineering team. Don't invent specific facts about them. ` +
        `Use plain punctuation only — do NOT use em dashes or en dashes; use commas, periods, or parentheses.`;
      const res = await fetch("/api/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "ask", messages: [{ role: "user", content }] }),
      });
      let data: { text?: string; error?: string };
      try {
        data = await res.json();
      } catch {
        data = { error: `HTTP ${res.status} — ${res.statusText || "bad response"}` };
      }
      setDraft(
        res.ok
          ? { text: data.text ? stripEmDashes(data.text) : data.text }
          : { error: data.error || `Draft failed (${res.status})` },
      );
    } catch (e) {
      setDraft({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setDrafting(false);
    }
  };

  const copyDraftEmail = async () => {
    if (!draft?.text || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(draft.text);
      setDraftCopied(true);
      setTimeout(() => setDraftCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };

  const displayName = revealedName || person.name;
  const liQuery = `${company} ${revealedName || person.title || ""}`.trim();
  const emailRes = result.email;
  const phoneRes = result.phone;
  const contactProspected = useIsProspected("contact", person.apolloId || displayName);

  return (
    <div
      className={`rounded-lg border bg-ink-950/50 p-4 ${
        contactProspected ? "border-neon-500/50 ring-1 ring-neon-500/30" : "border-ink-700"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="min-w-0 truncate text-sm font-semibold text-ink-100">{displayName}</h4>
        <div className="flex shrink-0 items-center gap-1.5">
          {contactProspected && (
            <span
              title="Already prospected — a HubSpot task has been created for this contact"
              className="inline-flex items-center gap-1 rounded-md border border-neon-500/40 bg-neon-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-neon-200"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neon-500 text-ink-950">
                <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
              </span>
              In HubSpot
            </span>
          )}
          {person.seniority && (
            <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-ink-300">
              {person.seniority.replace(/_/g, " ")}
            </span>
          )}
        </div>
      </div>
      {person.title && <p className="mt-1 text-xs text-ink-400">{person.title}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={
            person.linkedinUrl ||
            `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(liQuery)}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-neon-400 hover:text-neon-300"
        >
          {person.linkedinUrl ? "LinkedIn" : "Find on LinkedIn"} <ArrowUpRight className="h-3 w-3" />
        </a>
        <button
          type="button"
          onClick={() => reveal("email")}
          disabled={loading !== null}
          title="Reveal a verified email for this person from Apollo (consumes a credit)"
          className="inline-flex items-center gap-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-300 transition-colors hover:border-sky-500/40 hover:text-sky-300 disabled:opacity-50"
        >
          {loading === "email" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Mail className="h-3 w-3" />
          )}
          Apollo email
        </button>
        <button
          type="button"
          onClick={() => reveal("phone")}
          disabled={loading !== null}
          title="Reveal a phone number for this person from Apollo (consumes a credit)"
          className="inline-flex items-center gap-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-300 transition-colors hover:border-violet-500/40 hover:text-violet-300 disabled:opacity-50"
        >
          {loading === "phone" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Phone className="h-3 w-3" />
          )}
          Apollo phone
        </button>
        <button
          type="button"
          onClick={draftEmail}
          disabled={drafting}
          title="Draft a personalized cold outreach email for this person (AI)"
          className="inline-flex items-center gap-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-300 transition-colors hover:border-neon-600/40 hover:text-neon-300 disabled:opacity-50"
        >
          {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Draft email
        </button>
      </div>

      {draft && (
        <div className="mt-2">
          {draft.error ? (
            <p className="font-mono text-[11px] text-amber-400/90">Draft: {draft.error}</p>
          ) : draft.text ? (
            <div className="relative">
              <pre className="whitespace-pre-wrap rounded-lg border border-ink-700 bg-ink-950 p-3 pr-16 font-mono text-[12px] leading-relaxed text-ink-200">
                {draft.text}
              </pre>
              <button
                onClick={copyDraftEmail}
                className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10px] font-medium text-ink-400 transition-colors hover:text-neon-300"
              >
                {draftCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {draftCopied ? "copied" : "copy"}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {(emailRes || phoneRes) && (
        <div className="mt-2 space-y-1 font-mono text-[11px]">
          {emailRes &&
            (emailRes.ok && emailRes.email ? (
              <p className="flex items-center gap-1.5 text-ink-200">
                <Mail className="h-3 w-3 text-sky-400" />
                <a href={`mailto:${emailRes.email}`} className="hover:text-sky-300">
                  {emailRes.email}
                </a>
                {emailRes.emailStatus && (
                  <span className="text-[10px] text-ink-500">({emailRes.emailStatus})</span>
                )}
              </p>
            ) : (
              <p className="text-amber-400/90">Email: {emailRes.error || "not found"}</p>
            ))}
          {phoneRes &&
            (phoneRes.ok && phoneRes.phone ? (
              <p className="flex items-center gap-1.5 text-ink-200">
                <Phone className="h-3 w-3 text-violet-400" />
                <a href={`tel:${phoneRes.phone}`} className="hover:text-violet-300">
                  {phoneRes.phone}
                </a>
              </p>
            ) : (
              <p className="text-amber-400/90">Phone: {phoneRes.error || "not found"}</p>
            ))}
        </div>
      )}

      <div className="mt-3 border-t border-ink-800 pt-3">
        <HubSpotActions
          kind="contact"
          name={displayName}
          apolloId={person.apolloId}
          email={emailRes?.ok ? emailRes.email : undefined}
          phone={phoneRes?.ok ? phoneRes.phone : undefined}
          jobtitle={person.title}
          companyName={company}
          companyDomain={domain}
          compact
          autoCheck
          autoCheckDelayMs={autoCheckDelayMs}
          defaultSubject={`Call ${displayName}${person.title ? ` (${person.title})` : ""} — ${company}`}
          defaultBody={
            `WHO: ${displayName}${person.title ? ` — ${person.title}` : ""}` +
            `${person.seniority ? ` (${person.seniority.replace(/_/g, " ")})` : ""} at ${company}\n` +
            `${emailRes?.ok && emailRes.email ? `Email: ${emailRes.email}\n` : ""}` +
            `${phoneRes?.ok && phoneRes.phone ? `Phone: ${phoneRes.phone}\n` : ""}` +
            `\nCOMPANY: ${ctx.companyLine}\n` +
            `\nSIGNAL: ${ctx.signal}\n` +
            `\nSUGGESTED OUTREACH:\n${draft?.text || ctx.outreach || "—"}`
          }
        />
      </div>
    </div>
  );
}

interface ApolloPeopleResponse {
  ok: boolean;
  error?: string;
  orgName?: string;
  people: EnrichContact[];
}

// Drives the stakeholder map from Apollo's live people-by-title search (real
// people + ids), replacing the model's invented roles.
function ApolloStakeholders({
  company,
  domain,
  ctx,
}: {
  company: string;
  domain?: string;
  ctx: ContactTaskContext;
}) {
  const [data, setData] = useState<ApolloPeopleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    const params = new URLSearchParams({ company });
    if (domain) params.set("domain", domain);

    fetch(`/api/enrich/apollo/people?${params.toString()}`)
      .then(async (res) => {
        let body: ApolloPeopleResponse | { error?: string };
        try {
          body = await res.json();
        } catch {
          body = { error: `HTTP ${res.status} — ${res.statusText || "non-JSON response"}` };
        }
        if (cancelled) return;
        if (!res.ok) {
          setError((body as { error?: string }).error || `Apollo people lookup failed (${res.status})`);
        } else {
          setData(body as ApolloPeopleResponse);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [company, domain]);

  if (loading) {
    return (
      <div className="space-y-3">
        <p className="font-mono text-xs text-sky-400">▸ searching Apollo for engineering stakeholders…</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data || data.people.length === 0) {
    return <p className="text-xs text-ink-500">No engineering stakeholders surfaced from Apollo.</p>;
  }

  const decisionMakers = data.people.filter(isDecisionMaker);
  const practitioners = data.people.filter((p) => !isDecisionMaker(p));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neon-400/90">
          signs / gates the deal
        </p>
        <div className="space-y-3">
          {decisionMakers.length === 0 ? (
            <p className="text-xs text-ink-500">None surfaced.</p>
          ) : (
            decisionMakers.map((p, i) => (
              <ApolloPersonCard
                key={p.apolloId || i}
                person={p}
                company={company}
                domain={domain}
                ctx={ctx}
                autoCheckDelayMs={i * 300}
              />
            ))
          )}
        </div>
      </div>
      <div>
        <p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-amber-400/90">
          feels the pain
        </p>
        <div className="space-y-3">
          {practitioners.length === 0 ? (
            <p className="text-xs text-ink-500">None surfaced.</p>
          ) : (
            practitioners.map((p, i) => (
              <ApolloPersonCard
                key={p.apolloId || i}
                person={p}
                company={company}
                domain={domain}
                ctx={ctx}
                autoCheckDelayMs={(decisionMakers.length + i) * 300}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function CompanyIntel({
  intel,
  onBack,
  onRefresh,
}: {
  intel: Intel;
  onBack: () => void;
  /** Force-regenerate this brief (bypasses the cache). */
  onRefresh?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const companyProspected = useIsProspected("company", intel.name);
  const companyProspectedAt = useProspectedAt("company", intel.name);

  // Cache this brief's authoritative ICP total so the signal cards can show it
  // instead of their rougher per-signal estimate.
  useEffect(() => {
    setDeepDiveScore(intel.name, intel.icp.total);
  }, [intel.name, intel.icp.total]);

  // Company-level context woven into each contact's HubSpot task.
  const contactCtx: ContactTaskContext = {
    companyLine:
      `${intel.name} — ${intel.segment.label}` +
      `${intel.employeeBand ? `, ${intel.employeeBand} employees` : ""}` +
      `${intel.sweEstimate ? `, ~${fmtNum(intel.sweEstimate)} SWEs` : ""}` +
      `. ICP fit ${intel.icp.total}/99.${intel.oneLiner ? ` ${intel.oneLiner}` : ""}`,
    signal: intel.summary,
    outreach: stripEmDashes(intel.outreach.draftMessage || intel.outreach.hook || ""),
  };

  const copyDraft = async () => {
    if (!navigator.clipboard) {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
      return;
    }
    try {
      await navigator.clipboard.writeText(stripEmDashes(intel.outreach.draftMessage));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
    }
  };

  return (
    <div className="space-y-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-ink-400 transition-colors hover:text-ink-50"
        >
          <X className="h-4 w-4" /> Close brief
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Re-run the live research and replace this cached brief"
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-1.5 font-mono text-xs font-medium text-ink-300 transition-colors hover:border-neon-600/40 hover:text-neon-300"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Update brief
          </button>
        )}
      </div>

      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight text-ink-50">{intel.name}</h2>
          {intel.oneLiner ? (
            <p className="mt-1 text-sm text-ink-300">{intel.oneLiner}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {companyProspected && (
              <span
                title="Already prospected — a HubSpot task exists for this company or one of its contacts"
                className="inline-flex items-center gap-1.5 rounded-md border border-neon-500/40 bg-neon-500/15 px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wide text-neon-200"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neon-500 text-ink-950">
                  <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
                </span>
                Prospected · sent to HubSpot{companyProspectedAt ? ` · ${fmtDate(companyProspectedAt)}` : ""}
              </span>
            )}
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
            generated {new Date(intel.generatedAt).toLocaleString("en-US")} · live web
            research · cached until updated
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

      {/* HubSpot — check the account / create a task with the signal context */}
      <HubSpotActions
        kind="company"
        name={intel.name}
        domain={intel.domain}
        autoCheck
        defaultSubject={`Prospect ${intel.name} — Bito Signal (ICP ${intel.icp.total}/99)`}
        defaultBody={
          `${intel.name} — ${intel.segment.label}` +
          `${intel.employeeBand ? `, ${intel.employeeBand} employees` : ""}` +
          `${intel.sweEstimate ? `, ~${fmtNum(intel.sweEstimate)} SWEs` : ""}.\n` +
          `${intel.oneLiner ? `${intel.oneLiner}\n` : ""}` +
          `\nBito ICP fit: ${intel.icp.total}/99. ${intel.summary}` +
          `${intel.whyBito.length ? `\n\nWhy Bito: ${intel.whyBito.slice(0, 2).join("; ")}` : ""}`
        }
      />

      {/* ICP breakdown */}
      <Section title="icp score breakdown" icon={Target} iconColor="text-neon-400">
        <div className="space-y-3">
          {ICP_BARS.map(({ key, label }) => {
            const v = intel.icp[key];
            const pct = Math.round((v / 20) * 100);
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-56 shrink-0 text-sm text-ink-300">{label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-600 to-neon-400"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 text-right font-mono text-sm font-semibold tabular-nums text-ink-200">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
        {intel.icp.kubernetes?.detected && (
          <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-sky-400">
                <Boxes className="h-4 w-4" />
                Kubernetes / Distributed Systems
              </span>
              <span className="rounded border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 font-mono text-xs font-bold text-sky-400">
                +{intel.icp.kubernetes.bonus} ICP bonus
              </span>
            </div>
            {intel.icp.kubernetes.evidence && (
              <p className="mt-2 font-mono text-xs leading-relaxed text-ink-300">
                evidence: {intel.icp.kubernetes.evidence}
              </p>
            )}
            <p className="mt-2 border-t border-sky-500/20 pt-2 text-xs leading-relaxed text-ink-300">
              {K8S_NOTE}
            </p>
          </div>
        )}
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

      {/* Stakeholder map — real people, live from Apollo people search */}
      <Section
        title="suggested people to contact"
        icon={Users}
        iconColor="text-sky-400"
      >
        <ApolloStakeholders company={intel.name} domain={intel.domain} ctx={contactCtx} />
      </Section>

      {/* Outreach angle — sits directly under the people to contact */}
      <Section title="outreach angle" icon={Send} iconColor="text-neon-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-[11px] font-semibold text-ink-300">
            {intel.outreach.channel}
          </span>
          <p className="text-sm font-semibold italic text-ink-100">
            &ldquo;{stripEmDashes(intel.outreach.hook)}&rdquo;
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
              {stripEmDashes(intel.outreach.draftMessage)}
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

    </div>
  );
}
