"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  CalendarPlus,
  Loader2,
  Check,
  CircleCheck,
  CircleX,
  ArrowUpRight,
  X,
} from "lucide-react";
import {
  markProspected,
  setHubspotPresence,
  getLastDueDate,
  setLastDueDate,
} from "@/lib/clientStore";

type HsKind = "company" | "contact";
type HsTaskType = "CALL" | "EMAIL" | "TODO";

interface HsRecord {
  id: string;
  name?: string;
  detail?: string;
  url?: string;
}
interface SearchResp {
  ok: boolean;
  error?: string;
  found: boolean;
  records: HsRecord[];
  /** Present when full-text hits were discarded as name mismatches. */
  note?: string;
}
interface TaskResp {
  ok: boolean;
  error?: string;
  taskId?: string;
  taskUrl?: string;
  noteId?: string;
  noteError?: string;
  linkedTo?: HsRecord & { kind: HsKind; created: boolean };
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Serialize all HubSpot "Check" calls with a min gap so a busy feed (dozens of
// card + contact auto-checks) stays under HubSpot's ~4 req/s search limit and
// stops tripping 429s.
let hsSearchChain: Promise<unknown> = Promise.resolve();
let hsSearchLast = 0;
function throttledSearch(url: string): Promise<Response> {
  const run = async () => {
    const gap = 320 - (Date.now() - hsSearchLast);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    hsSearchLast = Date.now();
    return fetch(url);
  };
  const p = hsSearchChain.then(run, run);
  hsSearchChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p as Promise<Response>;
}

export function HubSpotActions({
  kind,
  name,
  domain,
  email,
  phone,
  jobtitle,
  apolloId,
  companyName,
  companyDomain,
  companyKey,
  defaultSubject,
  defaultBody,
  compact = false,
  autoCheck = false,
  autoCheckDelayMs = 0,
}: {
  kind: HsKind;
  name: string;
  domain?: string;
  email?: string;
  /** Contact extras pushed into the HubSpot record on task create. */
  phone?: string;
  jobtitle?: string;
  /** Apollo person id — lets the server reveal a missing email/phone. */
  apolloId?: string;
  /** Parent company for a contact (so the contact + task link to it). */
  companyName?: string;
  companyDomain?: string;
  /** The FEED's name for this account, used only as the client-store key for
   *  prospected marks and HubSpot presence. Never sent to HubSpot.
   *
   *  A brief renames the account to whatever the research turned up ("Elevance
   *  Health (formerly Anthem, Inc.)") while the card that opened it is still
   *  called "Anthem". Keying the mark off the brief's name wrote it somewhere
   *  the feed card could never read, so pushing a contact left the card grey. */
  companyKey?: string;
  defaultSubject: string;
  defaultBody: string;
  /** Smaller styling for use inside a contact card. */
  compact?: boolean;
  /** Run the HubSpot lookup automatically when the component populates. */
  autoCheck?: boolean;
  /** Stagger auto-checks to stay under HubSpot's ~4 req/s search limit. */
  autoCheckDelayMs?: number;
}) {
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<SearchResp | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // The matched record id (if any) is reused when creating the task.
  const matchedId = check?.found ? check.records[0]?.id : undefined;

  // Block pulling a contact whose email domain doesn't match its company —
  // Apollo sometimes returns a personal/old email and HubSpot would link the
  // contact to the wrong account.
  const rootOf = (d: string) => {
    const parts = d.toLowerCase().trim().replace(/^www\./, "").split(".").filter(Boolean);
    return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
  };
  const emailDomain = email ? email.split("@")[1] ?? "" : "";
  const domainMismatch =
    kind === "contact" &&
    !!emailDomain &&
    !!companyDomain &&
    rootOf(emailDomain) !== rootOf(companyDomain);
  // No company email surfaced — still pushable, but as a LinkedIn-connect task
  // (create the contact by name, log a to-do to connect on LinkedIn). Only an
  // OFF-DOMAIN email is blocked (it would mis-associate the contact). The card
  // passes only a company-domain email, so an empty `email` here means none.
  const noCompanyEmail = kind === "contact" && !email;
  const blockContact = domainMismatch; // off-domain only; missing email is allowed

  const runCheck = async () => {
    if (checking) return;
    setChecking(true);
    setCheck(null);
    try {
      const params = new URLSearchParams({ kind, name });
      if (domain) params.set("domain", domain);
      if (email) params.set("email", email);
      const res = await throttledSearch(`/api/hubspot/search?${params.toString()}`);
      let data: SearchResp;
      try {
        data = (await res.json()) as SearchResp;
      } catch {
        data = { ok: false, found: false, records: [], error: `HTTP ${res.status}` };
      }
      setCheck(data);
      // Share the live company result so the feed can sort by HubSpot presence.
      // NOTE: a check finding the record in HubSpot drives the green "In HubSpot"
      // line + presence sort — NOT the orange "Prospected" badge, which is
      // reserved for records THIS app created a task for. (Records can exist in
      // HubSpot from other reps/imports; those aren't "prospected by me".)
      if (kind === "company" && data.ok) setHubspotPresence(companyKey || name, data.found);
    } catch (e) {
      setCheck({ ok: false, found: false, records: [], error: e instanceof Error ? e.message : String(e) });
    } finally {
      setChecking(false);
    }
  };

  // Auto-check on populate. Staggered (autoCheckDelayMs) so a deep dive's dozen
  // contact cards don't fire at once and trip HubSpot's ~4 req/s search limit.
  // Re-runs when the name/email sharpens (e.g. after an Apollo reveal).
  useEffect(() => {
    if (!autoCheck || (!name && !domain && !email)) return;
    const t = setTimeout(() => void runCheck(), autoCheckDelayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck, autoCheckDelayMs, kind, name, domain, email]);

  const btn = compact
    ? "inline-flex items-center gap-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-300 transition-colors disabled:opacity-50"
    : "inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 font-mono text-xs font-medium text-ink-300 transition-colors disabled:opacity-50";

  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : ""}`}>
        <button
          type="button"
          onClick={runCheck}
          disabled={checking}
          title={`Check if this ${kind} already exists in your HubSpot CRM`}
          className={`${btn} hover:border-orange-500/40 hover:text-orange-300`}
        >
          {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Check in HubSpot
        </button>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={blockContact}
          title={
            domainMismatch
              ? `${email} isn't on the company domain — pushing would mis-associate this contact`
              : noCompanyEmail
                ? `No email found — the contact is created by name`
                : `Create a HubSpot task for this ${kind} with the signal context`
          }
          className={`${btn} hover:border-orange-500/40 hover:text-orange-300`}
        >
          <CalendarPlus className="h-3 w-3" />
          HubSpot task
        </button>

        {domainMismatch && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-amber-400/90">
            email domain ≠ company
          </span>
        )}

