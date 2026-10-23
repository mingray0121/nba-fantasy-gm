import { TransactionsView } from "@/components/views/TransactionsView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <TransactionsView leagueId={Number((await params).leagueId)} />;
}
