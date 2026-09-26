import Link from "next/link";
import { ArrowRight, Braces, DatabaseZap, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PipelineEmptyState } from "@/components/pipeline-empty-state";
import { getLatestGame } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  let latest = null;
  let databaseUnavailable = false;
  try {
    latest = await getLatestGame();
  } catch {
    databaseUnavailable = true;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <div className="max-w-3xl">
        <Badge className="border-lime-300/20 bg-lime-300/8 text-lime-300">Technical milestone 01</Badge>
        <h1 className="mt-6 text-4xl font-black leading-[0.98] tracking-[-0.04em] text-white sm:text-6xl">
          Completed games in.
          <br />Deterministic scores out.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
          The first LoL Fantasy vertical slice stores authoritative esports stats locally, applies a versioned scoring model, and can safely replay the same game without duplicating points.
        </p>
      </div>

      <section className="mt-12">
        {latest ? (
          <Link href={`/games/${encodeURIComponent(latest.providerGameId)}`} className="group block">
            <Card className="overflow-hidden p-1 transition duration-300 group-hover:border-cyan-300/25">
              <div className="flex flex-col gap-6 rounded-[0.8rem] bg-gradient-to-br from-white/[0.055] to-transparent p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge className={latest.sourceKind === "fixture" ? "text-amber-300" : "text-cyan-300"}>
                      {latest.sourceKind === "fixture" ? "Sample fixture" : "Cito live data"}
                    </Badge>
                    <span className="text-xs text-zinc-600">{new Date(latest.ingestedAt).toLocaleString()}</span>
                  </div>
                  <h2 className="mt-4 text-2xl font-bold text-white">{latest.tournamentName}</h2>
                  <p className="mt-1 font-mono text-sm text-zinc-500">{latest.providerGameId}</p>
                </div>
                <span className="flex items-center gap-2 text-sm font-black text-cyan-300">
                  View scored game <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                </span>
              </div>
            </Card>
          </Link>
        ) : (
          <PipelineEmptyState databaseUnavailable={databaseUnavailable} />
        )}
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          [DatabaseZap, "Local first", "Versioned PostgreSQL migrations and stored source payloads."],
          [Braces, "Provider boundary", "Cito response validation stays outside fantasy domain logic."],
          [ShieldCheck, "Replay safe", "Unique provider IDs and upserts make ingestion idempotent."],
        ].map(([Icon, title, description]) => {
          const Component = Icon as typeof DatabaseZap;
          return (
            <Card key={String(title)} className="p-5">
              <Component className="size-5 text-zinc-500" aria-hidden="true" />
              <h3 className="mt-4 font-bold text-zinc-100">{String(title)}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{String(description)}</p>
            </Card>
          );
        })}
      </section>
    </main>
  );
}
