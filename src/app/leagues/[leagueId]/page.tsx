import { redirect } from "next/navigation";

export default async function LeagueHome({ params }: { params: Promise<{ leagueId: string }> }) {
  redirect(`/leagues/${(await params).leagueId}/today`);
}
