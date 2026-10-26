import { NextResponse } from "next/server";
import { handler, requireOwner } from "@/lib/api";
import { listLeagues } from "@/lib/data/leagues";
import { YahooClient } from "@/lib/yahoo/client";

/** Yahoo NBA leagues on your account, marking those already connected. */
export const GET = handler(async () => {
  const userId = await requireOwner();
  const [yahoo, mine] = await Promise.all([new YahooClient(userId).myLeagues(), listLeagues(userId)]);
  const connected = new Set(mine.filter((l) => !l.isArchived).map((l) => l.yahooLeagueKey));
  return NextResponse.json({
    leagues: yahoo.map((l) => ({ ...l, connected: connected.has(l.leagueKey) })),
  });
});
