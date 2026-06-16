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

// HUBSPOT_TOKEN may be either:
//   - a Private App access token ("pat-na1-…") — used directly as a Bearer; or
//   - a Personal Access Key (the CLI credential) — which is exchanged here for a
//     short-lived OAuth access token via HubSpot's local-dev auth endpoint.
const PAK_REFRESH_URL = "https://api.hubapi.com/localdevauth/v1/auth/refresh";
let accessTokenCache: { token: string; expiresAt: number } | undefined;

async function resolveAccessToken(): Promise<
  { ok: true; token: string } | { ok: false; configured: boolean; error: string }
> {
  const raw = process.env.HUBSPOT_TOKEN?.trim();
  if (!raw)
    return { ok: false, configured: false, error: "HUBSPOT_TOKEN not set — add it to .env.local / Vercel env" };

  // Private App token — usable as-is.
  if (raw.startsWith("pat-")) return { ok: true, token: raw };

  // Personal Access Key — exchange for a cached short-lived access token.
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expiresAt - 60_000 > now) {
    return { ok: true, token: accessTokenCache.token };
  }
  try {
    const res = await fetch(PAK_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ encodedOAuthRefreshToken: raw }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) {
      return { ok: false, configured: true, error: statusError(res.status, "personal-access-key exchange") };
    }
    const j = (await res.json()) as {
      oauthAccessToken?: string;
      expiresAtMillis?: number;
      hubId?: number;
    };
    if (!j.oauthAccessToken)
      return { ok: false, configured: true, error: "HubSpot PAK exchange returned no access token" };
    accessTokenCache = { token: j.oauthAccessToken, expiresAt: j.expiresAtMillis ?? now + 25 * 60_000 };
    // The exchange already tells us the portal — skip the account-info call.
    if (j.hubId && portalIdCache === undefined) portalIdCache = String(j.hubId);
    return { ok: true, token: j.oauthAccessToken };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      error: isTimeout(e) ? "HubSpot PAK exchange timed out" : "HubSpot PAK exchange failed",
    };
  }
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

function statusError(status: number, what: string): string {
  if (status === 401) return `HubSpot 401 on ${what} — HUBSPOT_TOKEN is invalid or expired`;
  if (status === 403)
    return `HubSpot 403 on ${what} — token is missing a required CRM write scope. A Personal Access Key (CLI key) can't be granted write scopes; use a Private App token (pat-na1-…) with companies/contacts/tasks read+write.`;
  if (status === 429) return `HubSpot 429 on ${what} — rate limited, retry shortly`;
  return `HubSpot HTTP ${status} on ${what}`;
}

