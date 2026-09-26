import { Database, Terminal } from "lucide-react";
import { Card } from "@/components/ui/card";

export function PipelineEmptyState({ databaseUnavailable = false }: { databaseUnavailable?: boolean }) {
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-cyan-300/15 bg-cyan-300/8 text-cyan-300">
          <Database className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-black uppercase tracking-[0.16em] text-zinc-500">
            {databaseUnavailable ? "Database unavailable" : "No games ingested"}
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            {databaseUnavailable ? "Start the local data stack" : "The pipeline is ready for its first run"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Start and reset local Supabase, then ingest the clearly labeled synthetic fixture. The same
            path is used by live Cito imports.
          </p>
          <div className="mt-5 space-y-2 rounded-xl border border-white/8 bg-black/30 p-4 font-mono text-xs text-zinc-300">
            <p className="flex gap-2"><Terminal className="mt-0.5 size-3.5 text-lime-300" /> npm run db:start</p>
            <p className="flex gap-2"><Terminal className="mt-0.5 size-3.5 text-lime-300" /> npm run db:reset</p>
            <p className="flex gap-2"><Terminal className="mt-0.5 size-3.5 text-lime-300" /> npm run ingest:fixture</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
