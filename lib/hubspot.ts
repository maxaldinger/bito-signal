// HubSpot CRM client — search companies/contacts and create tasks.
//
// Auth: a Private App access token in HUBSPOT_TOKEN (bearer). Create one at
// Settings → Integrations → Private Apps with these scopes:
//   crm.objects.companies.read, crm.objects.companies.write,
//   crm.objects.contacts.read,  crm.objects.contacts.write,
//   crm.objects.tasks.read,     crm.objects.tasks.write
//
// Project rule (shared with the enrichment layer): never fabricate data — every
// function returns either real HubSpot fields or an honest error.

const BASE = "https://api.hubapi.com";
const TIMEOUT_MS = 15_000;

// HubSpot CRM object type ids (for building record deep-links).
const OBJ_CONTACT = "0-1";
const OBJ_COMPANY = "0-2";
const OBJ_TASK = "0-27";

// HubSpot default association type ids (task → object).
const TASK_TO_CONTACT = 204;
const TASK_TO_COMPANY = 192;

export type HsKind = "company" | "contact";
export type HsTaskType = "CALL" | "EMAIL" | "TODO";

export interface HsRecord {
  id: string;
  name?: string;
  /** domain (company) or email (contact) when present. */
  detail?: string;
  url?: string;
}

export interface HsSearchResult {
  configured: boolean;
  ok: boolean;
  error?: string;
  found: boolean;
  /** All matches (capped); first is the best guess. */
  records: HsRecord[];
}

export interface HsTaskResult {
  configured: boolean;
  ok: boolean;
  error?: string;
  taskId?: string;
  taskUrl?: string;
  /** Which CRM record the task was linked to, and whether we had to create it. */
  linkedTo?: HsRecord & { kind: HsKind; created: boolean };
}

function token(): string | undefined {
  return process.env.HUBSPOT_TOKEN;
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

function statusError(status: number, what: string): string {
  if (status === 401) return `HubSpot 401 on ${what} — HUBSPOT_TOKEN is invalid or expired`;
  if (status === 403)
    return `HubSpot 403 on ${what} — the Private App is missing a required scope`;
  if (status === 429) return `HubSpot 429 on ${what} — rate limited, retry shortly`;
  return `HubSpot HTTP ${status} on ${what}`;
}

async function hsFetch(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  key: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

// portalId is needed to build app.hubspot.com record links. Fetched once and
// cached for the lifetime of the serverless instance.
let portalIdCache: string | null | undefined;
async function portalId(key: string): Promise<string | null> {
  if (portalIdCache !== undefined) return portalIdCache;
  try {
    const { status, body } = await hsFetch("/account-info/v3/details", { method: "GET" }, key);
    portalIdCache =
      status === 200 ? String((body as { portalId?: number })?.portalId ?? "") || null : null;
  } catch {
    portalIdCache = null;
  }
  return portalIdCache;
}

function recordUrl(pid: string | null, objType: string, id: string): string | undefined {
  return pid ? `https://app.hubspot.com/contacts/${pid}/record/${objType}/${id}` : undefined;
}

interface HsObject {
  id: string;
  properties?: Record<string, string | null | undefined>;
}

/** Search HubSpot for a company (by domain, else name) or contact (by email, else name). */
export async function hubspotSearch(
  kind: HsKind,
  opts: { name?: string; domain?: string; email?: string }
): Promise<HsSearchResult> {
  const fail = (configured: boolean, error: string): HsSearchResult => ({
    configured,
    ok: false,
    error,
    found: false,
    records: [],
  });

  const key = token();
  if (!key) return fail(false, "HUBSPOT_TOKEN not set — add it to .env.local / Vercel env");

  const objType = kind === "company" ? "companies" : "contacts";
  const properties =
    kind === "company"
      ? ["name", "domain", "website"]
      : ["firstname", "lastname", "email", "jobtitle"];

  // Exact filter when we have a strong key (domain/email); else full-text query.
  let payload: Record<string, unknown>;
  if (kind === "company" && opts.domain) {
    payload = {
      filterGroups: [
        { filters: [{ propertyName: "domain", operator: "EQ", value: opts.domain }] },
      ],
      properties,
      limit: 5,
    };
  } else if (kind === "contact" && opts.email) {
    payload = {
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: opts.email }] }],
      properties,
      limit: 5,
    };
  } else {
    const q = (kind === "company" ? opts.name : opts.name)?.trim();
    if (!q) return fail(true, `Provide a ${kind === "company" ? "company name/domain" : "contact name/email"}`);
    payload = { query: q, properties, limit: 5 };
  }

  let status: number;
  let body: unknown;
  try {
    ({ status, body } = await hsFetch(`/crm/v3/objects/${objType}/search`, { method: "POST", body: payload }, key));
  } catch (e) {
    return fail(true, isTimeout(e) ? "HubSpot search timed out after 15s" : "HubSpot search failed");
  }
  if (status !== 200) return fail(true, statusError(status, `${kind} search`));

  const results = (body as { results?: HsObject[] } | undefined)?.results ?? [];
  const pid = await portalId(key);
  const records: HsRecord[] = results.map((r) => {
    const p = r.properties ?? {};
    const name =
      kind === "company"
        ? p.name ?? undefined
        : [p.firstname, p.lastname].filter(Boolean).join(" ") || undefined;
    const detail = kind === "company" ? p.domain ?? p.website ?? undefined : p.email ?? undefined;
    return {
      id: r.id,
      name: name ?? undefined,
      detail: detail ?? undefined,
      url: recordUrl(pid, kind === "company" ? OBJ_COMPANY : OBJ_CONTACT, r.id),
    };
  });

  return { configured: true, ok: true, found: records.length > 0, records };
}

