// POST /api/auth/login — verify the shared credentials, set the session cookie.

import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_COOKIE,
  AUTH_MAX_AGE,
  authConfigured,
  checkCredentials,
  sessionToken,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    // Nothing to log into — the gate is off.
    return NextResponse.json({ ok: true, gate: "disabled" });
  }

  let body: { username?: string; password?: string };
  try {
    body = (await req.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const username = (body.username || "").trim();
  const password = body.password || "";
  if (!checkCredentials(username, password)) {
    return NextResponse.json({ ok: false, error: "Incorrect username or password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  return res;
}
