import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireUserPage } from "@/lib/session";
import { isDemoUser } from "@/lib/api";
import { listLeagues } from "@/lib/data/leagues";
import { LeagueNav } from "@/components/LeagueNav";

export default async function LeagueLayout({ children, params }: { children: ReactNode; params: Promise<{ leagueId: string }> }) {
  const userId = await requireUserPage();
  const { leagueId } = await params;
  const leagues = await listLeagues(userId);
  const league = leagues.find((l) => String(l.id) === leagueId);
  if (!league) notFound();
  const demo = await isDemoUser(userId);
  return (
    <div className="min-h-screen">
      <LeagueNav
        league={{ id: league.id, name: league.name, source: league.source, scoringType: league.scoringType, lastSyncAt: league.lastSyncAt?.toString() ?? null }}
        leagues={leagues.filter((l) => !l.isArchived).map((l) => ({ id: l.id, name: l.name }))}
        demo={demo}
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
