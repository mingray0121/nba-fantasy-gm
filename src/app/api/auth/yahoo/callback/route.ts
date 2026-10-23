import { NextResponse, type NextRequest } from "next/server";
import { getDb, schema } from "@/db";
import { exchangeCode, fetchGuid, saveTokens } from "@/lib/yahoo/oauth";
import { setSessionCookie } from "@/lib/session";
import { optionalEnv } from "@/lib/env";

function fail(req: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, req.url));
}

export async function GET(req: NextRequest) {
  try {
    return await signIn(req);
  } catch (err) {
    console.error("Yahoo sign-in failed", err);
    return fail(req, `Sign-in failed: ${(err as Error).message}`.slice(0, 300));
  }
}

async function signIn(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("nfa_oauth_state")?.value) {
    return fail(req, "Sign-in expired, please try again");
  }

  const tokens = await exchangeCode(code);
  const db = getDb();
  const guid = tokens.xoauth_yahoo_guid ?? (await fetchGuid(tokens.access_token));

  // Only one Yahoo account may use the app: ALLOWED_YAHOO_GUID, or else the first account that signed in.
  const allowed = optionalEnv("ALLOWED_YAHOO_GUID");
  const [existing] = await db.select().from(schema.users).limit(1);

  if (allowed ? guid !== allowed : existing && existing.yahooGuid !== guid) {
    return fail(req, "This Yahoo account is not allowed to use this app");
  }

  let userId = existing?.yahooGuid === guid ? existing.id : undefined;
  if (!userId) {
    const [created] = await db
      .insert(schema.users)
      .values({ yahooGuid: guid })
      .onConflictDoUpdate({ target: schema.users.yahooGuid, set: { yahooGuid: guid } })
      .returning({ id: schema.users.id });
    userId = created.id;
  }
  await saveTokens(userId, tokens);
  await setSessionCookie(userId);

  const res = NextResponse.redirect(new URL("/leagues", req.url));
  res.cookies.delete("nfa_oauth_state");
  return res;
}
