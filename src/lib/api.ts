import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { getDb, schema } from "@/db";
import { currentUserId, DEMO_GUID_PREFIX } from "./session";
import { env } from "./env";
import { safeEqual } from "./crypto";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps a route handler: JSON errors, auth failures as 401, validation as 400. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
      }
      console.error(err);
      const message = err instanceof Error ? err.message : "Internal error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export async function requireUser(): Promise<number> {
  const id = await currentUserId();
  if (!id) throw new HttpError(401, "Not signed in");
  return id;
}

export async function isDemoUser(userId: number): Promise<boolean> {
  const [user] = await getDb().select({ guid: schema.users.yahooGuid }).from(schema.users).where(eq(schema.users.id, userId));
  return !user || user.guid.startsWith(DEMO_GUID_PREFIX);
}

/** Signed-in user who is not a demo visitor (for Yahoo, new leagues and data refreshes). */
export async function requireOwner(): Promise<number> {
  const id = await requireUser();
  if (await isDemoUser(id)) throw new HttpError(403, "Not available in the demo");
  return id;
}

/** Loads a league and checks it belongs to the signed-in user. */
export async function requireLeague(leagueIdParam: string) {
  const userId = await requireUser();
  const leagueId = Number(leagueIdParam);
  if (!Number.isInteger(leagueId)) throw new HttpError(400, "Bad league id");
  const [league] = await getDb()
    .select()
    .from(schema.leagues)
    .where(and(eq(schema.leagues.id, leagueId), eq(schema.leagues.userId, userId)));
  if (!league) throw new HttpError(404, "League not found");
  return league;
}

export function requireJobToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token || !safeEqual(token, env("JOB_TOKEN"))) throw new HttpError(401, "Bad job token");
}