        {check && (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-[11px]">
            {check.error ? (
              <span className="break-words text-amber-400/90">{check.error}</span>
            ) : check.found ? (
              <a
                href={check.records[0]?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-neon-300 hover:text-neon-200"
              >
                <CircleCheck className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  In HubSpot: {check.records[0]?.name || check.records[0]?.detail || "record"}
                </span>
                <ArrowUpRight className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-ink-400"
                // When full-text hits were rejected as name mismatches, say so:
                // "not in HubSpot" and "HubSpot returned only wrong people" are
                // different facts, and the rep should be able to tell them apart.
                title={check?.note ? `${check.note} — searched "${name}"` : undefined}
              >
                <CircleX className="h-3.5 w-3.5" /> Not in HubSpot yet
                {check?.note && <span className="text-ink-500"> (no name match)</span>}
              </span>
            )}
          </span>
        )}
      </div>

      {modalOpen && (
        <TaskModal
          kind={kind}
          name={name}
          domain={domain}
          email={email}
          phone={phone}
          jobtitle={jobtitle}
          apolloId={apolloId}
          companyName={companyName}
          companyDomain={companyDomain}
          companyKey={companyKey}
          objectId={matchedId}
          defaultSubject={defaultSubject}
          defaultBody={defaultBody}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function TaskModal({
  kind,
  name,
  domain,
  email,
  phone,
  jobtitle,
  apolloId,
  companyName,
  companyDomain,
  companyKey,
  objectId,
  defaultSubject,
  defaultBody,
  onClose,
}: {
  kind: HsKind;
  name: string;
  domain?: string;
  email?: string;
  phone?: string;
  jobtitle?: string;
  apolloId?: string;
  companyName?: string;
  companyDomain?: string;
  companyKey?: string;
  objectId?: string;
  defaultSubject: string;
  defaultBody: string;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  // Earliest allowed due date is tomorrow (never same-day). Default to the last
  // date the rep picked (sticky across contacts), clamped to that floor.
  const minDue = tomorrowISO();
  const [due, setDue] = useState(() => {
    const last = getLastDueDate();
    return last && last >= minDue ? last : minDue;
  });
  // No email → it's a LinkedIn-connect to-do, not a call.
  const [taskType, setTaskType] = useState<HsTaskType>(kind === "contact" && !email ? "TODO" : "CALL");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TaskResp | null>(null);

  const submit = async () => {
    if (saving) return;
    // Never schedule same-day or in the past — floor at tomorrow.
    const dueDate = due >= minDue ? due : minDue;
    setLastDueDate(dueDate);
    // Schedule at local noon so the date lands as picked regardless of timezone.
    const dueDateMs = new Date(`${dueDate}T12:00:00`).getTime();
    if (!subject.trim() || !Number.isFinite(dueDateMs)) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/hubspot/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name,
          domain,
          email,
          phone,
          jobtitle,
          apolloId,
          companyName,
          companyDomain,
          objectId,
          subject,
          body,
          dueDateMs,
          taskType,
        }),
      });
      let data: TaskResp;
      try {
        data = (await res.json()) as TaskResp;
      } catch {
        data = { ok: false, error: `HTTP ${res.status}` };
      }
      setResult(data);
      // Mark prospected so the company/contact is badged across the UI. A
      // contact task also prospects its parent company.
      //
      // The company mark uses companyKey (the FEED's name for the account) when
      // the caller supplies one. `name`/`companyName` are the brief's names,
      // which the feed card cannot look itself up by.
      if (data.ok) {
        const acct = companyKey || (kind === "contact" ? companyName : name);
        markProspected(kind, kind === "contact" ? apolloId || name : acct || name);
        if (kind === "contact" && acct) markProspected("company", acct);
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  // Render through a portal to <body>: the modal lives inside the animated
  // (transformed) deep-dive section, which would otherwise be the containing
  // block for `fixed` — pinning the overlay to that section instead of the
  // viewport. The portal escapes it so it overlays the whole screen.
  const overlay = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-800 px-6 py-4">
          <h3 className="flex min-w-0 items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-ink-200">
            <CalendarPlus className="h-4 w-4 shrink-0 text-orange-400" />
            <span className="truncate">HubSpot task · {name}</span>
          </h3>
          <button onClick={onClose} className="shrink-0 text-ink-400 hover:text-ink-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body (scrolls if tall) */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {result?.ok ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-neon-300">
                <CircleCheck className="h-4 w-4 shrink-0" /> {result.noteId ? "Task + note created" : "Task created"}
                {result.linkedTo?.created
                  ? ` — new ${result.linkedTo.kind} added to HubSpot`
                  : result.linkedTo
                    ? ` — linked to existing ${result.linkedTo.kind}`
                    : ""}
              </p>
              {result.taskUrl && (
                <a
                  href={result.taskUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-neon-400 hover:text-neon-300"
                >
                  Open task in HubSpot <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
              {result.noteError && (
                <p className="text-xs text-amber-400/90">
                  Note not logged ({result.noteError}) — the task still landed.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">subject</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm text-ink-100 focus:border-orange-500/40 focus:outline-none"
                />
              </label>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">context / notes</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="mt-1 max-h-[45vh] min-h-[10rem] w-full resize-y rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm leading-relaxed text-ink-200 focus:border-orange-500/40 focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">due date</span>
                  <input
                    type="date"
                    value={due}
                    min={minDue}
                    onChange={(e) => {
                      const v = e.target.value && e.target.value >= minDue ? e.target.value : minDue;
                      setDue(v);
                      setLastDueDate(v);
                    }}
                    className="mt-1 block rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm text-ink-100 focus:border-orange-500/40 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">type</span>
                  <select
                    value={taskType}
                    onChange={(e) => setTaskType(e.target.value as HsTaskType)}
                    className="mt-1 block rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm text-ink-100 focus:border-orange-500/40 focus:outline-none"
                  >
                    <option value="CALL">Call</option>
                    <option value="TODO">To-do</option>
                    <option value="EMAIL">Email</option>
                  </select>
                </label>
              </div>

              {result?.error && <p className="text-xs text-amber-400/90">{result.error}</p>}
            </div>
          )}
        </div>

        {/* Footer (always visible) */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ink-800 px-6 py-4">
          {result?.ok ? (
            <button
              onClick={onClose}
              className="rounded-lg border border-ink-700 px-4 py-2 text-xs font-medium text-ink-300 hover:text-ink-100"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-ink-700 px-4 py-2 text-xs font-medium text-ink-400 hover:text-ink-100"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={saving || !subject.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-xs font-semibold text-orange-300 transition-colors hover:bg-orange-500/20 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Create task
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(overlay, document.body) : null;
}
