import { SettingsView } from "@/components/views/SettingsView";

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  return <SettingsView leagueId={Number((await params).leagueId)} />;
}
