// Apollo.io enrichment client.
// Docs (verified 2026-06): https://docs.apollo.io/reference/organization-enrichment
//   - GET /api/v1/organizations/enrich (consumes credits)
//   - POST /api/v1/mixed_companies/search (org search by name)
//   - POST /api/v1/mixed_people/api_search (people search; MASTER api key required,
//     query-string params, returns no emails/phones — last names may be obfuscated
//     on lower plans). The old /mixed_people/search path 403s on most plans.
// Auth: x-api-key header.

import type { ApolloData, EnrichContact, ProviderResult } from "./types";
import { pickAiDevTools } from "./types";
import type { RegionId } from "../data";

const BASE = "https://api.apollo.io/api/v1";
const TIMEOUT_MS = 15_000;

interface ApolloOrg {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  linkedin_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  annual_revenue?: number;
  city?: string;
  state?: string;
  country?: string;
  total_funding?: number;
  latest_funding_stage?: string;
  latest_funding_round_date?: string;
  technology_names?: string[];
  current_technologies?: { name?: string }[];
}

interface ApolloPerson {
  id?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  last_name_obfuscated?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  email_status?: string | null;
  seniority?: string | null;
  departments?: string[] | null;
  country?: string | null;
}

// Engineering people we want on the stakeholder map — leaders (who sign/gate a
// deal) AND senior practitioners (who feel the pain). Kept broad so research- or
// ML-heavy orgs (whose titles are "ML/Research Engineer", not "VP Eng") still
// surface a full map, not one lone match. Apollo ORs these person_titles.
const ENG_TITLES = [
  // Leadership / decision-makers
  "CTO",
  "Chief Technology Officer",
  "Chief Information Officer",
  "VP of Engineering",
  "VP Engineering",
  "SVP Engineering",
  "Head of Engineering",
  "Head of Platform",
  "Head of Infrastructure",
  "Head of Machine Learning",
  "Director of Engineering",
  "Senior Director of Engineering",
  "Engineering Manager",
  "Senior Engineering Manager",
  // Senior practitioners / ICs
  "Principal Engineer",
  "Staff Engineer",
  "Senior Staff Engineer",
  "Lead Engineer",
  "Tech Lead",
  "Senior Software Engineer",
  "Machine Learning Engineer",
  "ML Engineer",
  "Research Engineer",
  "Research Scientist",
  "Platform Engineer",
  "Infrastructure Engineer",
  "Site Reliability Engineer",
  "DevOps Engineer",
];

function apiHeaders(key: string): Record<string, string> {
  return {
    "x-api-key": key,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Cache-Control": "no-cache",
  };
}

function statusError(status: number, what: string): string {
  if (status === 401) return `Apollo 401 on ${what} — APOLLO_API_KEY is invalid`;
  if (status === 403)
    return `Apollo 403 on ${what} — key lacks endpoint access or plan gate (people search requires a MASTER api key)`;
  if (status === 404) return `Apollo 404 on ${what} — company not found`;
  if (status === 422) return `Apollo 422 on ${what} — invalid/unmatchable company parameters`;
  if (status === 429) return `Apollo 429 on ${what} — rate limited, retry later`;
  return `Apollo HTTP ${status} on ${what}`;
}

