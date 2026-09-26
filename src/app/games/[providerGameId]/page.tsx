import Link from "next/link";
import { ArrowLeft, Clock3, Database, Swords } from "lucide-react";
import { notFound } from "next/navigation";
import { ScoreTable } from "@/components/score-table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getGameScoreView } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: Promise<{ providerGameId: string }> }) {
  const { providerGameId } = await params;
  const view = await getGameScoreView(providerGameId).catch(() => null);
  if (!view) notFound();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-zinc-500 transition hover:text-white">
        <ArrowLeft className="size-4" /> Back to pipeline
      </Link>

      <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={view.sourceKind === "fixture" ? "border-amber-300/20 text-amber-300" : "border-cyan-300/20 text-cyan-300"}>
              {view.sourceKind === "fixture" ? "Synthetic fixture" : "Cito live data"}
            </Badge>
            <Badge>{view.status}</Badge>
          </div>
          <h1 className="mt-5 text-3xl font-black tracking-[-0.03em] text-white sm:text-5xl">{view.tournamentName}</h1>
          <p className="mt-2 text-zinc-500">
            {view.stageLabel ?? "Unassigned stage"}{view.gameNumber ? ` · Game ${view.gameNumber}` : ""}
          </p>
        </div>
        <div className="space-y-2 text-xs text-zinc-500 sm:text-right">
          <p className="flex items-center gap-2 sm:justify-end"><Swords className="size-3.5" /> Match {view.providerMatchId}</p>
          <p className="flex items-center gap-2 sm:justify-end"><Database className="size-3.5" /> {view.rulesetName}</p>
          <p className="flex items-center gap-2 sm:justify-end"><Clock3 className="size-3.5" /> {new Date(view.ingestedAt).toLocaleString()}</p>
        </div>
      </div>

      <Card className="mt-8 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Fantasy scorecard</p>
            <p className="mt-1 text-sm text-zinc-400">Base points before roster captain multipliers</p>
          </div>
          <span className="font-mono text-xs text-zinc-600">{view.rows.length} players</span>
        </div>
        <ScoreTable rows={view.rows} />
      </Card>

      {view.sourceKind === "fixture" && (
        <p className="mt-5 text-center text-xs leading-5 text-amber-200/60">
          This screen contains synthetic contract-fixture statistics, not real player performance data.
        </p>
      )}
    </main>
  );
}
