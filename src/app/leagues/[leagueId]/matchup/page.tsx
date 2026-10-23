import { MatchupView } from "@/components/views/MatchupView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <MatchupView leagueId={Number((await params).leagueId)} />;
}
