/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Database,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireOperator } from "@/lib/operators/access";
import { getOperatorWorldsView } from "@/lib/operators/queries";
import {
  connectWorldsTournamentAction,
  discoverWorldsTournamentsAction,
  refreshWorldsTeamsAction,
} from "./actions";

export const dynamic = "force-dynamic";

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not supplied";
}

export default async function WorldsOperationsPage({ searchParams }: {
  searchParams: Promise<{ notice?: string | string[]; error?: string | string[] }>;
}) {
  await requireOperator();
  const [view, query] = await Promise.all([getOperatorWorldsView(), searchParams]);
  if (!view) notFound();
  const notice = firstQueryValue(query.notice);
  const error = firstQueryValue(query.error);
  const teamIds = view.teams.map((team) => team.providerId).join(",");
  const bootstrapCommand = view.tournamentProviderId && teamIds
    ? `npm run stage:bootstrap -- --tournament ${view.tournamentProviderId} --stage worlds-stage-slug --name "Worlds stage name" --lock-at 2026-10-20T00:00:00Z --teams ${teamIds}`
    : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/worlds" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-500 hover:text-white">
            <ArrowLeft className="size-3.5" />Worlds hub
          </Link>
          <div className="mt-5 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300"><ShieldCheck className="size-5" /></span>
            <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">Operator console</p><h1 className="text-3xl font-black tracking-tight text-white">Worlds readiness</h1></div>
          </div>
        </div>
        <Badge className="w-fit border-cyan-300/20 bg-cyan-300/8 text-cyan-300">Restricted access</Badge>
      </div>

      {(notice || error) && (
        <div className={`mt-6 rounded-xl border px-4 py-3 text-sm font-bold ${error ? "border-rose-300/20 bg-rose-300/8 text-rose-200" : "border-lime-300/20 bg-lime-300/8 text-lime-300"}`}>
          {error ?? notice}
        </div>
      )}

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">Competition connection</p><h2 className="mt-2 text-xl font-black text-white">{view.tournamentName ?? "No tournament connected"}</h2><p className="mt-1 font-mono text-xs text-zinc-500">{view.tournamentProviderId ?? "Awaiting provider selection"}</p></div>
            <Badge className={view.tournamentId ? "border-lime-300/20 bg-lime-300/8 text-lime-300" : "text-zinc-500"}>{view.tournamentId ? "Connected" : "Draft"}</Badge>
          </div>
          <div className="mt-5 grid gap-3 border-t border-white/8 pt-5 sm:grid-cols-3">
            <div><p className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Provider check</p><p className="mt-1 text-xs text-zinc-300">{formatDate(view.providerCheckedAt)}</p></div>
            <div><p className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Known teams</p><p className="mt-1 font-mono text-lg font-black text-white">{view.teams.length}</p></div>
            <div><p className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Roster windows</p><p className="mt-1 font-mono text-lg font-black text-white">{view.stages.length}</p></div>
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">Provider catalog</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">Discovery reads the current Cito catalog and stores only World Championship candidates for review.</p>
          <form action={discoverWorldsTournamentsAction} className="mt-5"><button className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-xs font-black uppercase tracking-wider text-zinc-950 hover:bg-cyan-200"><RefreshCw className="size-3.5" />Discover tournaments</button></form>
        </Card>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">Review gate</p><h2 className="mt-2 text-2xl font-black text-white">Tournament candidates</h2></div><p className="text-xs text-zinc-600">{view.candidates.length} found</p></div>
        {view.candidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center"><CalendarDays className="mx-auto size-7 text-zinc-700" /><p className="mt-3 text-sm font-bold text-zinc-400">No Worlds candidate is stored</p><p className="mt-1 text-xs text-zinc-600">Run discovery when the provider catalog is ready.</p></div>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {view.candidates.map((candidate) => {
              const connected = candidate.providerId === view.tournamentProviderId;
              return (
                <Card key={candidate.id} className={`p-5 ${connected ? "border-lime-300/25" : ""}`}>
                  <div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-white">{candidate.name}</h3>{candidate.isInternational && <Badge className="border-cyan-300/20 bg-cyan-300/8 text-cyan-300">International</Badge>}</div><p className="mt-1 text-xs text-zinc-500">{candidate.leagueName ?? candidate.leagueSlug ?? "League not supplied"}</p><p className="mt-2 font-mono text-[10px] text-zinc-600">{candidate.providerId}</p></div>{connected && <CheckCircle2 className="size-5 shrink-0 text-lime-300" />}</div>
                  <div className="mt-4 flex items-end justify-between gap-3 border-t border-white/8 pt-4"><div><p className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Starts</p><p className="mt-1 text-xs text-zinc-400">{formatDate(candidate.startTime)}</p></div>{connected ? <span className="text-xs font-black text-lime-300">Connected</span> : <form action={connectWorldsTournamentAction}><input type="hidden" name="candidateId" value={candidate.id} /><button className="rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/5">Connect</button></form>}</div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-lime-300">Tournament field</p><h2 className="mt-2 text-xl font-black text-white">Discovered teams</h2><p className="mt-1 text-sm text-zinc-500">Refresh from tournament matches before building a stage catalog.</p></div><form action={refreshWorldsTeamsAction}><button disabled={!view.tournamentId} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"><Users className="size-3.5" />Refresh teams</button></form></div>
          {view.teams.length === 0 ? <p className="mt-6 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-600">No teams have been discovered for the connected tournament.</p> : <div className="mt-5 grid gap-2 sm:grid-cols-2">{view.teams.map((team) => <div key={team.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/15 p-3"><span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/8 bg-black/20 text-[9px] font-black text-zinc-600">{team.imageUrl ? <img src={team.imageUrl} alt="" className="h-full w-full object-contain p-1" /> : (team.abbreviation ?? team.name.slice(0, 2)).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-black text-white">{team.name}</p><p className="font-mono text-[9px] text-zinc-600">{team.providerId}</p></div></div>)}</div>}
        </Card>
        <Card className="p-5"><Database className="size-5 text-zinc-500" /><h3 className="mt-4 font-black text-white">Immutable stage catalogs</h3><p className="mt-2 text-sm leading-6 text-zinc-500">Opening a stage freezes its eligible players and prices. Eliminated teams are omitted with the explicit team list for the next window.</p></Card>
      </section>

      <section className="mt-10">
        <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">Stage readiness</p><h2 className="mt-2 text-2xl font-black text-white">Roster windows</h2></div>
        {view.stages.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center"><CircleDot className="mx-auto size-7 text-zinc-700" /><p className="mt-3 text-sm font-bold text-zinc-400">No Worlds stage catalog exists yet</p></div> : <div className="mt-4 grid gap-3 lg:grid-cols-2">{view.stages.map((stage) => <Card key={stage.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Stage {String(stage.sequence).padStart(2, "0")}</p><h3 className="mt-1 font-black text-white">{stage.name}</h3></div><Badge>{stage.status}</Badge></div><div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/8 pt-4 text-center"><div><p className="font-mono text-lg font-black text-white">{stage.eligibleTeams}</p><p className="text-[9px] uppercase text-zinc-600">Teams</p></div><div><p className="font-mono text-lg font-black text-white">{stage.eligiblePlayers}</p><p className="text-[9px] uppercase text-zinc-600">Players</p></div><div><p className="font-mono text-lg font-black text-white">{stage.assignedMatches}</p><p className="text-[9px] uppercase text-zinc-600">Matches</p></div></div></Card>)}</div>}
      </section>

      <section className="mt-10">
        <Card className="overflow-hidden p-0">
          <div className="flex items-start gap-3 border-b border-white/8 p-5"><TerminalSquare className="mt-0.5 size-5 text-amber-200" /><div><h2 className="font-black text-white">Bootstrap the next roster window</h2><p className="mt-1 text-sm text-zinc-500">Run this explicit operator job locally. Review the stage slug, name, lock time, and surviving teams first.</p></div></div>
          <div className="p-5">{bootstrapCommand ? <code className="block overflow-x-auto rounded-xl border border-white/8 bg-black/30 p-4 font-mono text-xs leading-6 text-zinc-300">{bootstrapCommand}</code> : <p className="text-sm text-zinc-600">Connect a tournament and refresh its teams to generate the command.</p>}<p className="mt-4 flex items-center gap-2 text-xs text-zinc-600"><ExternalLink className="size-3.5" />Catalog pricing remains a deliberate long-running job until a durable worker is available.</p></div>
        </Card>
      </section>
    </main>
  );
}
