import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, LockKeyhole, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Leaderboard } from "@/components/leaderboard";
import { getStageLeaderboard } from "@/lib/leaderboard/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage({ params }: { params: Promise<{ stageSlug: string }> }) {
  const { stageSlug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/play/${stageSlug}/leaderboard`)}`);
  const stage = await getStageLeaderboard(stageSlug, user.id);
  if (!stage) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href={`/play/${stage.slug}`} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-500 transition hover:text-cyan-300"><ArrowLeft className="size-3.5" />Back to roster</Link>
      <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><Badge className="border-cyan-300/20 bg-cyan-300/8 text-cyan-300">Global standings</Badge><h1 className="mt-4 flex items-center gap-3 text-3xl font-black tracking-[-0.035em] text-white sm:text-5xl"><Trophy className="size-8 text-lime-300" />{stage.name}</h1><p className="mt-2 text-sm text-zinc-500">{stage.tournamentName} · {stage.entries.length} submitted {stage.entries.length === 1 ? "lineup" : "lineups"}</p></div>
        <div className="text-left sm:text-right"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">Your rank</p><p className="mt-1 text-2xl font-black text-lime-300">{stage.entries.find((entry) => entry.isCurrentUser)?.rank ? `#${stage.entries.find((entry) => entry.isCurrentUser)!.rank}` : "—"}</p></div>
      </div>
      {!stage.lineupsRevealed && <div className="mt-8 flex items-start gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-4 text-sm text-amber-100"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-300" /><div><p className="font-bold">Opponent lineups are hidden until lock.</p><p className="mt-1 text-xs text-amber-200/60">You can inspect your own scoring breakdown now. All rosters reveal {new Date(stage.lockAt).toLocaleString()}.</p></div></div>}
      <section className="mt-6"><Leaderboard stage={stage} /></section>
    </main>
  );
}

