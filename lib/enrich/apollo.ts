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
}

const ENG_LEADERSHIP_TITLES = [
  "CTO",
  "Chief Technology Officer",
  "VP of Engineering",
  "VP Engineering",
  "Head of Engineering",
  "Head of Platform",
  "Director of Engineering",
  "Staff Engineer",
  "Principal Engineer",
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
    title: str(p.title),
    email,
    emailStatus: str(p.email_status),
    linkedinUrl: str(p.linkedin_url),
    seniority: str(p.seniority),
    department: Array.isArray(p.departments) ? str(p.departments[0]) : undefined,
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
    for (const t of ENG_LEADERSHIP_TITLES) qs.append("person_titles[]", t);
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
