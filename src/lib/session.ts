import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";
import { hmac, safeEqual } from "./crypto";

const COOKIE = "nfa_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function signSession(userId: number, now = Date.now()): string {
  const payload = `${userId}.${Math.floor(now / 1000) + MAX_AGE}`;
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

export async function setSessionCookie(userId: number) {
  (await cookies()).set(COOKIE, signSession(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
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
