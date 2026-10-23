import { RosterView } from "@/components/views/RosterView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <RosterView leagueId={Number((await params).leagueId)} />;
}
