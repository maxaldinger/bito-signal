// Person → company resolution + enrichment for GitHub prospects.
//
// Resolution ladder (free, GitHub API):
//   1. profile `company` field
//   2. public org memberships
//   3. corporate email DOMAINS from public commit history — domain inference
//      only; outreach emails always come from Apollo (cleaner data, avoids the
//      GitHub ToS gray zone of scraping commit emails).
//
// Enrichment (Apollo): free org search for headcount + canonical name, then
// people-match (credits) for the verified work email + title. Prospects are
// then deduped against HubSpot contacts and suppressed when already in an
// active Apollo sequence. Openers are generated last, on the fast model, in
// the same "WHAT I SAW" voice as the existing signals.

import { BITO_CONTEXT } from "../bito";
import { callClaudeWithWebSearch, extractJSON, FAST_MODEL } from "../anthropic";
import { apolloPersonContact } from "../enrich/apollo";
import { stripEmDashes } from "../format";
import { hubspotSearch } from "../hubspot";
import {
  fetchCommitEmailDomains,
  fetchFirstOrg,
  fetchGitHubProfile,
  isFreemailDomain,
  type RequestBudget,
} from "./collect";
import { fetchProspectsByStatus, updateProspect } from "./store";
import { ACTION_LABELS, type MonitoredRepo, type Prospect } from "./types";

/** Company-size floor (total employees) — below it a prospect is suppressed,
 * not deleted, so the threshold can be tuned without losing data. */
export function minEmployees(): number {
  const n = Number(process.env.GITHUB_PROSPECT_MIN_EMPLOYEES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100;
}

// --------- Company-field cleanup ---------

/** Profile `company` values that are not companies. */
const NON_COMPANY_RE =
  /^(none|n\/a|na|self|self.?employed|freelance|freelancer|independent|personal|home|student|retired|unemployed|open to work|looking|earth|world|internet|remote|nowhere|-+)$/i;

/** Normalize a raw GitHub profile company field ("@vercel | ex-Stripe") to a
 * single plausible company name, or undefined. */
export function cleanCompanyField(raw?: string): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(/[|,;·•]/)[0]?.trim() ?? "";
  const cleaned = first.replace(/^@/, "").replace(/\s+/g, " ").trim();
  if (cleaned.length < 2 || cleaned.length > 80) return undefined;
  if (NON_COMPANY_RE.test(cleaned)) return undefined;
  if (/^(ex[- ]|formerly )/i.test(cleaned)) return undefined;
  return cleaned;
}

// --------- Apollo org search (free — headcount + canonical name) ---------

const APOLLO_BASE = "https://api.apollo.io/api/v1";
const APOLLO_TIMEOUT_MS = 15_000;

