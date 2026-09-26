import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RosterBuilder } from "@/components/roster-builder";
import { getStageRosterView } from "@/lib/rosters/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlayStagePage({ params }: { params: Promise<{ stageSlug: string }> }) {
  const { stageSlug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/play/${stageSlug}`)}`);
  const stage = await getStageRosterView(stageSlug, user.id);
  if (!stage) notFound();

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge className="border-lime-300/20 bg-lime-300/8 text-lime-300">Fantasy stage · {stage.status === "OPEN" ? "Open roster builder" : stage.status}</Badge>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.035em] text-white sm:text-5xl">{stage.name}</h1>
          <p className="mt-2 text-sm text-zinc-500">{stage.tournamentName} · One starter per role · Max {stage.maxPlayersPerTeam} per team</p>
        </div>
        <div className="flex items-end gap-5 sm:text-right"><Link href={`/play/${stage.slug}/leaderboard`} className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 text-xs font-black uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-300/10"><Trophy className="size-4" />Leaderboard</Link><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">Salary cap</p><p className="mt-1 text-2xl font-black text-lime-300">{`$${stage.salaryCap / 1_000_000}M`}</p></div></div>
      </div>
      <RosterBuilder stage={stage} userId={user.id} />
    </main>
  );
}
