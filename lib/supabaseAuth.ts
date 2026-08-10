// Supabase Auth plumbing — WS1 of MULTI_TENANT_PLAN.md.
//
// Replaces lib/auth.ts (the single-shared-password HMAC gate). Sessions are
// Supabase Auth JWTs in httpOnly cookies, managed by @supabase/ssr; identity
// is auth.uid(), which the RLS policies key on.
//
// Three clients, three trust levels:
//   - route client   (user JWT from cookies) — RLS applies as that user
//   - admin client   (service role)          — bypasses RLS; signup + tokens
//   - middleware client                       — session validation/refresh
//
// SIGNUP is domain-gated, not open: the GoTrue /auth/v1/signup endpoint is
// DISABLED in the dashboard (a probe proved the default allows anyone with the
// publishable key to self-register). Account creation happens only through
// /api/auth/signup, server-side via the admin client, restricted to
// @bito.ai addresses (plus ALLOWED_SIGNUP_EMAILS for explicit exceptions).

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

function projectConfig(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** True once the Supabase project env is present. Unlike the old HMAC gate
 *  (which was opt-in via AUTH_* vars), auth is ON whenever the app can run at
 *  all — there is no unauthenticated mode any more. */
export function authConfigured(): boolean {
  return projectConfig() !== null;
}

// ---------------------------------------------------------------------------
// Signup gating
// ---------------------------------------------------------------------------

/** Email domain every teammate signs up with. */
const SIGNUP_DOMAIN = "bito.ai";

/** True when this address may create an account.
 *
 *  EXACT ALLOWLIST, not a domain check. The signup route creates accounts
 *  with the email pre-confirmed (no verification mail is ever sent), so a
 *  domain rule would trust the STRING: anyone who found the URL could type
 *  made-up@bito.ai and become `authenticated` — which carries real read
 *  access. Max flagged exactly this. The address must appear verbatim in
 *  ALLOWED_SIGNUP_EMAILS (comma-separated env, Max-controlled); the domain
 *  requirement stays as a second belt. Adding a teammate = adding one entry
 *  to the env var. The durable upgrade, if the team outgrows an env var, is
 *  real email verification via custom SMTP — deliberately not built tonight. */
export function emailMayRegister(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  if (!e.endsWith(`@${SIGNUP_DOMAIN}`)) return false;
  const allowed = (process.env.ALLOWED_SIGNUP_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(e);
}

export function signupDomainLabel(): string {
  return SIGNUP_DOMAIN;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** Route-handler client: reads the session from request cookies, writes any
 *  refreshed tokens back. RLS applies as the signed-in user. */
export async function routeClient() {
  const cfg = projectConfig();
  if (!cfg) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not set");
  const store = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (all) => {
        try {
          for (const { name, value, options } of all) store.set(name, value, options);
        } catch {
          // Server Components can't set cookies; middleware handles refresh.
        }
      },
    },
  });
}

/** Service-role client — bypasses RLS. Server-only, used for: the gated signup
 *  route, the HubSpot token store, cron/system writes. NEVER expose to the
 *  browser and never derive per-user reads from it without an explicit filter. */
export function adminClient() {
  const cfg = projectConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!cfg || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(cfg.url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** The signed-in user for an API route, or null. Validates the JWT against
 *  GoTrue (getUser), not just cookie presence. */
export async function sessionUser(): Promise<User | null> {
  try {
    const sb = await routeClient();
    const { data } = await sb.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

/** Convenience: the signed-in user's id, or null. WS3's per-user state and
 *  WS5's token store key everything off this. */
export async function sessionUserId(): Promise<string | null> {
  return (await sessionUser())?.id ?? null;
}

// ---------------------------------------------------------------------------
// Middleware session handling
// ---------------------------------------------------------------------------

/** Validate (and refresh) the session inside middleware. Returns the user and
 *  a response carrying any refreshed cookies — the caller must return that
 *  response (or copy its cookies) so the refresh sticks. */
export async function middlewareUser(
  req: NextRequest,
  makeResponse: () => NextResponse,
): Promise<{ user: User | null; res: NextResponse }> {
  const cfg = projectConfig();
  const res = makeResponse();
  if (!cfg) return { user: null, res };
  const sb = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (all: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value, options } of all) res.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await sb.auth.getUser();
  return { user: data.user ?? null, res };
}
