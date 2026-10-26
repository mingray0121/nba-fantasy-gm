import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";
import { hmac, safeEqual } from "./crypto";

const COOKIE = "nfa_session";

/** Placeholder guid for an owner created by password sign-in, until a Yahoo account is linked. */
export const LOCAL_OWNER_GUID = "local:owner";
/** Demo visitors get throwaway users whose guid starts with this. */
export const DEMO_GUID_PREFIX = "demo:";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
/** A demo copy lives this long; its cookie also ends when the browser closes. */
export const DEMO_MAX_AGE = 60 * 60 * 2;

export function signSession(userId: number, now = Date.now(), maxAge = MAX_AGE): string {
  const payload = `${userId}.${Math.floor(now / 1000) + maxAge}`;
  return `${payload}.${hmac(payload, env("SESSION_SECRET"))}`;
}

export function verifySession(token: string | undefined, now = Date.now()): number | null {
  if (!token) return null;
  const [uid, exp, sig] = token.split(".");
  if (!uid || !exp || !sig) return null;
  if (!safeEqual(sig, hmac(`${uid}.${exp}`, env("SESSION_SECRET")))) return null;
  if (Number(exp) * 1000 < now) return null;
  const id = Number(uid);
  return Number.isInteger(id) ? id : null;
}

export async function setSessionCookie(userId: number, opts: { demo?: boolean } = {}) {
  (await cookies()).set(COOKIE, signSession(userId, Date.now(), opts.demo ? DEMO_MAX_AGE : MAX_AGE), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // No maxAge for demo visitors: a session cookie, gone when the browser closes.
    ...(opts.demo ? {} : { maxAge: MAX_AGE }),
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

export async function currentUserId(): Promise<number | null> {
  return verifySession((await cookies()).get(COOKIE)?.value);
}

/** For pages: redirects to /login when signed out. */
export async function requireUserPage(): Promise<number> {
  const id = await currentUserId();
  if (!id) redirect("/login");
  return id;
}
