/* eslint-disable @next/next/no-img-element */
import { ChevronDown, Crown, LockKeyhole, Medal, Trophy, UserRound } from "lucide-react";
import type { LeaderboardEntryView, StageLeaderboardView } from "@/lib/leaderboard/queries";

function points(value: number) {
  return value.toFixed(2);
}

function rankColor(rank: number) {
  if (rank === 1) return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (rank === 2) return "border-zinc-300/25 bg-zinc-300/8 text-zinc-200";
  if (rank === 3) return "border-orange-300/25 bg-orange-300/8 text-orange-200";
  return "border-white/8 bg-white/[0.025] text-zinc-500";
}

function Lineup({ entry }: { entry: LeaderboardEntryView }) {
  if (!entry.lineup) {
    return <div className="flex items-center gap-2 border-t border-white/8 px-5 py-4 text-xs text-zinc-600"><LockKeyhole className="size-3.5" />Lineup reveals when the stage locks.</div>;
  }
  return (
    <div className="grid gap-px border-t border-white/8 bg-white/8 sm:grid-cols-5">
      {entry.lineup.map((player) => (
        <div key={player.id} className="bg-[#0a0d0b] p-4">
          <div className="flex items-center gap-2">
            <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-black/30 text-[10px] font-black text-zinc-600">
              {player.imageUrl ? <img src={player.imageUrl} alt="" className="h-full w-full object-cover" /> : player.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0"><p className="flex items-center gap-1 truncate text-sm font-bold text-white">{player.name}{player.isCaptain && <Crown className="size-3 text-amber-300" />}</p><p className="text-[9px] font-black tracking-wider text-cyan-300">{player.role}</p></div>
          </div>
          <div className="mt-3 flex items-end justify-between"><span className="text-[10px] text-zinc-600">{player.gamesScored} games</span><span className="font-mono text-sm font-black text-zinc-200">{points(player.finalScore)}{player.isCaptain && <span className="ml-1 text-[9px] text-amber-300">×{player.multiplier}</span>}</span></div>
        </div>
      ))}
    </div>
  );
}

export function Leaderboard({ stage }: { stage: StageLeaderboardView }) {
  if (stage.entries.length === 0) {
    return <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center"><Trophy className="mx-auto size-8 text-zinc-700" /><h2 className="mt-4 text-xl font-black text-white">No lineups yet</h2><p className="mt-2 text-sm text-zinc-600">The first submitted roster will take the top spot.</p></div>;
  }
  return (
    <div className="space-y-3">
      {stage.entries.map((entry) => (
        <details key={entry.rosterId} className={`group overflow-hidden rounded-2xl border ${entry.isCurrentUser ? "border-lime-300/30 bg-lime-300/[0.035]" : "border-white/8 bg-white/[0.02]"}`}>
          <summary className="flex cursor-pointer list-none items-center gap-4 p-4 sm:p-5">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl border font-mono text-sm font-black ${rankColor(entry.rank)}`}>{entry.rank <= 3 ? <Medal className="size-4" /> : entry.rank}</span>
            <div className="min-w-0 flex-1"><p className="flex items-center gap-2 truncate font-black text-white"><UserRound className="size-3.5 text-zinc-600" />{entry.username}{entry.isCurrentUser && <span className="rounded-full bg-lime-300/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-lime-300">You</span>}</p><p className="mt-1 text-[10px] text-zinc-600">{entry.gamesScored} scored games · submitted {new Date(entry.submittedAt).toLocaleDateString()}</p></div>
            <div className="text-right"><p className="font-mono text-xl font-black text-white sm:text-2xl">{points(entry.totalScore)}</p><p className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Fantasy points</p></div>
            <ChevronDown className="size-4 shrink-0 text-zinc-700 transition group-open:rotate-180" />
          </summary>
          <div className="flex gap-5 border-t border-white/8 px-5 py-3 text-[10px] uppercase tracking-wider text-zinc-600"><span>Base <strong className="ml-1 text-zinc-300">{points(entry.baseScore)}</strong></span><span>Captain bonus <strong className="ml-1 text-amber-300">+{points(entry.captainBonus)}</strong></span></div>
          <Lineup entry={entry} />
        </details>
      ))}
    </div>
  );
}

