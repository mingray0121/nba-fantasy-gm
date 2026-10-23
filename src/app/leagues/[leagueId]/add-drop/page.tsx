import { AddDropView } from "@/components/views/AddDropView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <AddDropView leagueId={Number((await params).leagueId)} />;
}
