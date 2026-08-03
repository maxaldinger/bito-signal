"use client";

import { useCallback, useEffect, useState } from "react";
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
  Mail,
  Phone,
  Loader2,
  Plus,
  Minimize2,
  type LucideIcon,
} from "lucide-react";

import type { CompanyIntel as Intel } from "@/lib/types";
import type { EnrichContact } from "@/lib/enrich/types";
import { emailStatusLabel, isSendableEmail, unsendableReason } from "@/lib/enrich/emailTrust";
import { TIER_RANK } from "@/lib/icpClassifier";
import { fmtUSD, fmtNum, fmtDate, stripEmDashes, stripMarkdown } from "@/lib/format";
import { HubSpotActions } from "./HubSpotActions";
import {
  useIsProspected,
  useProspectedAt,
  setDeepDiveScore,
  getReveal,
  mergeReveal,
} from "@/lib/clientStore";

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
    <section className="animate-fade-in rounded-lg border border-ink-700 bg-ink-900 p-4 sm:p-6">
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

// Pulls one heavy brief section on demand (keeps the default brief lean/cheap).
function ExpandButton({
  label,
  section,
  ctx,
  onData,
  subtle,
}: {
  label: string;
  section: string;
  ctx: { company: string; segment?: string; summary?: string };
  onData: (data: Record<string, unknown>) => void;
  subtle?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/intel/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ctx, section }),
      });
      const d = await res.json();
      if (d?.ok && d.data) onData(d.data);
      else setError(d?.error || "Couldn't load that — try again.");
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div>
      <button
        onClick={go}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 font-mono text-[11px] font-medium transition-colors disabled:opacity-60 ${
          subtle
            ? "border-ink-700 text-ink-400 hover:border-neon-600/40 hover:text-neon-300"
            : "border-ink-600 text-ink-300 hover:border-neon-600/50 hover:text-neon-300"
        }`}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        {loading ? "Pulling…" : label}
      </button>
      {error && <p className="mt-1.5 text-xs text-amber-400/90">{error}</p>}
    </div>
  );
}

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
  country?: string;
}

/** Tier badge colours. ANCHOR is the buyer, so it gets the strongest treatment;
 *  ROUTER is amber because it means "ask them who owns this", not "pitch them". */
const TIER_STYLE: Record<string, string> = {
  ANCHOR: "border border-neon-600/50 bg-neon-500/20 text-neon-200",
  TARGET: "border border-sky-500/40 bg-sky-500/15 text-sky-300",
  ROUTER: "border border-amber-500/40 bg-amber-500/15 text-amber-300",
  UNSCORED: "border border-ink-700 bg-ink-800 text-ink-400",
  PASS: "border border-ink-700 bg-ink-800 text-ink-500",
};

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
  /** The single most valuable signal as one glanceable sentence — "what I saw". */
  callHook: string;
  /** The 4-touch LinkedIn set (connect + 3 DMs), when the brief has it.
   * dm/resurface are legacy fields from briefs generated pre-restructure. */
  linkedin?: {
    connect: string;
    inmail?: { subject: string; body: string };
    followup2?: { subject: string; body: string };
    followup3?: { subject: string; body: string };
    /** Legacy pre-Aug-2026 fields. */
    dm1?: string;
    dm2?: string;
    dm3?: string;
    dm?: string;
    resurface?: string;
  };
  /** Signal-specific 1-2 sentence lead-in for above the templated email body. */
  emailOpener?: string;
  /** Legacy single outreach draft — fallback for briefs cached before linkedinOutreach. */
  outreach: string;
}

function ApolloPersonCard({
  person,
  company,
  domain,
  ctx,
  autoCheckDelayMs,
  hideWithoutEmail = true,
  showIcpBadge = true,
  unconfirmed = false,
}: {
  person: EnrichContact;
  company: string;
  domain?: string;
  ctx: ContactTaskContext;
  /** Stagger this card's auto HubSpot check (HubSpot search caps ~4 req/s). */
  autoCheckDelayMs: number;
  /** Remove the card entirely when the reveal finds no company-domain email
   *  (default). The pinned first-move contact opts out — it's named in the
   *  motion, so it stays visible and is worked via LinkedIn instead. */
  hideWithoutEmail?: boolean;
  /** Suppressed when every visible contact shares one classification — a badge
   *  that never varies is decoration, not information. */
  showIcpBadge?: boolean;
  /** No provider record backs this person (the name came from the brief's
   *  generated motion). Blocks the HubSpot push: creating a CRM record for an
   *  unverified name would write a possibly-fictional person into the CRM. */
  unconfirmed?: boolean;
}) {
  // One in-flight reveal kind at a time, per card.
  const [loading, setLoading] = useState<RevealKind | null>(null);
  const [result, setResult] = useState<Record<RevealKind, ApolloRevealPayload | undefined>>({
    email: undefined,
    phone: undefined,
  });
  // Apollo un-obfuscates the full name (and returns location) on reveal — swap
  // them in when they arrive, since the people SEARCH is too thin to include them.
  const [revealedName, setRevealedName] = useState<string | undefined>(undefined);
  const [revealedCountry, setRevealedCountry] = useState<string | undefined>(undefined);
  // Per-person connect note. The brief's linkedinOutreach.connect is written
  // once per COMPANY, so pushing it verbatim sends the same note to everyone in
  // the org — and misattributes it when the signal was one person's podcast or
  // talk. Generated on demand for this contact; falls back to the company note.
  const [personalConnect, setPersonalConnect] = useState<string | undefined>(undefined);
  const [connectLoading, setConnectLoading] = useState(false);

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
      if (data.ok) {
        if (data.name) setRevealedName(data.name);
        if (data.country) setRevealedCountry(data.country);
        // Cache by Apollo id so reopening the brief reuses it (no re-spend). Use
        // "" for an attempted-but-empty field so it reads as "tried, none found"
        // rather than "not yet tried" (which would re-reveal next time).
        if (person.apolloId) {
          const patch: {
            name?: string;
            email?: string;
            emailStatus?: string;
            phone?: string;
            country?: string;
          } = {};
          if (data.name) patch.name = data.name;
          if (data.country) patch.country = data.country;
          if (kind === "email") {
            patch.email = data.email ?? "";
            patch.emailStatus = data.emailStatus;
          } else {
            patch.phone = data.phone ?? "";
          }
          mergeReveal(person.apolloId, patch);
        }
      }
    } catch (e) {
      setResult((r) => ({
        ...r,
        [kind]: { ok: false, error: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setLoading(null);
    }
  };

  // Personalize the connect note for THIS contact. The brief writes one note
  // per company, so without this every person in the org receives the same
  // text, and any signal about a named individual ("your DX podcast") gets
  // misattributed to colleagues who had nothing to do with it. Staggered with
  // the reveal so a page of cards doesn't burst. Failure is silent — the
  // company-level note is a fine fallback.
  useEffect(() => {
    if (!ctx.callHook || !ctx.linkedin) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setConnectLoading(true);
      fetch("/api/outreach/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company,
          companyLine: ctx.companyLine,
          callHook: ctx.callHook,
          name: person.name,
          title: person.title,
          classification: person.icp?.classification,
        }),
      })
        .then((r) => r.json())
        .then((d: { ok?: boolean; connect?: string }) => {
          if (!cancelled && d.ok && d.connect) setPersonalConnect(d.connect);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setConnectLoading(false);
        });
    }, autoCheckDelayMs + 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // person.name/title are stable for a mounted card; ctx is rebuilt per render
    // so it is deliberately not a dependency (it would refire every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.apolloId, person.name, company, autoCheckDelayMs]);

  // Auto-reveal email on mount so names un-obfuscate and contact info is ready
  // without manual clicks. Phone is intentionally NOT auto-revealed: Apollo only
  // delivers phones async via webhook (we have none), so it always fails here —
  // phones are pulled via the Apollo Chrome extension once a contact's in the
  // CRM. Cached per Apollo id (reopening reuses it) and staggered for rate limits.
  useEffect(() => {
    const id = person.apolloId;
    if (!id) return;
    let cancelled = false;
    const cached = getReveal(id);
    if (cached?.name) setRevealedName(cached.name);
    if (cached?.country) setRevealedCountry(cached.country);
    if (cached?.email !== undefined)
      setResult((r) => ({
        ...r,
        email: { ok: true, email: cached.email, emailStatus: cached.emailStatus, name: cached.name },
      }));

    if (cached?.email !== undefined) return; // already revealed/attempted

    const t = setTimeout(() => {
      if (!cancelled) void reveal("email");
    }, autoCheckDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.apolloId]);

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
        `Write a short cold outreach email from a Bito sales rep to ${who} (${role}) at ${company}. ` +
        `Address them by first name only. Tie it to Bito AI Architect's value (the context layer that grounds their AI coding tools and reviews in their real cross-repo codebase) for an engineering team. ` +
        `Output ONLY the email: a "Subject:" line, then the body (under 120 words, one clear CTA). ` +
        `Plain text only — NO markdown, asterisks, bold, headings, or "---" separators. ` +
        `Do NOT add any notes, caveats, or commentary to the rep, and no placeholders like [Your name]. ` +
        `Don't invent facts; if you can't verify a detail, just leave it out. ` +
        `Use plain punctuation only — no em or en dashes.`;
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
          ? { text: data.text ? stripEmDashes(stripMarkdown(data.text)) : data.text }
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
  // Location: the people SEARCH is too thin to include it, so prefer the value
  // the reveal returned (or its cache) and fall back to whatever search gave us.
  const displayCountry = revealedCountry || person.country;
  const liQuery = `${company} ${revealedName || person.title || ""}`.trim();
  const linkedinHref =
    person.linkedinUrl ||
    `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(liQuery)}`;
  const emailRes = result.email;
  const phoneRes = result.phone;
  const contactProspected = useIsProspected("contact", person.apolloId || displayName);

  // Only a COMPANY-domain email is usable — a personal/off-domain one would
  // mis-associate the contact in HubSpot, so we treat it as "none surfaced".
  const rootOf = (d?: string) => {
    if (!d) return "";
    const p = d.toLowerCase().trim().replace(/^www\./, "").split(".").filter(Boolean);
    return p.length <= 2 ? p.join(".") : p.slice(-2).join(".");
  };
  const revealedEmail = emailRes?.ok && emailRes.email ? emailRes.email : undefined;
  const onCompanyDomain =
    !!revealedEmail && !!domain && rootOf(revealedEmail.split("@")[1]) === rootOf(domain);
  // TWO independent gates. The domain check stops mis-association; the STATUS
  // check stops hard bounces. Only Apollo's "verified" is sendable — an
  // unrecognized or missing status means "unknown", and unknown must never be
  // treated as safe to send. Apollo's reveal can return guessed/extrapolated
  // addresses, which is what was bouncing.
  const emailSendable = onCompanyDomain && isSendableEmail(emailRes?.emailStatus);
  /** Safe to send AND safe to write to the CRM. */
  const companyEmail = emailSendable ? revealedEmail : undefined;
  /** On-domain but NOT verified: shown for research, never used for outreach. */
  const unverifiedEmail = onCompanyDomain && !emailSendable ? revealedEmail : undefined;
  const emailChecked = emailRes !== undefined; // reveal finished (found or not)

  // Hide only when Apollo surfaced NO usable address at all. A contact whose
  // address exists but is not verified stays visible: they are still workable
  // by LinkedIn, and hiding them was gutting the list (BlackRock showed 3 of
  // ~60 engineering leaders). The email itself is still withheld from outreach
  // — see `unverifiedEmail` above, which renders amber and never as a mailto.
  if (hideWithoutEmail && emailChecked && !companyEmail && !unverifiedEmail) return null;

  return (
    <div
      className={`rounded-lg border bg-ink-950/50 p-4 ${
        contactProspected ? "border-orange-500/50 ring-1 ring-orange-500/30" : "border-ink-700"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="min-w-0 truncate text-sm font-semibold text-ink-100">{displayName}</h4>
        <div className="flex shrink-0 items-center gap-1.5">
          {contactProspected && (
            <span
              title="Already prospected — a HubSpot task has been created for this contact"
              className="inline-flex items-center gap-1 rounded-md border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-orange-200"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neon-500 text-ink-950">
                <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
              </span>
              In HubSpot
            </span>
          )}
          {person.icp && showIcpBadge && (
            <span
              title={`${person.icp.reason}${person.icp.recommendedAction ? ` · ${person.icp.recommendedAction}` : ""} (confidence: ${person.icp.confidence})`}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${
                TIER_STYLE[person.icp.classification] ?? TIER_STYLE.UNSCORED
              }`}
            >
              {person.icp.classification.toLowerCase()}
            </span>
          )}
          {person.seniority && (
            <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-ink-300">
              {person.seniority.replace(/_/g, " ")}
            </span>
          )}
        </div>
      </div>
      {(person.title || displayCountry) && (
        <p className="mt-1 text-xs text-ink-400">
          {person.title}
          {person.title && displayCountry ? " · " : ""}
          {displayCountry && <span className="text-ink-500">{displayCountry}</span>}
        </p>
      )}
      {person.icp && (
        <p className="mt-1 text-[11px] leading-snug text-ink-500">
          {person.icp.reason}
          {person.icp.confidence === "low" && (
            <span className="ml-1 text-amber-400/80">(low confidence)</span>
          )}
        </p>
      )}

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
              <pre className="whitespace-pre-wrap break-words rounded-lg border border-ink-700 bg-ink-950 p-3 pr-16 font-mono text-[12px] leading-relaxed text-ink-200">
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

      {/* Contact email — only a COMPANY-domain address is shown/usable; if Apollo
          only has a personal/off-domain one (or none), say so plainly rather than
          surface an address that would mis-associate the contact. */}
      {(companyEmail || unverifiedEmail || emailChecked || (phoneRes?.ok && phoneRes.phone)) && (
        <div className="mt-2 space-y-1 font-mono text-[11px]">
          {companyEmail ? (
            <p className="flex items-center gap-1.5 text-ink-200">
              <Mail className="h-3 w-3 text-sky-400" />
              <a href={`mailto:${companyEmail}`} className="break-all hover:text-sky-300">
                {companyEmail}
              </a>
              <span className="text-[10px] text-neon-400">(verified)</span>
            </p>
          ) : unverifiedEmail ? (
            // Deliberately NOT a mailto: an unverified address is research
            // material, not a send target. Amber and explicit, because the old
            // 10px grey parenthetical was easy to read straight past.
            <p className="flex flex-wrap items-center gap-1.5 text-ink-400">
              <Mail className="h-3 w-3 text-amber-400" />
              <span className="break-all">{unverifiedEmail}</span>
              <span
                title={unsendableReason(emailRes?.emailStatus)}
                className="rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
              >
                {emailStatusLabel(emailRes?.emailStatus)} — do not send
              </span>
            </p>
          ) : emailChecked ? (
            // Red: no email is a dead end for this contact, not a footnote.
            <p className="flex items-center gap-1.5 font-semibold text-red-400">
              <Mail className="h-3 w-3" /> No company email surfaced
            </p>
          ) : null}
          {phoneRes?.ok && phoneRes.phone && (
            <p className="flex items-center gap-1.5 text-ink-200">
              <Phone className="h-3 w-3 text-violet-400" />
              <a href={`tel:${phoneRes.phone}`} className="hover:text-violet-300">
                {phoneRes.phone}
              </a>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-ink-800 pt-3">
        {unconfirmed ? (
          // Pushing here would CREATE a HubSpot contact from a name only the
          // brief's model has asserted. Verify the person exists first; the
          // grid cards below are provider-backed and push normally.
          <p className="font-mono text-[11px] leading-snug text-amber-300/90">
            HubSpot push disabled — confirm this person exists before creating a CRM
            record for them.
          </p>
        ) : (
        <HubSpotActions
          kind="contact"
          name={displayName}
          apolloId={person.apolloId}
          email={companyEmail}
          phone={phoneRes?.ok ? phoneRes.phone : undefined}
          jobtitle={person.title}
          companyName={company}
          companyDomain={domain}
          compact
          autoCheck
          autoCheckDelayMs={autoCheckDelayMs}
          defaultSubject={`SIGNAL DASH - ${company} - ${displayName.split(" ")[0]}`}
          defaultBody={
            // LinkedIn-workflow note: COMPANY → WHAT I SAW → EMAIL OPENER →
            // PROFILE → LINKEDIN OUTREACH (CONNECT + 3 DMs). No WHO (the task's
            // contact record carries it natively) and no SIGNAL (redundant with
            // WHAT I SAW). No cadence-tracking text — Max schedules follow-ups
            // himself. The EMAIL OPENER is a signal-specific lead-in pasted
            // above the templated email body, angled differently from the
            // LinkedIn connect note so a prospect on both channels never sees
            // the same observation twice.
            `COMPANY: ${ctx.companyLine}\n` +
            // WHAT I SAW must be traceable to a real artifact. When the brief
            // produced no signal, say so rather than letting the next section
            // imply one existed.
            `\nWHAT I SAW: ${ctx.callHook || "No specific signal, sourced on fit only."}\n` +
            // PROFILE is a real profile URL or the word UNRESOLVED. Never a
            // search URL: a search link in a task note reads as a resolved
            // contact and is not one.
            `\nPROFILE: ${person.linkedinUrl || "UNRESOLVED"}\n` +
            `\n---\n\n` +
            (() => {
              const li = ctx.linkedin;
              if (!li)
                return `${draft?.text || ctx.outreach || "—"}\n\n(Update the brief to generate the outreach set.)`;
              // Per-person connect when it generated, else the company-level one.
              const connect = stripEmDashes(personalConnect || li.connect);
              const parts = [`CONNECT (${connect.length} chars):\n${connect}`];
              const block = (
                label: string,
                m?: { subject: string; body: string },
              ) => {
                if (!m?.body) return;
                parts.push(
                  `${label}\n${m.subject ? `Subject: ${m.subject}\n\n` : ""}${stripEmDashes(m.body)}`,
                );
              };
              block("INMAIL", li.inmail);
              block("FOLLOW-UP 2 (send +5 business days if no reply)", li.followup2);
              block("FOLLOW-UP 3 (send +10 business days if no reply)", li.followup3);
              // Briefs generated before the Aug 2026 restructure have no
              // subjects; render what they do have rather than dropping it.
              if (!li.inmail && (li.dm1 || li.dm)) {
                if (li.dm1) parts.push(`1. ${stripEmDashes(li.dm1)}`);
                if (li.dm2) parts.push(`2. ${stripEmDashes(li.dm2)}`);
                if (li.dm3) parts.push(`3. ${stripEmDashes(li.dm3)}`);
                if (li.dm) parts.push(`1. ${stripEmDashes(li.dm)}`);
                if (li.resurface) parts.push(`2. ${stripEmDashes(li.resurface)}`);
                parts.push("(Update the brief to regenerate with subjects and follow-ups.)");
              }
              return parts.join("\n\n---\n\n");
            })()
          }
        />
        )}
      </div>
    </div>
  );
}

interface ApolloPeopleResponse {
  ok: boolean;
  error?: string;
  orgName?: string;
  people: EnrichContact[];
  hasMore?: boolean;
  pinned?: EnrichContact;
}

// How many to show per column, and how many more each "pull more" adds. 4 per
// column = an 8-person, 50/50 map; the rest stay in the pool until pulled.
const PER_COLUMN_STEP = 4;

// Drives the stakeholder map from Apollo's live people-by-title search (real
// people + ids), replacing the model's invented roles. Shows a small balanced
// set and lets the rep pull more (next Apollo page) on demand.
function ApolloStakeholders({
  company,
  domain,
  ctx,
  keyContact,
}: {
  company: string;
  domain?: string;
  ctx: ContactTaskContext;
  /** Person named in the suggested motion — pinned at the top of the list. */
  keyContact?: { name: string; title?: string };
}) {
  const [people, setPeople] = useState<EnrichContact[]>([]);
  const [pinned, setPinned] = useState<EnrichContact | null>(null);
  const [perColumn, setPerColumn] = useState(PER_COLUMN_STEP);
  const [pageFetched, setPageFetched] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pinName = keyContact?.name;

  // Fetch one page of people; append (pull more) or replace (initial load).
  // Dedupes by Apollo id so overlapping pages don't double-list a person. On the
  // initial load, also asks Apollo to look up the motion's named contact (pin).
  const fetchPage = useCallback(
    async (p: number, append: boolean): Promise<void> => {
      const params = new URLSearchParams({ company, page: String(p) });
      if (domain) params.set("domain", domain);
      if (!append && pinName) params.set("pin", pinName);
      // Forward the brief's signal so each contact's rationale can reference
      // what's actually happening at the account, not just their title.
      if (ctx.callHook) params.set("signal", ctx.callHook.slice(0, 600));
      const res = await fetch(`/api/enrich/apollo/people?${params.toString()}`);
      let body: ApolloPeopleResponse | { error?: string };
      try {
        body = await res.json();
      } catch {
        body = { error: `HTTP ${res.status} — ${res.statusText || "non-JSON response"}` };
      }
      if (!res.ok) {
        if (!append) setError((body as { error?: string }).error || `Apollo people lookup failed (${res.status})`);
        setHasMore(false);
        return;
      }
      const fresh = (body as ApolloPeopleResponse).people ?? [];
      setPeople((prev) => {
        if (!append) return fresh;
        const seen = new Set(prev.map((x) => x.apolloId || x.name));
        return [...prev, ...fresh.filter((x) => !seen.has(x.apolloId || x.name))];
      });
      if (!append) setPinned((body as ApolloPeopleResponse).pinned ?? null);
      setHasMore(Boolean((body as ApolloPeopleResponse).hasMore));
      setPageFetched(p);
    },
    // ctx.callHook only: ctx itself is rebuilt every render, which would make
    // fetchPage a new function each time and re-fire the effect that calls it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company, domain, pinName, ctx.callHook],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPeople([]);
    setPerColumn(PER_COLUMN_STEP);
    fetchPage(1, false).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

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

  const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // The motion's named contact, resolved in DESCENDING order of confidence:
  //   1. Apollo's dedicated lookup (findPinned) — a real record with an
  //      apolloId, so email/LinkedIn/HubSpot all work.
  //   2. The same person already in the main results — equally enriched. This
  //      case used to be the bug: the synthesized card below matched by name in
  //      isPinned() and EVICTED this fully-enriched record from the grid, so
  //      the screen showed the unreachable copy of a person we had complete
  //      data for.
  //   3. Nothing found — a bare card from the LLM's own name/title, which is
  //      UNCONFIRMED: nobody has verified this person exists at this company.
  const fromResults =
    !pinned && keyContact?.name
      ? people.find((p) => nameKey(p.name) === nameKey(keyContact.name!))
      : undefined;
  const pinnedContact: EnrichContact | undefined =
    pinned ??
    fromResults ??
    (keyContact?.name ? { name: keyContact.name, title: keyContact.title } : undefined);
  /** True when no provider record backs this person — the name came only from
   *  the brief's generated motion and was never corroborated. */
  const pinnedUnconfirmed = !pinned && !fromResults && !!pinnedContact;

  if (people.length === 0 && !pinnedContact) {
    return <p className="text-xs text-ink-500">No engineering stakeholders surfaced from Apollo.</p>;
  }
  const isPinned = (p: EnrichContact) =>
    !!pinnedContact &&
    ((!!p.apolloId && p.apolloId === pinnedContact.apolloId) ||
      nameKey(p.name) === nameKey(pinnedContact.name));

  // Drop the pinned person from the list so they're not shown twice.
  const rest = pinnedContact ? people.filter((p) => !isPinned(p)) : people;
  // Queue gate. The scorer decides: ANCHOR (owns the tooling decision), TARGET
  // (adjacent to it), ROUTER (can redirect you internally — worth one message
  // asking who owns dev tooling) and UNSCORED all reach the queue. Only PASS is
  // screened out, because "we could not tell" must never behave like a
  // rejection.
  //
  // A FAILED verdict is not a verdict at all. Treat it as "no verdict" so the
  // seniority heuristic decides, exactly as for briefs cached before the
  // scorer existed. Without this, a rate-limited batch reported "screened out
  // 36 of 36" and rendered an empty section — an outage indistinguishable from
  // a deliberate screening.
  const graded = (p: EnrichContact) => (p.icp && !p.icp.failed ? p.icp : undefined);
  const decisionMakers = rest.filter((p) => {
    const v = graded(p);
    return v ? v.classification !== "PASS" : isDecisionMaker(p);
  });
  const routers = rest.filter((p) => graded(p)?.classification === "ROUTER");
  const rejected = rest.filter((p) => graded(p)?.classification === "PASS");
  /** Profiles the classifier could not judge at all — surfaced separately so a
   *  classifier outage never masquerades as a screening decision. */
  const unclassified = rest.filter((p) => p.icp?.failed).length;

  // ORDERING. There was none — the list arrived in Apollo's raw return order,
  // so a contact you cannot reach could sit above one you can.
  //
  // What is knowable HERE is limited: the email is revealed per-card after
  // mount, so deliverability is not available at sort time. Sorting on it
  // later would make cards jump under the cursor as reveals land. So we rank
  // on what the search itself returns, and let the verified-email gate hide
  // the unreachable rather than merely demote them.
  const rank = (p: EnrichContact) => {
    // Tier dominates: ANCHOR owns the decision, TARGET is adjacent, ROUTER only
    // redirects, UNSCORED is unknown. Reachability breaks ties within a tier.
    let s = (TIER_RANK[p.icp?.classification ?? "UNSCORED"] ?? 3) * 100;
    if (p.apolloId) s -= 10; // no id means no email can ever be revealed
    if (p.linkedinUrl) s -= 5; // a resolved profile beats a name search
    if (p.icp?.confidence === "high") s -= 2;
    return s;
  };
  const ordered = [...decisionMakers].sort((a, b) => rank(a) - rank(b));
  const dmShown = ordered.slice(0, perColumn * 2);

  // BADGE. A tier label that never varies is decoration, not information, so
  // only show it when the visible set actually contains more than one tier.
  const badgeDiscriminates =
    new Set(dmShown.map((p) => p.icp?.classification).filter(Boolean)).size > 1;

  const poolHasMore = decisionMakers.length > perColumn * 2;
  const canPullMore = poolHasMore || hasMore;

  const pullMore = async () => {
    if (loadingMore) return;
    const shown = perColumn * 2;
    // Pool exhausted → fetch the next Apollo page and let it render into the
    // CURRENT window. Widening here as well would dump a whole page of cards at
    // once, and every card auto-reveals an email on mount.
    if (decisionMakers.length <= shown && hasMore) {
      setLoadingMore(true);
      await fetchPage(pageFetched + 1, true).finally(() => setLoadingMore(false));
      return;
    }
    setPerColumn(perColumn + PER_COLUMN_STEP);
  };

  return (
    <div className="space-y-4">
      {pinnedContact && (
        <div
          className={`rounded-lg border p-3 ${
            pinnedUnconfirmed
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-violet-500/30 bg-violet-500/5"
          }`}
        >
          {pinnedUnconfirmed ? (
            // The brief NAMED this person, but no provider record corroborates
            // them. Say that outright rather than presenting a generated name
            // with the same authority as an Apollo-backed contact.
            <div className="mb-3">
              <p className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
                <Compass className="h-3.5 w-3.5" /> first move — unconfirmed
              </p>
              <p className="mt-1 text-[11px] leading-snug text-ink-400">
                Named by the brief&rsquo;s suggested motion, but not found in Apollo for{" "}
                {company}. Treat the name as a lead to verify, not a contact: there is no
                record behind it, so no email, LinkedIn, or HubSpot link can be resolved.
              </p>
            </div>
          ) : (
            <p className="mb-3 flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-violet-300">
              <Compass className="h-3.5 w-3.5" /> first move — named in the suggested motion
            </p>
          )}
          <ApolloPersonCard
            person={pinnedContact}
            company={company}
            domain={domain}
            ctx={ctx}
            autoCheckDelayMs={0}
            hideWithoutEmail={false}
            unconfirmed={pinnedUnconfirmed}
          />
        </div>
      )}

      <div>
        <p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neon-400/90">
          signs / gates the deal
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          {dmShown.length === 0 ? (
            <p className="text-xs text-ink-500">
              No engineering leaders surfaced.
              {rejected.length > 0 &&
                ` Scored ${rejected.length} of ${rest.length} surfaced profiles as PASS (no connection to how code gets written).`}
              {unclassified > 0 && (
                <span className="text-amber-400/90">
                  {" "}
                  {unclassified} profile{unclassified === 1 ? "" : "s"} could not be scored (the
                  scorer errored, not a screening decision) — reload to retry.
                </span>
              )}
            </p>
          ) : (
            dmShown.map((p, i) => (
              <ApolloPersonCard
                key={p.apolloId || `dm-${i}`}
                person={p}
                company={company}
                domain={domain}
                ctx={ctx}
                autoCheckDelayMs={i * 300}
                showIcpBadge={badgeDiscriminates}
              />
            ))
          )}
        </div>
      </div>

      {/* ROUTERs used to live in a separate collapsed "account map". They now
          render as normal cards in the grid, ranked below ANCHOR and TARGET
          and badged amber, because the spec makes them actionable: worth one
          message asking who owns developer tooling. */}
      {routers.length > 0 && (
        <p className="font-mono text-[11px] text-ink-500">
          {routers.length} of these {routers.length === 1 ? "is a" : "are"} ROUTER
          {routers.length === 1 ? "" : "s"} — ask who owns developer tooling, don&rsquo;t pitch.
        </p>
      )}

      {canPullMore && (
        <div className="flex justify-center">
          <button
            onClick={pullMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-4 py-2 font-mono text-xs font-medium text-ink-300 transition-colors hover:border-neon-600/40 hover:text-neon-200 disabled:opacity-50"
          >
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
            {loadingMore ? "Pulling…" : "Pull more contacts"}
          </button>
        </div>
      )}
    </div>
  );
}

export function CompanyIntel({
  intel,
  onBack,
  onRefresh,
  onCollapse,
}: {
  intel: Intel;
  onBack: () => void;
  /** Force-regenerate this brief (bypasses the cache). */
  onRefresh?: () => void;
  /** Collapse the whole record (card) to its slim row — card-attached briefs only. */
  onCollapse?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const companyProspected = useIsProspected("company", intel.name);
  const companyProspectedAt = useProspectedAt("company", intel.name);

  // On-demand sections: the brief now generates lean (summary / ICP / people /
  // motion + outreach). These heavier sections are pulled only when expanded.
  // Seed from the brief in case it already has them (older brief, or a prior
  // expand that persisted to the cache).
  const [whyBito, setWhyBito] = useState<string[]>(intel.whyBito ?? []);
  const [painPoints, setPainPoints] = useState(intel.painPoints ?? []);
  const [tokenCost, setTokenCost] = useState(
    intel.tokenCost && intel.tokenCost.estimatedMonthlyUsd > 0 ? intel.tokenCost : null,
  );
  const [motionDetail, setMotionDetail] = useState({
    reasoning: intel.motion.reasoning ?? "",
    watchOuts: intel.motion.watchOuts ?? [],
  });
  const expandCtx = { company: intel.name, segment: intel.segment?.label, summary: intel.summary };

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
    callHook: intel.callHook,
    linkedin: intel.linkedinOutreach,
    emailOpener: intel.emailOpener,
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
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-ink-400 transition-colors hover:text-ink-50"
          >
            <X className="h-4 w-4" /> Close brief
          </button>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse this record to a slim row (keeps its place in the feed)"
              className="inline-flex items-center gap-1.5 text-sm text-ink-400 transition-colors hover:text-ink-50"
            >
              <Minimize2 className="h-4 w-4" /> Collapse
            </button>
          )}
        </div>
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
          <h2 className="break-words text-2xl font-bold tracking-tight text-ink-50 sm:text-3xl">
            {intel.name}
          </h2>
          {intel.oneLiner ? (
            <p className="mt-1 text-sm text-ink-300">{intel.oneLiner}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {companyProspected && (
              <span
                title="Already prospected — a HubSpot task exists for this company or one of its contacts"
                className="inline-flex items-center gap-1.5 rounded-md border border-orange-500/40 bg-orange-500/15 px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wide text-orange-200"
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
        defaultSubject={`SIGNAL DASH - ${intel.name}`}
        defaultBody={
          `${intel.name} — ${intel.segment.label}` +
          `${intel.employeeBand ? `, ${intel.employeeBand} employees` : ""}` +
          `${intel.sweEstimate ? `, ~${fmtNum(intel.sweEstimate)} SWEs` : ""}.\n` +
          `${intel.oneLiner ? `${intel.oneLiner}\n` : ""}` +
          `${intel.callHook ? `\nWHAT I SAW: ${intel.callHook}\n` : ""}` +
          `\nBito ICP fit: ${intel.icp.total}/99. ${intel.summary}` +
          `${intel.whyBito.length ? `\n\nWhy Bito: ${intel.whyBito.slice(0, 2).join("; ")}` : ""}`
        }
      />

      {/* Executive summary — the single narrative for the account (the ICP
          rationale used to duplicate this, so it's dropped; the score lives in
          the breakdown below). */}
      <Section title="executive summary" icon={Zap} iconColor="text-amber-400">
        {intel.callHook && (
          <div className="mb-4 rounded-lg border-l-2 border-neon-500 bg-neon-500/[0.07] px-3.5 py-2.5">
            <p className="mb-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-neon-400">
              what i saw
            </p>
            <p className="text-[15px] font-medium leading-snug text-ink-100">{intel.callHook}</p>
          </div>
        )}
        <p className="text-sm leading-relaxed text-ink-200">{intel.summary}</p>
        <div className="mt-4 border-t border-ink-700 pt-4">
          {whyBito.length > 0 ? (
            <ol className="space-y-3">
              {whyBito.map((reason, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neon-600/30 bg-neon-500/10 font-mono text-xs font-semibold text-neon-300">
                    {i + 1}
                  </span>
                  <p className="text-sm leading-relaxed text-ink-300">{reason}</p>
                </li>
              ))}
            </ol>
          ) : (
            <ExpandButton
              label="Why Bito — pull the fit reasons"
              section="whyBito"
              ctx={expandCtx}
              onData={(d) => setWhyBito((d.whyBito as string[]) ?? [])}
            />
          )}
        </div>
      </Section>

      {/* ICP score breakdown — the quantified score behind the summary. */}
      <Section title="icp score breakdown" icon={Target} iconColor="text-neon-400">
        <div className="space-y-3">
          {ICP_BARS.map(({ key, label }) => {
            const v = intel.icp[key];
            const pct = Math.round((v / 20) * 100);
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-ink-300 sm:w-56 sm:text-sm">{label}</span>
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
      </Section>

      {/* Stakeholder map — real people, live from Apollo people search */}
      <Section
        title="suggested people to contact"
        icon={Users}
        iconColor="text-sky-400"
      >
        <ApolloStakeholders
          company={intel.name}
          domain={intel.domain}
          ctx={contactCtx}
          keyContact={
            intel.motion.keyContactName
              ? { name: intel.motion.keyContactName, title: intel.motion.keyContactTitle }
              : undefined
          }
        />
      </Section>

      {/* Motion + outreach — one box: how to approach, then the angle/message */}
      <Section title="suggested motion & outreach" icon={Compass} iconColor="text-violet-400">
        <div className="flex flex-wrap items-center gap-3">
          <MotionBadge motion={intel.motion.primary} />
          <p className="text-sm text-ink-400">recommended GTM motion for this account</p>
        </div>
        {intel.motion.firstMove && (
          <p className="mt-3 rounded-lg border border-ink-700 bg-ink-950/60 p-3 text-sm leading-relaxed text-ink-200">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-violet-400">
              first move:{" "}
            </span>
            {intel.motion.firstMove}
          </p>
        )}
        {/* Deeper motion analysis — pulled on demand to keep the brief lean. */}
        {motionDetail.reasoning ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-ink-300">{motionDetail.reasoning}</p>
            {motionDetail.watchOuts.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-xs text-ink-400">
                {motionDetail.watchOuts.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/70" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="mt-3">
            <ExpandButton
              label="Expand analysis — why this motion + watch-outs"
              section="motionDetail"
              ctx={expandCtx}
              subtle
              onData={(d) =>
                setMotionDetail({
                  reasoning: String(d.reasoning ?? ""),
                  watchOuts: (d.watchOuts as string[]) ?? [],
                })
              }
            />
          </div>
        )}

        {/* Outreach angle */}
        <div className="mt-5 border-t border-ink-700 pt-4">
          <p className="mb-3 flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neon-400/90">
            <Send className="h-3.5 w-3.5" /> outreach angle
          </p>
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
              <pre className="whitespace-pre-wrap break-words rounded-lg border border-ink-700 bg-ink-950 p-4 font-mono text-[13px] leading-relaxed text-ink-200">
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
        </div>
      </Section>

      {/* Token cost exposure — pulled on demand */}
      <Section title="estimated token cost exposure" icon={Coins} iconColor="text-amber-400">
        {tokenCost ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink-400">est. monthly spend</p>
                <p className="mt-1 font-mono text-2xl font-bold text-amber-400">
                  {tokenCost.estimatedMonthlyUsd > 0 ? fmtUSD(tokenCost.estimatedMonthlyUsd) : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink-400">est. ai-tool seats</p>
                <p className="mt-1 font-mono text-2xl font-bold text-ink-100">
                  {tokenCost.estimatedSeats > 0 ? fmtNum(tokenCost.estimatedSeats) : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink-400">per seat / mo</p>
                <p className="mt-1 font-mono text-2xl font-bold text-ink-100">
                  {tokenCost.perSeatUsd > 0 ? fmtUSD(tokenCost.perSeatUsd) : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-neon-600/30 bg-neon-500/5 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-neon-400/80">bito offset potential</p>
                <p className="mt-1 font-mono text-2xl font-bold text-neon-300">
                  {tokenCost.bitoOffsetUsd ? fmtUSD(tokenCost.bitoOffsetUsd) : "—"}
                </p>
              </div>
            </div>
            {tokenCost.notes && (
              <p className="mt-3 text-xs italic leading-relaxed text-ink-500">
                Estimate, not fact — assumptions: {tokenCost.notes}
              </p>
            )}
          </>
        ) : (
          <ExpandButton
            label="Estimate token-cost exposure"
            section="tokenCost"
            ctx={expandCtx}
            onData={(d) => setTokenCost((d.tokenCost as typeof tokenCost) ?? null)}
          />
        )}
      </Section>

      {/* Pain points — pulled on demand */}
      <Section title="likely pain points" icon={AlertTriangle} iconColor="text-amber-400">
        {painPoints.length > 0 ? (
          <div className="space-y-4">
            {painPoints.map((p, i) => (
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
        ) : (
          <ExpandButton
            label="Pull likely pain points"
            section="painPoints"
            ctx={expandCtx}
            onData={(d) => setPainPoints((d.painPoints as typeof painPoints) ?? [])}
          />
        )}
      </Section>

    </div>
  );
}
