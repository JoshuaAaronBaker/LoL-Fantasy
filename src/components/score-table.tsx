import { Check, Minus } from "lucide-react";
import type { GameScoreRow } from "@/lib/db/queries";
import { Badge } from "@/components/ui/badge";

function points(value: string | undefined) {
  const amount = Number(value ?? 0);
  return `${amount > 0 ? "+" : ""}${amount.toFixed(2)}`;
}

export function ScoreTable({ rows }: { rows: GameScoreRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-white/8 text-[0.65rem] font-black uppercase tracking-[0.16em] text-zinc-500">
            <th className="px-5 py-4">Player</th>
            <th className="px-3 py-4">Role</th>
            <th className="px-3 py-4 text-center">K / D / A</th>
            <th className="px-3 py-4 text-right">CS</th>
            <th className="px-3 py-4 text-center">Result</th>
            <th className="px-5 py-4 text-right">Fantasy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.playerName}-${row.teamName}`} className="border-b border-white/6 last:border-0">
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-lg bg-white/5 text-xs font-black text-zinc-500">
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-bold text-white">{row.playerName}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {row.teamAbbreviation ?? row.teamName}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-4"><Badge>{row.role ?? "Unknown"}</Badge></td>
              <td className="px-3 py-4 text-center font-mono text-sm text-zinc-300">
                <span className="text-white">{row.kills}</span> / <span className="text-rose-300">{row.deaths}</span> / {row.assists}
              </td>
              <td className="px-3 py-4 text-right font-mono text-sm text-zinc-300">{Number(row.cs)}</td>
              <td className="px-3 py-4 text-center">
                <span className={row.won ? "text-lime-300" : "text-zinc-600"}>
                  {row.won ? <Check className="mx-auto size-4" aria-label="Win" /> : <Minus className="mx-auto size-4" aria-label="Loss" />}
                </span>
              </td>
              <td className="px-5 py-4 text-right">
                <p className="font-mono text-lg font-black text-lime-300">{Number(row.baseScore).toFixed(2)}</p>
                <p className="mt-1 text-[0.65rem] text-zinc-600" title="Kill + death + assist + CS breakdown">
                  {points(row.breakdown.kills)} {points(row.breakdown.deaths)} {points(row.breakdown.assists)} {points(row.breakdown.cs)}
                </p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
