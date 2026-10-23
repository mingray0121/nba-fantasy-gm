import { RulesView } from "@/components/views/RulesView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <RulesView leagueId={Number((await params).leagueId)} />;
}
