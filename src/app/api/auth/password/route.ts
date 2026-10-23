import { NextResponse, type NextRequest } from "next/server";
import { getDb, schema } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { optionalEnv } from "@/lib/env";
import { LOCAL_OWNER_GUID, setSessionCookie } from "@/lib/session";

function back(req: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, req.url), { status: 303 });
}

/**
 * Password sign-in (APP_PASSWORD), for using the app without Yahoo API access.
 * Signs in as the single owner, creating it on first use.
 */
export async function POST(req: NextRequest) {
  const expected = optionalEnv("APP_PASSWORD");
  if (!expected) return back(req, "/login?error=Password%20sign-in%20is%20not%20enabled");
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  if (!safeEqual(password, expected)) return back(req, "/login?error=Wrong%20password");

  const db = getDb();
  let [owner] = await db.select().from(schema.users).limit(1);
  if (!owner) [owner] = await db.insert(schema.users).values({ yahooGuid: LOCAL_OWNER_GUID }).returning();
  await setSessionCookie(owner.id);
  return back(req, "/leagues");
}
