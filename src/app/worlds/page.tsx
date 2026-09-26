/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleDot,
  Clock3,
  Crown,
  Globe2,
  LockKeyhole,
  Medal,
  ShieldCheck,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getCompetitionHub, type CompetitionStageView } from "@/lib/competitions/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function stageStatusStyle(status: string) {
  if (status === "OPEN") return "border-lime-300/25 bg-lime-300/10 text-lime-300";
  if (status === "LIVE") return "border-rose-300/25 bg-rose-300/10 text-rose-200";
  if (status === "COMPLETE") return "border-cyan-300/20 bg-cyan-300/8 text-cyan-300";
  return "border-white/10 bg-white/[0.04] text-zinc-400";
}

function stageAction(stage: CompetitionStageView) {
  if (stage.status === "OPEN") return stage.hasCurrentUserRoster ? "Edit lineup" : "Build lineup";
  if (["LOCKED", "LIVE", "COMPLETE"].includes(stage.status)) return "View standings";
  return null;
}

export default async function WorldsPage() {
  let userId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }
  const competition = await getCompetitionHub("worlds", userId);
  if (!competition) notFound();
  const current = competition.currentStage;
  const currentAction = current ? stageAction(current) : null;
  const currentHref = current
    ? (current.status === "OPEN" ? `/play/${current.slug}` : `/play/${current.slug}/leaderboard`)
    : null;
  const userStanding = competition.standings.find((entry) => entry.isCurrentUser);

  return (
    <main>
      <section className="relative overflow-hidden border-b border-white/8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(210,255,69,0.13),transparent_24rem),radial-gradient(circle_at_25%_90%,rgba(65,230,209,0.1),transparent_28rem)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_22rem] lg:items-end">
          <div>
            <Badge className="border-amber-300/25 bg-amber-300/8 text-amber-200"><Globe2 className="mr-1.5 size-3" />World Championship Fantasy</Badge>
            <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[0.9] tracking-[-0.055em] text-white sm:text-7xl">
              One world.<br /><span className="text-lime-300">One leaderboard.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">{competition.description}</p>
            {currentHref && currentAction && (
              <Link href={userId ? currentHref : `/login?next=${encodeURIComponent(currentHref)}`} className="mt-8 inline-flex items-center gap-2 rounded-xl bg-lime-300 px-5 py-3 text-sm font-black text-zinc-950 transition hover:bg-lime-200">
                {currentAction}<ArrowRight className="size-4" />
              </Link>
            )}
          </div>
          <Card className="p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Your Worlds run</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-zinc-600">Overall rank</p><p className="mt-2 font-mono text-3xl font-black text-lime-300">{userStanding ? `#${userStanding.rank}` : "—"}</p></div>
              <div className="rounded-xl border border-white/8 bg-black/20 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-zinc-600">Total points</p><p className="mt-2 font-mono text-3xl font-black text-white">{userStanding?.totalScore.toFixed(2) ?? "0.00"}</p></div>
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500"><ShieldCheck className="size-3.5 text-cyan-300" />Redraft each round. Scores carry forward.</p>
          </Card>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-14 px-4 py-12 sm:px-6 sm:py-16">
        {!competition.tournamentProviderId && (
          <section>
            <Card className="overflow-hidden border-amber-300/15 p-1">
              <div className="rounded-[0.8rem] bg-gradient-to-br from-amber-300/[0.07] to-transparent p-7 sm:p-9">
                <div className="flex size-11 items-center justify-center rounded-xl border border-amber-300/20 bg-amber-300/10"><CalendarDays className="size-5 text-amber-200" /></div>
                <h2 className="mt-5 text-2xl font-black text-white">Waiting for the Worlds field</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">The competition hub is ready. Once the provider publishes the World Championship tournament and schedule, an operator can connect it and open the first eligible-team roster window without using placeholder teams.</p>
              </div>
            </Card>
          </section>
        )}

        {competition.stages.length > 0 && (
          <section>
            <div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">Roster windows</p><h2 className="mt-2 text-3xl font-black tracking-tight text-white">The road through Worlds</h2></div><p className="hidden text-xs text-zinc-600 sm:block">New lineup · every stage</p></div>
            <div className="mt-6 grid gap-3 lg:grid-cols-2">
              {competition.stages.map((stage) => {
                const action = stageAction(stage);
                const href = stage.status === "OPEN" ? `/play/${stage.slug}` : `/play/${stage.slug}/leaderboard`;
                return (
                  <Card key={stage.id} className={`p-5 ${current?.id === stage.id ? "border-lime-300/25" : ""}`}>
                    <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-white/8 bg-black/20 font-mono text-xs font-black text-zinc-500">{String(stage.sequence).padStart(2, "0")}</span><div><h3 className="font-black text-white">{stage.name}</h3><p className="mt-1 text-[10px] text-zinc-600">{stage.eligibleTeams} teams · {stage.eligiblePlayers} players · {stage.submittedRosters} entries</p></div></div><Badge className={stageStatusStyle(stage.status)}>{stage.status}</Badge></div>
                    <div className="mt-5 flex items-center justify-between border-t border-white/8 pt-4"><p className="flex items-center gap-2 text-xs text-zinc-500">{stage.lockAt ? <><Clock3 className="size-3.5" />Locks {new Date(stage.lockAt).toLocaleString()}</> : <><LockKeyhole className="size-3.5" />Lock pending</>}</p>{action && <Link href={userId ? href : `/login?next=${encodeURIComponent(href)}`} className="flex items-center gap-1.5 text-xs font-black text-cyan-300 hover:text-cyan-200">{action}<ArrowRight className="size-3.5" /></Link>}</div>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {competition.remainingTeams.length > 0 && (
          <section>
            <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-lime-300">Still standing</p><h2 className="mt-2 text-3xl font-black tracking-tight text-white">Eligible teams</h2><p className="mt-2 text-sm text-zinc-500">This field is frozen for {current?.name}. Eliminated teams disappear from the next roster window.</p></div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {competition.remainingTeams.map((team) => <Card key={team.id} className="flex items-center gap-3 p-4"><div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/8 bg-black/20 text-[10px] font-black text-zinc-600">{team.imageUrl ? <img src={team.imageUrl} alt="" className="h-full w-full object-contain p-1" /> : (team.abbreviation ?? team.name.slice(0, 2)).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-sm font-black text-white">{team.name}</p><p className="mt-0.5 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-lime-300"><Check className="size-3" />Eligible</p></div></Card>)}
            </div>
          </section>
        )}

        <section id="standings" className="scroll-mt-24">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">Global competition</p><h2 className="mt-2 flex items-center gap-3 text-3xl font-black tracking-tight text-white"><Trophy className="size-7 text-amber-300" />Worlds standings</h2><p className="mt-2 text-sm text-zinc-500">Every roster window contributes to one cumulative score.</p></div>{competition.tournamentName && <Badge className="text-zinc-400">{competition.tournamentName}</Badge>}</div>
          {competition.standings.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center"><Swords className="mx-auto size-8 text-zinc-700" /><h3 className="mt-4 text-xl font-black text-white">The race has not started</h3><p className="mt-2 text-sm text-zinc-600">Standings appear after the first Worlds lineup is submitted.</p></div>
          ) : (
            <div className="mt-6 space-y-3">
              {competition.standings.map((entry) => (
                <Card key={entry.username} className={`flex items-center gap-4 p-4 sm:p-5 ${entry.isCurrentUser ? "border-lime-300/30 bg-lime-300/[0.035]" : ""}`}>
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl border font-mono text-sm font-black ${entry.rank <= 3 ? "border-amber-300/25 bg-amber-300/10 text-amber-200" : "border-white/8 text-zinc-500"}`}>{entry.rank <= 3 ? <Medal className="size-4" /> : entry.rank}</span>
                  <div className="min-w-0 flex-1"><p className="flex items-center gap-2 truncate font-black text-white">{entry.rank === 1 && <Crown className="size-3.5 text-amber-300" />}{entry.username}{entry.isCurrentUser && <span className="rounded-full bg-lime-300/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-lime-300">You</span>}</p><p className="mt-1 flex items-center gap-3 text-[10px] text-zinc-600"><span>{entry.stagesEntered} stages</span><span>{entry.gamesScored} games</span><span>+{entry.captainBonus.toFixed(2)} captain</span></p></div>
                  <div className="text-right"><p className="font-mono text-xl font-black text-white sm:text-2xl">{entry.totalScore.toFixed(2)}</p><p className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Total points</p></div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {[[Users, "Redraft each round", "Build from the teams still alive when each roster window opens."], [CircleDot, "Immutable pools", "Once a round opens, eligibility and prices stay frozen for everyone."], [Trophy, "One champion", "All stage totals roll into the same global Worlds leaderboard."]].map(([Icon, title, copy]) => {
            const Component = Icon as typeof Users;
            return <Card key={String(title)} className="p-5"><Component className="size-5 text-zinc-500" /><h3 className="mt-4 font-bold text-zinc-100">{String(title)}</h3><p className="mt-2 text-sm leading-6 text-zinc-500">{String(copy)}</p></Card>;
          })}
        </section>
      </div>
    </main>
  );
}