function apolloHeaders(key: string): Record<string, string> {
  return {
    "x-api-key": key,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Cache-Control": "no-cache",
  };
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Registrable root of a domain ("us.experian.com" → "experian.com"), same
 * subdomain-tolerant rule HubSpotActions uses for its off-domain email guard. */
function rootDomainOf(d: string): string {
  const parts = d.toLowerCase().trim().replace(/^www\./, "").split(".").filter(Boolean);
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

interface OrgLookup {
  ok: boolean;
  error?: string;
  orgName?: string;
  domain?: string;
  headcount?: number;
}

/** Free company lookup via mixed_companies/search — no credits consumed. */
export async function apolloOrgLookup(company: string): Promise<OrgLookup> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return { ok: false, error: "APOLLO_API_KEY not set" };
  try {
    const qs = new URLSearchParams({
      q_organization_name: company,
      page: "1",
      per_page: "5",
    });
    const res = await fetch(`${APOLLO_BASE}/mixed_companies/search?${qs}`, {
      method: "POST",
      headers: apolloHeaders(key),
      signal: AbortSignal.timeout(APOLLO_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `Apollo ${res.status} on company search` };
    const body = (await res.json()) as {
      organizations?: Record<string, unknown>[];
      accounts?: Record<string, unknown>[];
    };
    const records = [...(body.organizations ?? []), ...(body.accounts ?? [])];
    if (records.length === 0) return { ok: true };
    const target = normName(company);
    const exact = records.find((r) => normName(String(r.name ?? "")) === target);
    const org = exact ?? records[0];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    return {
      ok: true,
      orgName: str(org.name),
      domain: str(org.primary_domain),
      headcount: num(org.estimated_num_employees),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Whether this email's person already sits in an active Apollo sequence.
 * Degrades to { known: false } when the endpoint is unavailable/plan-gated. */
export async function apolloInActiveSequence(
  email: string,
): Promise<{ known: boolean; inSequence: boolean }> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return { known: false, inSequence: false };
  try {
    const qs = new URLSearchParams({ q_keywords: email, page: "1", per_page: "3" });
    const res = await fetch(`${APOLLO_BASE}/contacts/search?${qs}`, {
      method: "POST",
      headers: apolloHeaders(key),
      signal: AbortSignal.timeout(APOLLO_TIMEOUT_MS),
    });
    if (!res.ok) return { known: false, inSequence: false };
    const body = (await res.json()) as {
      contacts?: { email?: string; contact_campaign_statuses?: { status?: string }[] }[];
    };
    const match = (body.contacts ?? []).find(
      (c) => (c.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (!match) return { known: true, inSequence: false };
    const active = (match.contact_campaign_statuses ?? []).some(
      (s) => (s.status ?? "").toLowerCase() === "active",
    );
    return { known: true, inSequence: active };
  } catch {
    return { known: false, inSequence: false };
  }
}

// --------- Pipeline stages ---------

export interface PassCounts {
  resolved: number;
  enriched: number;
  suppressed: number;
  openers: number;
  notes: string[];
}

const RESOLVE_CAP = 20;
const ENRICH_CAP = 10;
const OPENER_CAP = 12;

/** Stage 1 — resolve `new` prospects to a company via the GitHub API. */
export async function resolveNewProspects(
  token: string | undefined,
  budget: RequestBudget,
  counts: PassCounts,
): Promise<void> {
  const pending = await fetchProspectsByStatus(["new"], RESOLVE_CAP);
  for (const p of pending) {
    if (budget.remaining <= 3) {
      counts.notes.push("Resolution paused — GitHub request budget exhausted (resumes next sync)");
      return;
    }
    const prof = await fetchGitHubProfile(p.login, token, budget);
    if (!prof.ok) {
      if (prof.rateLimited) {
        counts.notes.push("Resolution paused — GitHub rate limit hit (set GITHUB_TOKEN to raise it)");
        return;
      }
      continue; // transient failure — retry next run
    }
    const profile = prof.profile!;
    const base = {
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      githubUrl: profile.htmlUrl ?? `https://github.com/${p.login}`,
      location: profile.location,
    };

    // 1. Profile company field.
    let company = cleanCompanyField(profile.company);
    let companyDomain: string | undefined;
    let source = company ? "profile" : undefined;

    // Public profile email → corporate domain hint (domain only, never outreach).
    if (profile.email) {
      const at = profile.email.lastIndexOf("@");
      const domain = at > 0 ? profile.email.slice(at + 1).toLowerCase() : "";
      if (domain && !isFreemailDomain(domain)) companyDomain = domain;
    }

    // 2. Org membership.
    if (!company) {
      const { org, rateLimited } = await fetchFirstOrg(p.login, token, budget);
      if (rateLimited) {
        counts.notes.push("Resolution paused — GitHub rate limit hit (set GITHUB_TOKEN to raise it)");
        await updateProspect(p.login, base);
        return;
      }
      if (org) {
        company = org;
        source = "org-membership";
      }
    }

    // 3. Corporate commit-email domains (cross-reference of public history).
    if (!company && !companyDomain) {
      const { domains, rateLimited } = await fetchCommitEmailDomains(
        p.login,
        profile.name,
        token,
        budget,
      );
      if (rateLimited) {
        counts.notes.push("Resolution paused — GitHub rate limit hit (set GITHUB_TOKEN to raise it)");
        await updateProspect(p.login, base);
        return;
      }
      if (domains[0]) {
        companyDomain = domains[0];
        const label = domains[0].split(".")[0] ?? "";
        company = label.charAt(0).toUpperCase() + label.slice(1);
        source = "commit-domain";
      }
    }

    if (company || companyDomain) {
      await updateProspect(p.login, {
        ...base,
        company,
        companyDomain,
        resolutionSource: source,
        status: "resolved",
      });
      counts.resolved += 1;
    } else {
      await updateProspect(p.login, {
        ...base,
        status: "no_match",
        suppressedReason: "No company on the GitHub profile, org memberships, or public commit history",
      });
    }
  }
}

/** Stage 2 — size-filter, Apollo people-match, HubSpot dedupe, sequence check. */
export async function enrichResolvedProspects(counts: PassCounts): Promise<void> {
  const floor = minEmployees();
  const pending = await fetchProspectsByStatus(["resolved"], ENRICH_CAP);
  let hubspotDown = false;
  for (const p of pending) {
    if (!p.name) {
      await updateProspect(p.login, {
        status: "no_match",
        suppressedReason: "No public name on the GitHub profile — Apollo cannot match without one",
      });
      continue;
    }
    const companyGuess = p.company ?? p.companyDomain;
    if (!companyGuess) continue;

    // Free org lookup: canonical name, domain, real headcount.
    let company = p.company;
    let companyDomain = p.companyDomain;
    let headcount = p.headcount;
    const org = await apolloOrgLookup(companyGuess);
    if (!org.ok && org.error?.includes("APOLLO_API_KEY")) {
      counts.notes.push("Enrichment skipped — APOLLO_API_KEY not set");
      return;
    }
    if (org.ok) {
      company = org.orgName ?? company;
      companyDomain = org.domain ?? companyDomain;
      headcount = org.headcount ?? headcount;
    }

    if (typeof headcount === "number" && headcount < floor) {
      await updateProspect(p.login, {
        company,
        companyDomain,
        headcount,
        status: "suppressed",
        suppressedReason: `Company size ~${headcount.toLocaleString()} employees — below the ${floor.toLocaleString()} floor`,
      });
      counts.suppressed += 1;
      continue;
    }

    // Verified work email + title — Apollo people-match (consumes a credit).
    // Re-use an email saved by a previous partial run instead of re-spending.
    const match = p.email
      ? {
          configured: true,
          ok: true,
          name: p.name,
          email: p.email,
          emailStatus: undefined as string | undefined,
          title: p.title,
          linkedinUrl: p.linkedinUrl,
          error: undefined as string | undefined,
        }
      : await apolloPersonContact({
          name: p.name,
          company,
          domain: companyDomain,
          reveal: "email",
        });
    if (!match.configured) {
      counts.notes.push("Enrichment skipped — APOLLO_API_KEY not set");
      return;
    }
    if (!match.ok || !match.email) {
      // Only auth / rate-limit / credit / transport problems pause the whole
      // stage; anything else (404/422/no-match/no-email) is data-dependent
      // and must move THIS prospect out of the queue, or the score-ordered
      // fetch retries the same person forever and the stage never advances.
      const systemic = /\b(401|403|429)\b|rate limited|timed out|credits|APOLLO_API_KEY|match failed$/i.test(
        match.error ?? "",
      );
      if (systemic) {
        await updateProspect(p.login, { company, companyDomain, headcount });
        counts.notes.push(`Apollo enrichment paused — ${match.error ?? "match failed"}`);
        return;
      }
      await updateProspect(p.login, {
        company,
        companyDomain,
        headcount,
        status: "no_match",
        suppressedReason: match.error ?? "Apollo could not match this person",
      });
      continue;
    }
    const email = match.email;

    // Enforce the "verified WORK email" contract: reject personal addresses
    // (Apollo's reveal can fall back to personal_emails) and explicitly
    // unverified statuses — they must never surface as outreach-ready.
    const emailDomain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    const emailStatus = (match.emailStatus ?? "").toLowerCase();
    const offDomain = companyDomain
      ? rootDomainOf(emailDomain) !== rootDomainOf(companyDomain)
      : isFreemailDomain(emailDomain);
    if (offDomain || emailStatus === "guessed" || emailStatus === "unavailable" || emailStatus === "unverified") {
      await updateProspect(p.login, {
        company,
        companyDomain,
        headcount,
        title: match.title,
        linkedinUrl: match.linkedinUrl,
        status: "no_match",
        suppressedReason: "Apollo only had a personal or unverified email on file",
      });
      continue;
    }
    // A validated corporate email can supply the domain when resolution
    // could not (helps the HubSpot company link + UI badges).
    if (!companyDomain && !isFreemailDomain(emailDomain)) companyDomain = emailDomain;

    // Dedupe against existing HubSpot contacts (exact email match).
    if (!hubspotDown) {
      const hs = await hubspotSearch("contact", { email });
      if (!hs.configured) {
        hubspotDown = true;
        counts.notes.push("HubSpot dedupe skipped — HUBSPOT_TOKEN not set");
      } else if (!hs.ok) {
        // Configured but erroring — do NOT fail open into "enriched" without
        // the dedupe. Save progress (email kept, status stays resolved) and
        // retry next run without re-spending the Apollo credit.
        await updateProspect(p.login, {
          name: match.name ?? p.name,
          company,
          companyDomain,
          headcount,
          email,
          title: match.title,
          linkedinUrl: match.linkedinUrl,
        });
        counts.notes.push(`Enrichment paused — HubSpot dedupe unavailable (${hs.error ?? "search failed"})`);
        return;
      } else if (hs.found) {
        await updateProspect(p.login, {
          company,
          companyDomain,
          headcount,
          email,
          title: match.title,
          linkedinUrl: match.linkedinUrl,
          hubspotContactId: hs.records[0]?.id,
          status: "suppressed",
          suppressedReason: "Already a HubSpot contact",
        });
        counts.suppressed += 1;
        continue;
      }
    }

    // Suppress anyone already in an active Apollo sequence.
    const seq = await apolloInActiveSequence(email);
    if (seq.known && seq.inSequence) {
      await updateProspect(p.login, {
        company,
        companyDomain,
        headcount,
        email,
        title: match.title,
        linkedinUrl: match.linkedinUrl,
        status: "suppressed",
        suppressedReason: "Already in an active Apollo sequence",
      });
      counts.suppressed += 1;
      continue;
    }

    await updateProspect(p.login, {
      name: match.name ?? p.name,
      company,
      companyDomain,
      headcount,
      email,
      title: match.title,
      linkedinUrl: match.linkedinUrl,
      status: "enriched",
    });
    counts.enriched += 1;
  }
}

// --------- Openers ---------

const OPENER_SYSTEM = `${BITO_CONTEXT}

You write ONE-or-two-sentence cold-outreach OPENERS for developers who engaged
with open-source repos in the code-graph / context-layer space. The rep pastes
the opener above a templated email body, in the existing "WHAT I SAW" pattern:
lead with the specific observed activity, then pivot to why it maps to the
problem Bito solves. Example shape (calibration only, never reuse verbatim):
"Saw you contributing to serena — you're clearly deep in the code-graph-for-agents
problem. We built the context layer that gives coding agents that map at org scale."

RULES:
- Observation first, in one clause: the person's REAL action and repo (given below). Never invent activity.
- Then at most one clause of Bito relevance. Mechanism, not marketing.
- HARD CAP 300 characters per opener. Shorter beats fuller.
- Plain declarative sentences, technically literate, no compliments, no questions.
- No em or en dashes. Use periods or commas. No exclamation marks.
- Banned words: delve, seamless, robust, leverage, unlock, streamline, optimize, supercharge, tapestry.
- No placeholders, no sign-off. Ready to paste verbatim.

Output ONLY a single JSON object, no prose, no code fences:
{ "openers": [ { "login": "github-login", "opener": "..." } ] }`;

function enforceOpener(raw: string): string {
  let t = stripEmDashes(raw).replace(/\s+/g, " ").trim();
  if (t.length > 320) {
    const cut = t.slice(0, 320);
    const lastStop = cut.lastIndexOf(". ");
    t = lastStop > 160 ? cut.slice(0, lastStop + 1) : cut.slice(0, cut.lastIndexOf(" "));
  }
  return t;
}

/** Stage 3 — batch-generate "WHAT I SAW" openers for enriched prospects. */
export async function generateOpeners(
  repos: MonitoredRepo[],
  counts: PassCounts,
): Promise<void> {
  const pending = (await fetchProspectsByStatus(["enriched"], 60))
    .filter((p) => !p.opener)
    .slice(0, OPENER_CAP);
  if (pending.length === 0) return;
  const repoMap = new Map(repos.map((r) => [r.repoKey, r]));

  const items = pending.map((p) => {
    const repo = p.bestRepo ? repoMap.get(p.bestRepo) : undefined;
    return {
      login: p.login,
      name: p.name,
      title: p.title,
      company: p.company,
      activity: p.bestAction && p.bestRepo
        ? `${ACTION_LABELS[p.bestAction]} ${repo?.name ?? p.bestRepo}`
        : "engaged with a watchlist repo",
      whyRepoMatters: repo?.whyMatters,
    };
  });

  let text: string;
  try {
    const result = await callClaudeWithWebSearch({
      system: OPENER_SYSTEM,
      user: `Write one opener per person. PEOPLE (JSON):\n${JSON.stringify(items)}`,
      // High-volume structured copy with the evidence already in hand — the
      // fast model matches the signal-grader cost profile.
      model: FAST_MODEL,
      webSearch: false,
      maxTokens: 2000,
      temperature: 0.4,
    });
    text = result.text;
  } catch (e) {
    counts.notes.push(
      `Opener generation skipped — ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  const parsed = extractJSON<{ openers?: { login?: string; opener?: string }[] }>(text);
  if (!parsed || !Array.isArray(parsed.openers)) {
    counts.notes.push("Opener generation returned unparseable output — will retry next sync");
    return;
  }
  const byLogin = new Map(
    parsed.openers
      .filter((o) => typeof o.login === "string" && typeof o.opener === "string" && o.opener.trim())
      .map((o) => [o.login!.toLowerCase(), o.opener!]),
  );
  for (const p of pending) {
    const opener = byLogin.get(p.login.toLowerCase());
    if (!opener) continue;
    const r = await updateProspect(p.login, { opener: enforceOpener(opener) });
    if (r.ok) counts.openers += 1;
  }
}

/** Convenience: does this prospect represent a code contribution (vs. a star)? */
export function isContributor(p: Prospect): boolean {
  return p.bestAction === "pr_merged" || p.bestAction === "committed" || p.bestAction === "pr_opened";
}
