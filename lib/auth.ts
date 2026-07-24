// Single-tenant password gate.
//
// The whole app is single-user, so this is one shared username/password, not
// accounts. The gate is enforced in middleware.ts on EVERY route — pages and
// /api both — because the API routes spend Apollo credits and write to HubSpot,
// so hiding only the UI would protect nothing.
//
// Web Crypto only (no node:crypto), so the exact same helpers run in Edge
// middleware and in Node route handlers.

export const AUTH_COOKIE = "bito_auth";
// 30 days — a daily-use internal tool shouldn't re-prompt constantly.
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30;

// The signed payload is a constant. The cookie is a bearer proof-of-login, not
// a bearer of identity (there's only one user). Bumping the version string, or
// rotating AUTH_SECRET, invalidates every existing session.
const TOKEN_PAYLOAD = "bito-signal-authed:v1";

/** Auth is OFF until BOTH credentials and a signing secret are configured. This
 *  makes deploy-then-enable safe: shipping the code changes nothing until the
 *  env vars are set, and local dev without them stays open. */
export function authConfigured(): boolean {
  return Boolean(
    process.env.AUTH_USERNAME?.trim() &&
      process.env.AUTH_PASSWORD?.trim() &&
      process.env.AUTH_SECRET?.trim(),
  );
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

/** The cookie value proving a successful login. */
export async function sessionToken(): Promise<string> {
  const secret = process.env.AUTH_SECRET?.trim() || "";
  return hmac(TOKEN_PAYLOAD, secret);
}

/** Length-safe constant-time string compare. Both operands are fixed-length
 *  base64url HMACs, so the length check leaks nothing secret. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True if the presented cookie value is a currently-valid session. */
export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  return safeEqual(cookieValue, await sessionToken());
}

/** Verify a login attempt in constant time (per field). */
export function checkCredentials(username: string, password: string): boolean {
  const u = process.env.AUTH_USERNAME?.trim() || "";
  const p = process.env.AUTH_PASSWORD?.trim() || "";
  // Compare both even when the first fails, so timing doesn't reveal which was
  // wrong. safeEqual short-circuits only on length, which is not secret here.
  const okU = safeEqual(username, u);
  const okP = safeEqual(password, p);
  return okU && okP;
}
