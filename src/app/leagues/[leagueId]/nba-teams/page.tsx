import { NbaTeamsView } from "@/components/views/NbaTeamsView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <NbaTeamsView leagueId={Number((await params).leagueId)} />;
}