async function hsFetch(
  path: string,
  init: { method: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown },
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

  const auth = await resolveAccessToken();
  if (!auth.ok) return fail(auth.configured, auth.error);
  const key = auth.token;

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

// HubSpot default association: Contact → Company (primary).
const CONTACT_TO_COMPANY = 279;

async function createObject(
  objType: "companies" | "contacts",
  properties: Record<string, string>,
  key: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { status, body } = await hsFetch(`/crm/v3/objects/${objType}`, { method: "POST", body: { properties } }, key);
  if (status !== 201 && status !== 200) return { ok: false, error: statusError(status, `create ${objType}`) };
  const id = (body as { id?: string } | undefined)?.id;
  return id ? { ok: true, id } : { ok: false, error: `HubSpot create ${objType} returned no id` };
}

// Best-effort field fill on an existing record — never throws, so enrichment
// failures don't block task creation.
async function patchObject(
  objType: "companies" | "contacts",
  id: string,
  properties: Record<string, string>,
  key: string
): Promise<void> {
  if (Object.keys(properties).length === 0) return;
  try {
    await hsFetch(`/crm/v3/objects/${objType}/${id}`, { method: "PATCH", body: { properties } }, key);
  } catch {
    /* non-fatal */
  }
}

async function associateDefault(
  fromType: string,
  fromId: string,
  toType: string,
  toId: string,
  key: string
): Promise<void> {
  try {
    await hsFetch(
      `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`,
      { method: "PUT" },
      key
    );
  } catch {
    /* non-fatal — the task still lands on the primary record */
  }
}

function contactProps(opts: { name?: string; email?: string; phone?: string; jobtitle?: string }): Record<string, string> {
  const p: Record<string, string> = {};
  if (opts.email) p.email = opts.email;
  if (opts.phone) p.phone = opts.phone;
  if (opts.jobtitle) p.jobtitle = opts.jobtitle;
  if (opts.name) {
    const [first, ...rest] = opts.name.split(" ");
    if (first) p.firstname = first;
    if (rest.length) p.lastname = rest.join(" ");
  }
  return p;
}

// Resolve (objectId → search → create) a company, returning its id + record.
async function resolveCompany(
  opts: { name?: string; domain?: string; objectId?: string },
  key: string
): Promise<{ ok: boolean; error?: string; id?: string; record?: HsRecord; created?: boolean }> {
  if (!opts.objectId && !opts.name && !opts.domain) return { ok: true }; // nothing to link
  if (opts.objectId) return { ok: true, id: opts.objectId, record: { id: opts.objectId, name: opts.name } };
  const search = await hubspotSearch("company", { name: opts.name, domain: opts.domain });
  if (!search.ok) return { ok: false, error: search.error };
  if (search.found) return { ok: true, id: search.records[0].id, record: search.records[0], created: false };
  const props: Record<string, string> = {};
  if (opts.name) props.name = opts.name;
  if (opts.domain) props.domain = opts.domain;
  const c = await createObject("companies", props, key);
  if (!c.ok || !c.id) return { ok: false, error: c.error };
  const pid = await portalId(key);
  return {
    ok: true,
    id: c.id,
    created: true,
    record: { id: c.id, name: opts.name, detail: opts.domain, url: recordUrl(pid, OBJ_COMPANY, c.id) },
  };
}

/**
 * Create a HubSpot task with a fully-populated CRM record behind it.
 *
 * For a contact: resolves/creates the parent company, resolves/creates the
 * contact while writing email + phone + job title into its standard fields
 * (filling them on an existing contact too), links the contact to the company,
 * then creates the task associated to BOTH the contact and the company.
 * For a company: resolves/creates the company and associates the task to it.
 * Records are never orphaned and never fabricated beyond the fields provided.
 */
export async function hubspotCreateTask(input: {
  kind: HsKind;
  objectId?: string;
  // contact fields
  name?: string;
  email?: string;
  phone?: string;
  jobtitle?: string;
  // company (linkage for a contact, or the target for a company task)
  companyName?: string;
  companyDomain?: string;
  companyObjectId?: string;
  // company-task target (kind === "company")
  domain?: string;
  // task
  subject: string;
  body: string;
  dueDateMs: number;
  taskType?: HsTaskType;
}): Promise<HsTaskResult> {
  const fail = (configured: boolean, error: string): HsTaskResult => ({ configured, ok: false, error });

  const auth = await resolveAccessToken();
  if (!auth.ok) return fail(auth.configured, auth.error);
  const key = auth.token;
  if (!input.subject?.trim()) return fail(true, "A task subject is required");
  if (!Number.isFinite(input.dueDateMs)) return fail(true, "A valid due date is required");

  // Association ids of the records this task should appear on.
  const taskAssociations: { id: string; typeId: number }[] = [];
  let primary: (HsRecord & { kind: HsKind; created: boolean }) | undefined;

  if (input.kind === "company") {
    const co = await resolveCompany(
      { name: input.name, domain: input.domain, objectId: input.objectId },
      key
    );
    if (!co.ok || !co.id) return fail(true, co.error || "Could not resolve the company in HubSpot");
    taskAssociations.push({ id: co.id, typeId: TASK_TO_COMPANY });
    primary = { ...(co.record as HsRecord), kind: "company", created: Boolean(co.created) };
  } else {
    // 1. Parent company (so the contact + task hang off it).
    const co = await resolveCompany(
      { name: input.companyName, domain: input.companyDomain, objectId: input.companyObjectId },
      key
    );
    if (!co.ok) return fail(true, co.error || "Could not resolve the parent company");

    // 2. Contact — find or create, then fill email/phone/jobtitle.
    let contactId = input.objectId;
    let contactRecord: HsRecord | undefined;
    let contactCreated = false;
    if (!contactId) {
      const search = await hubspotSearch("contact", { name: input.name, email: input.email });
      if (!search.ok) return fail(true, search.error || "HubSpot contact lookup failed");
      if (search.found) {
        contactId = search.records[0].id;
        contactRecord = search.records[0];
      }
    }
    if (contactId) {
      // Enrich an existing contact: set phone/jobtitle (and email only if we have
      // one and it's safe — HubSpot keys identity on email, so we never blank it).
      const patch: Record<string, string> = {};
      if (input.phone) patch.phone = input.phone;
      if (input.jobtitle) patch.jobtitle = input.jobtitle;
      await patchObject("contacts", contactId, patch, key);
    } else {
      const props = contactProps({
        name: input.name,
        email: input.email,
        phone: input.phone,
        jobtitle: input.jobtitle,
      });
      if (!props.email && !props.firstname) return fail(true, "Contact needs a name or email");
      const c = await createObject("contacts", props, key);
      if (!c.ok || !c.id) return fail(true, c.error || "Could not create the contact in HubSpot");
      contactId = c.id;
      contactCreated = true;
    }

    const pid = await portalId(key);
    contactRecord = contactRecord ?? {
      id: contactId,
      name: input.name,
      detail: input.email,
      url: recordUrl(pid, OBJ_CONTACT, contactId),
    };

    // 3. Link contact → company, and put the task on both records.
    if (co.id) {
      await associateDefault("contacts", contactId, "companies", co.id, key);
      taskAssociations.push({ id: co.id, typeId: TASK_TO_COMPANY });
    }
    taskAssociations.push({ id: contactId, typeId: TASK_TO_CONTACT });
    primary = { ...contactRecord, kind: "contact", created: contactCreated };
  }

  // Create the task, associated to every resolved record. Assign it to the rep
  // (HUBSPOT_OWNER_ID) so it lands in their "my tasks" queue — without an owner
  // the task is created unassigned and hidden from the default Tasks view.
  const ownerId = process.env.HUBSPOT_OWNER_ID?.trim();
  const payload = {
    properties: {
      hs_task_subject: input.subject.trim(),
      hs_task_body: input.body ?? "",
      hs_timestamp: input.dueDateMs,
      hs_task_status: "NOT_STARTED",
      hs_task_priority: "MEDIUM",
      hs_task_type: input.taskType ?? "CALL",
      ...(ownerId ? { hubspot_owner_id: ownerId } : {}),
    },
    associations: taskAssociations.map((a) => ({
      to: { id: a.id },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: a.typeId }],
    })),
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
    linkedTo: primary,
  };
}