async function apolloJson(
  url: string,
  key: string,
  method: "GET" | "POST"
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method,
    headers: apiHeaders(key),
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

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// Run async tasks with a fixed concurrency cap (avoids bursting rate limits).
async function runPooled<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function toContact(p: ApolloPerson): EnrichContact | undefined {
  const name =
    str(p.name) ??
    [str(p.first_name), str(p.last_name) ?? str(p.last_name_obfuscated)].filter(Boolean).join(" ");
  if (!name) return undefined;
  // Apollo search returns placeholder emails ("email_not_unlocked@...") until enriched — drop those.
  const rawEmail = str(p.email);
  const email =
    rawEmail && rawEmail.includes("@") && !rawEmail.startsWith("email_not_unlocked")
      ? rawEmail
      : undefined;
  return {
    name,
    apolloId: str(p.id),
    title: str(p.title),
    email,
    emailStatus: str(p.email_status),
    linkedinUrl: str(p.linkedin_url),
    seniority: str(p.seniority),
    department: Array.isArray(p.departments) ? str(p.departments[0]) : undefined,
    country: str(p.country),
  };
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function enrichApollo(
  company: string,
  domain?: string
): Promise<ProviderResult<ApolloData>> {
  const fail = (configured: boolean, error: string): ProviderResult<ApolloData> => ({
    provider: "apollo",
    configured,
    ok: false,
    error,
    fetchedAt: new Date().toISOString(),
  });

  const key = process.env.APOLLO_API_KEY;
  if (!key) return fail(false, "APOLLO_API_KEY not set — add it to .env.local / Vercel env");

  const notes: string[] = [];
  let org: ApolloOrg | undefined;

  try {
    if (domain) {
      const qs = new URLSearchParams({ domain });
      const { status, body } = await apolloJson(`${BASE}/organizations/enrich?${qs}`, key, "GET");
      if (status !== 200) return fail(true, statusError(status, "organization enrichment"));
      org = (body as { organization?: ApolloOrg } | undefined)?.organization;
      if (!org) return fail(true, `Apollo: company not found for domain "${domain}"`);
    } else {
      const qs = new URLSearchParams({ q_organization_name: company, page: "1", per_page: "10" });
      const { status, body } = await apolloJson(`${BASE}/mixed_companies/search?${qs}`, key, "POST");
      if (status !== 200) return fail(true, statusError(status, "organization search"));
      const orgs = (body as { organizations?: ApolloOrg[] } | undefined)?.organizations ?? [];
      if (orgs.length === 0) return fail(true, `Apollo: company not found by name "${company}"`);
      const exact = orgs.find((o) => normName(o.name ?? "") === normName(company));
      org = exact ?? orgs[0];
      if (!exact && orgs.length > 1)
        notes.push(`name search matched ${orgs.length} orgs; used first result "${org?.name ?? "?"}"`);
      // Search hits lack tech/funding detail — enrich the matched domain when we
      // have one. This refinement is optional: a throw here must not discard the
      // successful search record, so it gets its own try/catch.
      const matchedDomain = str(org?.primary_domain);
      if (matchedDomain) {
        try {
          const eqs = new URLSearchParams({ domain: matchedDomain });
          const enr = await apolloJson(`${BASE}/organizations/enrich?${eqs}`, key, "GET");
          const enriched = (enr.body as { organization?: ApolloOrg } | undefined)?.organization;
          if (enr.status === 200 && enriched) org = enriched;
          else notes.push(statusError(enr.status, "follow-up enrichment (kept search record)"));
        } catch (e) {
          notes.push(
            isTimeout(e)
              ? "follow-up enrichment timed out (kept search record)"
              : "follow-up enrichment failed (kept search record)",
          );
        }
      }
    }
  } catch (e) {
    if (isTimeout(e)) return fail(true, "Apollo organization lookup timed out after 15s");
    return fail(true, `Apollo organization lookup failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!org) return fail(true, "Apollo: company not found");

  let people: EnrichContact[] = [];
  try {
    const qs = new URLSearchParams({ page: "1", per_page: "10" });
    for (const t of ENG_TITLES) qs.append("person_titles[]", t);
    const orgId = str(org.id);
    const orgDomain = str(org.primary_domain) ?? (domain ? domain : undefined);
    if (orgId) qs.append("organization_ids[]", orgId);
    else if (orgDomain) qs.append("q_organization_domains_list[]", orgDomain);
    if (orgId || orgDomain) {
      const { status, body } = await apolloJson(`${BASE}/mixed_people/api_search?${qs}`, key, "POST");
      if (status === 200) {
        const b = body as { people?: ApolloPerson[]; contacts?: ApolloPerson[] } | undefined;
        const raw = [...(b?.people ?? []), ...(b?.contacts ?? [])].slice(0, 10);
        people = raw.map(toContact).filter((c): c is EnrichContact => c !== undefined);
      } else {
        notes.push(statusError(status, "people search"));
      }
    } else {
      notes.push("people search skipped — no org id or domain to filter on");
    }
  } catch (e) {
    notes.push(isTimeout(e) ? "people search timed out after 15s" : "people search failed");
  }

  const techStack = Array.from(
    new Set(
      org.technology_names ??
        (org.current_technologies ?? [])
          .map((t) => t.name)
          .filter((n): n is string => typeof n === "string" && n.length > 0)
    )
  );

  const data: ApolloData = {
    name: str(org.name),
    domain: str(org.primary_domain),
    websiteUrl: str(org.website_url),
    linkedinUrl: str(org.linkedin_url),
    industry: str(org.industry),
    estimatedEmployees: num(org.estimated_num_employees),
    annualRevenueUsd: num(org.annual_revenue),
    city: str(org.city),
    state: str(org.state),
    country: str(org.country),
    techStack,
    aiDevTools: pickAiDevTools(techStack),
    people,
    fundingTotalUsd: num(org.total_funding),
    latestFundingRound: str(org.latest_funding_stage),
    latestFundingDate: str(org.latest_funding_round_date),
  };

  return {
    provider: "apollo",
    configured: true,
    ok: true,
    error: notes.length > 0 ? notes.join("; ") : undefined,
    data,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Single-person contact reveal — used by the stakeholder cards to pull a
// verified email or a phone number for one named person on demand.
//
// Endpoint: POST /api/v1/people/match (consumes credits when reveal_* flags are
// set). Docs: https://docs.apollo.io/reference/people-enrichment
//   - reveal_personal_emails=true  → unlocks `email` / `personal_emails`
//   - reveal_phone_number=true     → unlocks `phone_numbers[]` (Apollo delivers
//     phone async via webhook on some plans; we surface whatever comes back
//     inline and report an honest note when nothing did).
// ---------------------------------------------------------------------------

export type RevealKind = "email" | "phone";

export interface ApolloPersonContact {
  configured: boolean;
  ok: boolean;
  error?: string;
  name?: string;
  title?: string;
  /** Populated for reveal "email". */
  email?: string;
  emailStatus?: string;
  /** Populated for reveal "phone". */
  phone?: string;
  linkedinUrl?: string;
}

interface ApolloPhoneNumber {
  raw_number?: string | null;
  sanitized_number?: string | null;
  type?: string | null;
}

interface ApolloMatchPerson extends ApolloPerson {
  personal_emails?: string[] | null;
  phone_numbers?: ApolloPhoneNumber[] | null;
  organization?: { phone?: string | null } | null;
}

/**
 * Reveal one contact field (email OR phone) for a single person.
 * @param opts.id  Apollo person id — the exact, reliable matcher (from a prior
 *   people search). Strongly preferred; name+company matching is a fuzzy fallback.
 * @param opts.name  Full name, used only when no id is available.
 * @param opts.company / opts.domain  Disambiguate the right person for name matching.
 * @param opts.linkedinUrl  Strong matcher when available.
 * @param opts.reveal  Which field to spend a credit unlocking.
 */
export async function apolloPersonContact(opts: {
  id?: string;
  name?: string;
  company?: string;
  domain?: string;
  linkedinUrl?: string;
  reveal: RevealKind;
}): Promise<ApolloPersonContact> {
  const fail = (configured: boolean, error: string): ApolloPersonContact => ({
    configured,
    ok: false,
    error,
  });

  const key = process.env.APOLLO_API_KEY;
  if (!key) return fail(false, "APOLLO_API_KEY not set — add it to .env.local / Vercel env");
  if (!opts.id && !opts.name)
    return fail(true, "An Apollo person id or name is required for a lookup");

  const qs = new URLSearchParams();
  if (opts.id) {
    // Exact match — no obfuscation, no wrong-person risk.
    qs.set("id", opts.id);
  } else {
    if (opts.name) qs.set("name", opts.name);
    if (opts.linkedinUrl) qs.set("linkedin_url", opts.linkedinUrl);
    if (opts.domain) qs.set("domain", opts.domain);
    if (opts.company) qs.set("organization_name", opts.company);
  }
  if (opts.reveal === "email") qs.set("reveal_personal_emails", "true");
  else qs.set("reveal_phone_number", "true");

  let status: number;
  let body: unknown;
  try {
    ({ status, body } = await apolloJson(`${BASE}/people/match?${qs}`, key, "POST"));
  } catch (e) {
    return fail(
      true,
      isTimeout(e) ? "Apollo people match timed out after 15s" : "Apollo people match failed"
    );
  }

  if (status !== 200) return fail(true, statusError(status, "people match"));

  const person = (body as { person?: ApolloMatchPerson } | undefined)?.person;
  if (!person)
    return fail(true, `Apollo: no person matched for "${opts.name ?? opts.id ?? "?"}"`);

  const fullName =
    str(person.name) ??
    [str(person.first_name), str(person.last_name)].filter(Boolean).join(" ");
  const base: ApolloPersonContact = {
    configured: true,
    ok: true,
    name: fullName || opts.name,
    title: str(person.title),
    linkedinUrl: str(person.linkedin_url),
  };

  if (opts.reveal === "email") {
    const raw =
      str(person.email) ??
      (Array.isArray(person.personal_emails) ? str(person.personal_emails[0]) : undefined);
    const email =
      raw && raw.includes("@") && !raw.startsWith("email_not_unlocked") ? raw : undefined;
    if (!email)
      return {
        ...base,
        ok: false,
        error: raw
          ? "Apollo returned a locked-email placeholder — you may be out of email credits"
          : "Apollo matched this person but has no email on file for them",
      };
    return { ...base, email, emailStatus: str(person.email_status) };
  }

  // reveal === "phone"
  const phones = Array.isArray(person.phone_numbers) ? person.phone_numbers : [];
  const phone =
    phones.map((p) => str(p?.sanitized_number) ?? str(p?.raw_number)).find(Boolean) ??
    str(person.organization?.phone);
  if (!phone)
    return {
      ...base,
      ok: false,
      error:
        "Apollo matched the person but returned no phone number (may be delivered async / plan-gated)",
    };
  return { ...base, phone };
}

// ---------------------------------------------------------------------------
// People-by-title search — free (no credits), returns REAL engineering leaders
// with stable Apollo ids. Last names arrive obfuscated ("Go***l") on every plan;
// the per-person reveal (apolloPersonContact by id) un-obfuscates on demand.
// This is what drives the stakeholder cards in a deep dive.
// ---------------------------------------------------------------------------

export interface ApolloPeopleResult {
  configured: boolean;
  ok: boolean;
  error?: string;
  /** Resolved org name Apollo matched (may differ from the query). */
  orgName?: string;
  people: EnrichContact[];
  /** Whether another page of people likely exists (for "pull more contacts"). */
  hasMore?: boolean;
}

/**
 * Find engineering-leadership people at a company by title. Resolves the org
 * from `domain` (preferred — direct, no extra call) or by `company` name.
 */
export async function apolloPeopleByTitle(
  company: string,
  domain?: string,
  page = 1
): Promise<ApolloPeopleResult> {
  const fail = (configured: boolean, error: string): ApolloPeopleResult => ({
    configured,
    ok: false,
    error,
    people: [],
  });

  const key = process.env.APOLLO_API_KEY;
  if (!key) return fail(false, "APOLLO_API_KEY not set — add it to .env.local / Vercel env");
  if (!company && !domain) return fail(true, "Pass a company name and/or domain");

  let orgId: string | undefined;
  let orgDomain = domain;
  let orgName: string | undefined;

  // Without a domain we must resolve the org by name to get a filter handle.
  if (!orgDomain) {
    try {
      const sq = new URLSearchParams({ q_organization_name: company, page: "1", per_page: "5" });
      const { status, body } = await apolloJson(`${BASE}/mixed_companies/search?${sq}`, key, "POST");
      if (status !== 200) return fail(true, statusError(status, "organization search"));
      const orgs =
        (body as { organizations?: ApolloOrg[]; accounts?: ApolloOrg[] } | undefined)
          ?.organizations ?? [];
      const exact = orgs.find((o) => normName(o.name ?? "") === normName(company)) ?? orgs[0];
      if (!exact) return fail(true, `Apollo: company not found by name "${company}"`);
      orgId = str(exact.id);
      orgDomain = str(exact.primary_domain);
      orgName = str(exact.name);
    } catch (e) {
      return fail(true, isTimeout(e) ? "Apollo org lookup timed out" : "Apollo org lookup failed");
    }
  }

  try {
    const perPage = 30;
    const qs = new URLSearchParams({
      page: String(Math.max(1, Math.min(100, page))),
      per_page: String(perPage),
    });
    for (const t of ENG_TITLES) qs.append("person_titles[]", t);
    if (orgId) qs.append("organization_ids[]", orgId);
    else if (orgDomain) qs.append("q_organization_domains_list[]", orgDomain);

    const { status, body } = await apolloJson(`${BASE}/mixed_people/api_search?${qs}`, key, "POST");
    if (status !== 200) return fail(true, statusError(status, "people search"));
    const b = body as { people?: ApolloPerson[]; contacts?: ApolloPerson[] } | undefined;
    const raw = [...(b?.people ?? []), ...(b?.contacts ?? [])];
    const hasMore = raw.length >= perPage;
    const people = raw.map(toContact).filter((c): c is EnrichContact => c !== undefined);
    if (people.length === 0)
      return {
        configured: true,
        ok: page <= 1 ? false : true,
        error: page <= 1 ? "No engineering leaders found" : undefined,
        orgName,
        people: [],
        hasMore: false,
      };
    return { configured: true, ok: true, orgName, people, hasMore };
  } catch (e) {
    return fail(true, isTimeout(e) ? "Apollo people search timed out" : "Apollo people search failed");
  }
}

// ---------------------------------------------------------------------------
// ICP sweep — org search as a *discovery* source for the signal feed.
// Filters verified against docs.apollo.io/reference/organization-search:
// organization_num_employees_ranges[] + q_organization_keyword_tags[].
// Search consumes no credits and returns thin-but-real org records.
// ---------------------------------------------------------------------------

export interface IcpSweepOrg {
  name: string;
  domain?: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  /** Which ICP keyword filter surfaced this org (e.g. "developer tools"). */
  matchedKeyword: string;
  /** The headcount filter band the org matched (e.g. "100-2000 employees"). */
  employeeBand: string;
  /** Apollo's per-org TOTAL employee estimate, when present (not SWE count). */
  estimatedEmployees?: number;
  /** Short "what the company does" blurb from Apollo, when present. */
  about?: string;
}

export interface IcpSweepResult {
  configured: boolean;
  ok: boolean;
  error?: string;
  orgs: IcpSweepOrg[];
}

// Account records returned by search are thin (no per-org headcount/industry),
// so the filters themselves are the evidence — each card states the keyword +
// band it matched.
//
// Tech-native keywords use a total-headcount proxy for the 50-500 SWE sweet
// spot. Traditional-industry keywords use a much larger band: a retailer or
// automaker with 10,000+ total employees is exactly the kind of company whose
// in-house software org lands in Bito's ICP (Walmart/Toyota/Siemens class).
interface SweepQuery {
  keyword: string;
  ranges: string[];
  bandLabel: string;
  perPage: number;
}

// Each (keyword × employee-band) is a DISTINCT Apollo filter that paginates its
// own result set — so splitting one broad band into several narrow ones returns
// far more distinct companies per pull (and avoids cross-page overlap) than a
// single wide band ever could. That's what lets the feed scale into the
// thousands instead of dribbling in ~76 orgs per pull.
const TECH_KEYWORDS = ["developer tools", "saas", "fintech", "artificial intelligence"];
// Mid-market tech bands (total headcount → ~50-900 SWE sweet spot). Kept at
// 100+ employees to stay above Bito's ~50-engineer ICP floor.
const TECH_BANDS: { range: string; label: string }[] = [
  { range: "100,300", label: "100-300 employees" },
  { range: "301,800", label: "301-800 employees" },
  { range: "801,2500", label: "801-2500 employees" },
];
const TRAD_KEYWORDS = ["retail", "automotive", "manufacturing", "healthcare", "logistics", "media"];

const SWEEP_QUERIES: SweepQuery[] = [
  // Tech-native — software IS the company; sweep several narrow size bands.
  ...TECH_KEYWORDS.flatMap((keyword) =>
    TECH_BANDS.map((b) => ({ keyword, ranges: [b.range], bandLabel: b.label, perPage: 20 })),
  ),
  // Traditional industries — big totals, big in-house software orgs.
  ...TRAD_KEYWORDS.map((keyword) => ({
    keyword,
    ranges: ["5001,1000000"],
    bandLabel: "5,000+ employees",
    perPage: 12,
  })),
];

// Total orgs one full sweep page returns across every query. The signals route
// uses this to advance the sweep cursor by exactly one page per pull, so pages
// neither stall (re-fetching the same orgs) nor skip ahead past results.
export const SWEEP_PAGE_SIZE = SWEEP_QUERIES.reduce((n, q) => n + q.perPage, 0);

interface ApolloAccountRecord {
  name?: string;
  primary_domain?: string;
  domain?: string;
  website_url?: string;
  linkedin_url?: string;
  estimated_num_employees?: number;
  short_description?: string;
  industry?: string;
}

// organization_locations[] filter values per intel region (verified Apollo
// search param: headquarters location, accepts country names).
const REGION_LOCATION: Record<RegionId, string> = {
  us: "United States",
  in: "India",
};

/**
 * @param page Which results page to fetch per keyword — callers advance this
 * between pulls so each pull surfaces NEW organizations (Apollo has tens of
 * thousands of matches per filter; page 1 alone would repeat forever).
 * @param region Scopes the sweep to HQ country (US vs India).
 */
export async function apolloIcpSweep(page = 1, region: RegionId = "us"): Promise<IcpSweepResult> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) {
    return {
      configured: false,
      ok: false,
      error: "APOLLO_API_KEY not set — ICP sweep skipped",
      orgs: [],
    };
  }

  try {
    // One sub-query per (keyword × band) so every result carries the exact
    // filter that surfaced it. Results arrive under BOTH `accounts` and
    // `organizations` depending on workspace state — read both. Pooled at a
    // modest concurrency so the ~18 queries don't burst Apollo's rate limit.
    const runQuery = async (q: SweepQuery) => {
      const qs = new URLSearchParams({
        page: String(Math.max(1, Math.min(100, page))),
        per_page: String(q.perPage),
      });
      for (const r of q.ranges) qs.append("organization_num_employees_ranges[]", r);
      qs.append("q_organization_keyword_tags[]", q.keyword);
      qs.append("organization_locations[]", REGION_LOCATION[region]);

      const { status, body } = await apolloJson(
        `${BASE}/mixed_companies/search?${qs}`,
        key,
        "POST",
      );
      if (status !== 200)
        return { query: q, error: statusError(status, "ICP org sweep"), records: [] as ApolloAccountRecord[] };
      const b = body as
        | { accounts?: ApolloAccountRecord[]; organizations?: ApolloAccountRecord[] }
        | undefined;
      return {
        query: q,
        error: undefined as string | undefined,
        records: [...(b?.accounts ?? []), ...(b?.organizations ?? [])],
      };
    };
    const batches = await runPooled(SWEEP_QUERIES, 6, runQuery);

    const errors = batches
      .filter((b) => b.error)
      .map((b) => `${b.query.keyword}: ${b.error}`);
    const seen = new Set<string>();
    const orgs: IcpSweepOrg[] = [];
    for (const batch of batches) {
      for (const a of batch.records) {
        const name = str(a.name);
        if (!name) continue;
        const domain = str(a.primary_domain) ?? str(a.domain);
        const dedupeKey = (domain ?? name).toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        orgs.push({
          name,
          domain,
          websiteUrl: str(a.website_url),
          linkedinUrl: str(a.linkedin_url),
          matchedKeyword: batch.query.keyword,
          employeeBand: batch.query.bandLabel,
          estimatedEmployees: num(a.estimated_num_employees),
          about: str(a.short_description) ?? str(a.industry),
        });
      }
    }

    if (orgs.length === 0) {
      return {
        configured: true,
        ok: false,
        error: errors.length > 0 ? errors.join("; ") : "ICP sweep matched no organizations",
        orgs: [],
      };
    }
    return {
      configured: true,
      ok: true,
      error: errors.length > 0 ? errors.join("; ") : undefined,
      orgs,
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: isTimeout(e) ? "Apollo ICP sweep timed out after 15s" : "Apollo ICP sweep failed",
      orgs: [],
    };
  }
}
