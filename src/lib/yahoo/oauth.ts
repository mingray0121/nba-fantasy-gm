import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { decrypt, encrypt } from "../crypto";
import { env } from "../env";

const AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";

export interface YahooTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  xoauth_yahoo_guid?: string;
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env("YAHOO_CLIENT_ID"),
    redirect_uri: env("YAHOO_REDIRECT_URI"),
    response_type: "code",
    language: "en-us",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<YahooTokenResponse> {
  const basic = Buffer.from(`${env("YAHOO_CLIENT_ID")}:${env("YAHOO_CLIENT_SECRET")}`).toString(
    "base64",
  );
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ redirect_uri: env("YAHOO_REDIRECT_URI"), ...body }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as YahooTokenResponse;
}

export function exchangeCode(code: string) {
  return tokenRequest({ grant_type: "authorization_code", code });
}

export function refreshTokens(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function saveTokens(userId: number, t: YahooTokenResponse) {
  const row = {
    userId,
    accessToken: encrypt(t.access_token),
    refreshToken: encrypt(t.refresh_token),
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
    updatedAt: new Date(),
  };
  await getDb()
    .insert(schema.yahooTokens)
    .values(row)
    .onConflictDoUpdate({ target: schema.yahooTokens.userId, set: row });
}

/** Returns a usable access token, refreshing it when it expires within 5 minutes. */
export async function getAccessToken(userId: number): Promise<string> {
  const [row] = await getDb()
    .select()
    .from(schema.yahooTokens)
    .where(eq(schema.yahooTokens.userId, userId));
  if (!row) throw new Error("No Yahoo tokens stored; sign in again");
  if (row.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return decrypt(row.accessToken);
  const fresh = await refreshTokens(decrypt(row.refreshToken));
  // Yahoo may omit refresh_token on refresh; keep the old one then.
  if (!fresh.refresh_token) fresh.refresh_token = decrypt(row.refreshToken);
  await saveTokens(userId, fresh);
  return fresh.access_token;
}

/** Yahoo account id for a fresh access token (when the token response didn't include it). */
export async function fetchGuid(accessToken: string): Promise<string> {
  const fantasy = await fetch("https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1?format=json", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!fantasy.ok) throw new Error(`Could not look up Yahoo account: ${fantasy.status}`);
  const body = (await fantasy.json()) as { fantasy_content: { users: { "0": { user: { guid?: string }[] } } } };
  const guid = body.fantasy_content.users["0"].user.find((p) => p.guid)?.guid;
  if (!guid) throw new Error("Yahoo did not return an account id");
  return guid;
}
