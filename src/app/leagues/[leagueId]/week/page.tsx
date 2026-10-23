import { WeekView } from "@/components/views/WeekView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <WeekView leagueId={Number((await params).leagueId)} />;
}
