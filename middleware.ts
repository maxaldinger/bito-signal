import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authConfigured, isValidSession } from "@/lib/auth";

// Password gate for the whole app. Runs on every route the matcher below keeps
// (pages AND /api), because the API routes are the expensive surface — Apollo
// credits, HubSpot writes, Anthropic calls. A UI-only gate would protect none
// of that.
//
// Rollout is safe by construction: authConfigured() is false until the env vars
// are set, so shipping this changes nothing until you opt in.

/** The weekly Vercel cron hits this path. When CRON_SECRET is set, Vercel sends
 *  it as a bearer token and we let that through; when it is NOT set, we exempt
 *  the path so enabling auth never silently breaks the existing poll (the
 *  endpoint stays exactly as reachable as it is today — no worse). */
const CRON_PATH = "/api/github-prospect/sync";

function isCronRequest(req: NextRequest): boolean {
  if (req.nextUrl.pathname !== CRON_PATH) return false;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // no secret configured — preserve today's behavior
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function middleware(req: NextRequest) {
  // Gate disabled until fully configured.
  if (!authConfigured()) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Always-open: the login page, the auth endpoints, and the cron.
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    isCronRequest(req)
  ) {
    return NextResponse.next();
  }

  if (await isValidSession(req.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // Unauthenticated: API calls get a clean 401; page loads bounce to /login
  // carrying where they were headed (relative-only, so no open redirect).
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const dest = pathname + req.nextUrl.search;
  if (dest && dest !== "/") loginUrl.searchParams.set("next", dest);
  return NextResponse.redirect(loginUrl);
}

// Run on everything except Next internals and the favicon. Static assets under
// _next are excluded so the login page's own JS/CSS load before auth.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
