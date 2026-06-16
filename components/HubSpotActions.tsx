"use client";

import { useState } from "react";
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
import { markProspected } from "@/lib/clientStore";

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
}
interface TaskResp {
  ok: boolean;
  error?: string;
  taskId?: string;
  taskUrl?: string;
  linkedTo?: HsRecord & { kind: HsKind; created: boolean };
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
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
  defaultSubject,
  defaultBody,
  compact = false,
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
  defaultSubject: string;
  defaultBody: string;
  /** Smaller styling for use inside a contact card. */
  compact?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<SearchResp | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // The matched record id (if any) is reused when creating the task.
  const matchedId = check?.found ? check.records[0]?.id : undefined;

  const runCheck = async () => {
    if (checking) return;
    setChecking(true);
    setCheck(null);
    try {
      const params = new URLSearchParams({ kind, name });
      if (domain) params.set("domain", domain);
      if (email) params.set("email", email);
      const res = await fetch(`/api/hubspot/search?${params.toString()}`);
      let data: SearchResp;
      try {
        data = (await res.json()) as SearchResp;
      } catch {
        data = { ok: false, found: false, records: [], error: `HTTP ${res.status}` };
      }
      setCheck(data);
    } catch (e) {
      setCheck({ ok: false, found: false, records: [], error: e instanceof Error ? e.message : String(e) });
    } finally {
      setChecking(false);
    }
  };

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
          title={`Create a HubSpot task for this ${kind} with the signal context`}
          className={`${btn} hover:border-orange-500/40 hover:text-orange-300`}
        >
          <CalendarPlus className="h-3 w-3" />
          HubSpot task
        </button>

        {check && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px]">
            {check.error ? (
              <span className="text-amber-400/90">{check.error}</span>
            ) : check.found ? (
              <a
                href={check.records[0]?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-neon-300 hover:text-neon-200"
              >
                <CircleCheck className="h-3.5 w-3.5" />
                In HubSpot: {check.records[0]?.name || check.records[0]?.detail || "record"}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-ink-400">
                <CircleX className="h-3.5 w-3.5" /> Not in HubSpot yet
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
  objectId?: string;
  defaultSubject: string;
  defaultBody: string;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [due, setDue] = useState(tomorrowISO());
  const [taskType, setTaskType] = useState<HsTaskType>("CALL");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TaskResp | null>(null);

  const submit = async () => {
    if (saving) return;
    // Schedule at local noon so the date lands as picked regardless of timezone.
    const dueDateMs = new Date(`${due}T12:00:00`).getTime();
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
      if (data.ok) {
        markProspected(kind, kind === "contact" ? apolloId || name : name);
        if (kind === "contact" && companyName) markProspected("company", companyName);
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
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
                <CircleCheck className="h-4 w-4 shrink-0" /> Task created
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
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">context / notes</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="mt-1 max-h-[45vh] min-h-[10rem] w-full resize-y rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm leading-relaxed text-ink-200 focus:border-orange-500/40 focus:outline-none"
                />
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">due date</span>
                  <input
                    type="date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
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
}
