import { NextResponse, type NextRequest } from "next/server";
import { HttpError } from "@/lib/api";
import { createDemo } from "@/lib/data/demo";
import { setSessionCookie } from "@/lib/session";

export const maxDuration = 60;

/** "Try the demo": no password; a fresh demo league for this browser session. */
export async function POST(req: NextRequest) {
  try {
    const { userId, leagueId } = await createDemo();
    await setSessionCookie(userId, { demo: true });
    return NextResponse.redirect(new URL(`/leagues/${leagueId}/today`, req.url), { status: 303 });
  } catch (err) {
    const reason = err instanceof HttpError ? err.message : "Couldn't start the demo, please try again";
    if (!(err instanceof HttpError)) console.error(err);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, req.url), { status: 303 });
  }
}
