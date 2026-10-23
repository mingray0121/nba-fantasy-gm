import { TodayView } from "@/components/views/TodayView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <TodayView leagueId={Number((await params).leagueId)} />;
}
