import { SuggestionsView } from "@/components/views/SuggestionsView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <SuggestionsView leagueId={Number((await params).leagueId)} />;
}