async function createRecord(
  kind: HsKind,
  opts: { name?: string; domain?: string; email?: string },
  key: string
): Promise<{ ok: boolean; record?: HsRecord; error?: string }> {
  const objType = kind === "company" ? "companies" : "contacts";
  let properties: Record<string, string>;
  if (kind === "company") {
    if (!opts.name && !opts.domain) return { ok: false, error: "company needs a name or domain" };
    properties = {};
    if (opts.name) properties.name = opts.name;
    if (opts.domain) properties.domain = opts.domain;
  } else {
    properties = {};
    if (opts.email) properties.email = opts.email;
    if (opts.name) {
      const [first, ...rest] = opts.name.split(" ");
      properties.firstname = first;
      if (rest.length) properties.lastname = rest.join(" ");
    }
    if (!properties.email && !properties.firstname)
      return { ok: false, error: "contact needs a name or email" };
  }

  const { status, body } = await hsFetch(`/crm/v3/objects/${objType}`, { method: "POST", body: { properties } }, key);
  if (status !== 201 && status !== 200) return { ok: false, error: statusError(status, `create ${kind}`) };
  const id = (body as { id?: string } | undefined)?.id;
  if (!id) return { ok: false, error: `HubSpot create ${kind} returned no id` };
  const pid = await portalId(key);
  return {
    ok: true,
    record: {
      id,
      name: opts.name,
      detail: kind === "company" ? opts.domain : opts.email,
      url: recordUrl(pid, kind === "company" ? OBJ_COMPANY : OBJ_CONTACT, id),
    },
  };
}

/**
 * Create a HubSpot task and associate it to the company/contact. Resolves the
 * record by `objectId` (from a prior search) or by searching; if still missing,
 * creates a minimal record so the task is never orphaned.
 */
export async function hubspotCreateTask(input: {
  kind: HsKind;
  objectId?: string;
  name?: string;
  domain?: string;
  email?: string;
  subject: string;
  body: string;
  dueDateMs: number;
  taskType?: HsTaskType;
}): Promise<HsTaskResult> {
  const fail = (configured: boolean, error: string): HsTaskResult => ({
    configured,
    ok: false,
    error,
  });

  const key = token();
  if (!key) return fail(false, "HUBSPOT_TOKEN not set — add it to .env.local / Vercel env");
  if (!input.subject?.trim()) return fail(true, "A task subject is required");
  if (!Number.isFinite(input.dueDateMs)) return fail(true, "A valid due date is required");

  // 1. Resolve the CRM record to associate the task with.
  let record: HsRecord | undefined;
  let created = false;
  if (input.objectId) {
    record = { id: input.objectId, name: input.name };
  } else {
    const search = await hubspotSearch(input.kind, {
      name: input.name,
      domain: input.domain,
      email: input.email,
    });
    if (!search.ok) return fail(true, search.error || "HubSpot lookup failed");
    if (search.found) {
      record = search.records[0];
    } else {
      const c = await createRecord(input.kind, { name: input.name, domain: input.domain, email: input.email }, key);
      if (!c.ok || !c.record) return fail(true, c.error || `Could not create ${input.kind} in HubSpot`);
      record = c.record;
      created = true;
    }
  }

  // 2. Create the task with the association.
  const typeId = input.kind === "company" ? TASK_TO_COMPANY : TASK_TO_CONTACT;
  const payload = {
    properties: {
      hs_task_subject: input.subject.trim(),
      hs_task_body: input.body ?? "",
      hs_timestamp: input.dueDateMs,
      hs_task_status: "NOT_STARTED",
      hs_task_priority: "MEDIUM",
      hs_task_type: input.taskType ?? "CALL",
    },
    associations: [
      {
        to: { id: record!.id },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }],
      },
    ],
  };

  let status: number;
  let body: unknown;
  try {
    ({ status, body } = await hsFetch("/crm/v3/objects/tasks", { method: "POST", body: payload }, key));
  } catch (e) {
    return fail(true, isTimeout(e) ? "HubSpot task create timed out after 15s" : "HubSpot task create failed");
  }
  if (status !== 201 && status !== 200) return fail(true, statusError(status, "create task"));

  const taskId = (body as { id?: string } | undefined)?.id;
  const pid = await portalId(key);
  return {
    configured: true,
    ok: true,
    taskId,
    taskUrl: taskId ? recordUrl(pid, OBJ_TASK, taskId) : undefined,
    linkedTo: record ? { ...record, kind: input.kind, created } : undefined,
  };
}
