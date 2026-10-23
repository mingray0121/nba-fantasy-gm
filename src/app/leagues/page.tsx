import Link from "next/link";
import { requireUserPage } from "@/lib/session";
import { listLeagues } from "@/lib/data/leagues";
import { Badge, PageTitle, timeAgo } from "@/components/ui";
import { ConnectLeagues } from "@/components/ConnectLeagues";
import { SignOut } from "@/components/SignOut";

const SCORING_LABEL: Record<string, string> = {
  h2h_categories: "H2H categories",
  h2h_points: "H2H points",
  roto: "Roto",
};

export default async function LeaguesPage() {
  const userId = await requireUserPage();
  const leagues = await listLeagues(userId);
  const active = leagues.filter((l) => !l.isArchived);
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <PageTitle title="My leagues" subtitle="Each league keeps its own rules, roster and recommendations." actions={<SignOut />} />
      <div className="grid gap-3">
        {active.length === 0 && <p className="card p-4 text-sm text-slate-500">No leagues yet. Connect one from Yahoo below.</p>}
        {active.map((l) => (
          <Link key={l.id} href={`/leagues/${l.id}/today`} className="card flex items-center justify-between p-4 hover:border-court-500">
            <div>
              <div className="font-medium">{l.name}</div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-500">
                <Badge tone="blue">{l.scoringType ? SCORING_LABEL[l.scoringType] : "No rules yet"}</Badge>
                <Badge>{l.source === "yahoo" ? "Yahoo" : "Manual"}</Badge>
                <span>
                  {l.season} · {l.numTeams ?? "?"} teams · rules v{l.ruleVersion ?? "–"} · synced {timeAgo(l.lastSyncAt)}
                </span>
              </div>
            </div>
            <span className="text-slate-400">›</span>
          </Link>
        ))}
      </div>
      <ConnectLeagues />
    </main>
  );
}
