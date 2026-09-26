"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Clock3, Crown, Search, ShieldAlert, UserPlus, X } from "lucide-react";
import { saveRosterAction } from "@/app/play/actions";
import { DRAFT_VERSION, parseRosterDraft } from "@/lib/domain/draft";
import { validateRoster } from "@/lib/domain/roster";
import { PRO_ROLES, type ProRole } from "@/lib/domain/types";
import type { StageRosterView } from "@/lib/rosters/queries";

const money = (value: number) => `$${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;

function timeLeft(lockAt: string, now: number) {
  const milliseconds = new Date(lockAt).valueOf() - now;
  if (milliseconds <= 0) return "Locked";
  const days = Math.floor(milliseconds / 86_400_000);
  const hours = Math.floor((milliseconds / 3_600_000) % 24);
  const minutes = Math.floor((milliseconds / 60_000) % 60);
  return days > 0 ? `${days}d ${hours}h remaining` : `${hours}h ${minutes}m remaining`;
}

export function RosterBuilder({ stage, userId }: { stage: StageRosterView; userId: string }) {
  const byId = useMemo(() => new Map(stage.players.map((player) => [player.id, player])), [stage.players]);
  const savedSelections = useMemo(() => Object.fromEntries(
    (stage.savedRoster?.playerIds ?? []).map((id) => [byId.get(id)?.role, id]).filter(([role]) => role),
  ) as Partial<Record<ProRole, string>>, [byId, stage.savedRoster]);
  const [selections, setSelections] = useState<Partial<Record<ProRole, string>>>(savedSelections);
  const [captain, setCaptain] = useState<string | null>(stage.savedRoster?.captainPlayerId ?? null);
  const [activeRole, setActiveRole] = useState<ProRole | "ALL">("ALL");
  const [team, setTeam] = useState("ALL");
  const [maxPrice, setMaxPrice] = useState(stage.players.reduce((max, player) => Math.max(max, player.price), 0));
  const [sort, setSort] = useState<"points" | "price" | "priceAsc" | "value">("points");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => new Date(stage.databaseNow).valueOf());
  const [message, setMessage] = useState<string | null>(stage.savedRoster ? "Saved lineup loaded." : null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [pending, startTransition] = useTransition();
  const storageKey = `lol-fantasy:draft:${userId}:${stage.id}`;

  useEffect(() => {
    const draft = parseRosterDraft(localStorage.getItem(storageKey), stage.players);
    const restore = window.setTimeout(() => {
      if (draft) {
        setSelections(draft.selections);
        setCaptain(draft.captainPlayerId);
        setMessage("Local draft restored.");
      }
      setDraftHydrated(true);
    }, 0);
    return () => window.clearTimeout(restore);
  }, [stage.players, storageKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    localStorage.setItem(storageKey, JSON.stringify({ version: DRAFT_VERSION, selections, captainPlayerId: captain }));
  }, [captain, draftHydrated, selections, storageKey]);

  const selectedPlayers = PRO_ROLES.map((role) => byId.get(selections[role] ?? "")).filter((player) => player !== undefined);
  const validation = validateRoster(
    { playerIds: selectedPlayers.map((player) => player.id), captainPlayerId: captain ?? "" },
    stage.players.map((player) => ({
      id: player.id, teamId: player.teamId, role: player.role, price: player.price, eligible: player.eligible,
    })),
    { salaryCap: stage.salaryCap, maxPlayersPerTeam: stage.maxPlayersPerTeam },
  );
  const locked = stage.status !== "OPEN" || now >= new Date(stage.lockAt).valueOf();
  const teamCounts = selectedPlayers.reduce((counts, player) => {
    counts.set(player.teamId, (counts.get(player.teamId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const teams = [...new Map(stage.players.map((player) => [player.teamId, player.teamName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const visiblePlayers = stage.players
    .filter((player) => activeRole === "ALL" || player.role === activeRole)
    .filter((player) => team === "ALL" || player.teamId === team)
    .filter((player) => player.price <= maxPrice)
    .filter((player) => player.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === "price"
      ? b.price - a.price
      : sort === "priceAsc"
        ? a.price - b.price
      : sort === "value"
        ? b.projectedPpg / b.price - a.projectedPpg / a.price
        : b.projectedPpg - a.projectedPpg);

  function persistDraft(nextSelections: Partial<Record<ProRole, string>>, nextCaptain: string | null) {
    localStorage.setItem(storageKey, JSON.stringify({
      version: DRAFT_VERSION,
      selections: nextSelections,
      captainPlayerId: nextCaptain,
    }));
  }

  function addPlayer(playerId: string) {
    const player = byId.get(playerId)!;
    const next = { ...selections, [player.role]: player.id };
    setSelections(next);
    persistDraft(next, captain);
    setMessage(null);
    setServerErrors([]);
  }

  function removeRole(role: ProRole) {
    const removed = selections[role];
    const next = { ...selections };
    delete next[role];
    const nextCaptain = captain === removed ? null : captain;
    setSelections(next);
    setCaptain(nextCaptain);
    persistDraft(next, nextCaptain);
    setMessage(null);
  }

  function submit() {
    startTransition(async () => {
      const result = await saveRosterAction({
        stageId: stage.id,
        playerIds: selectedPlayers.map((player) => player.id),
        captainPlayerId: captain,
      });
      if (!result.ok) {
        setServerErrors(result.errors ?? ["Unable to save this lineup."]);
        return;
      }
      localStorage.removeItem(storageKey);
      setServerErrors([]);
      setMessage(`Lineup saved ${new Date(result.saved!.submittedAt).toLocaleString()}.`);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <section className="min-w-0">
        <div className="flex gap-2 overflow-x-auto pb-3">
          {(["ALL", ...PRO_ROLES] as const).map((role) => (
            <button key={role} onClick={() => setActiveRole(role)} className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs font-black tracking-wide transition ${activeRole === role ? "border-lime-300/40 bg-lime-300/12 text-lime-300" : "border-white/8 bg-white/[0.025] text-zinc-500 hover:text-zinc-200"}`}>
              {role === "ALL" ? "ALL ROLES" : role}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 rounded-2xl border border-white/8 bg-black/20 p-3 sm:grid-cols-4">
          <label className="relative sm:col-span-2">
            <Search className="absolute left-3 top-3.5 size-4 text-zinc-600" />
            <input aria-label="Search players" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search players" className="w-full rounded-xl border border-white/8 bg-black/30 py-3 pl-10 pr-3 text-sm outline-none focus:border-cyan-300/50" />
          </label>
          <select aria-label="Filter by team" value={team} onChange={(event) => setTeam(event.target.value)} className="rounded-xl border border-white/8 bg-zinc-950 px-3 py-3 text-sm text-zinc-300">
            <option value="ALL">All teams</option>
            {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="Sort players" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="rounded-xl border border-white/8 bg-zinc-950 px-3 py-3 text-sm text-zinc-300">
            <option value="points">Projected points</option>
            <option value="price">Highest price</option>
            <option value="priceAsc">Lowest price</option>
            <option value="value">Best value</option>
          </select>
          <label className="sm:col-span-4 flex items-center gap-3 px-1 text-xs text-zinc-500">
            Max price {money(maxPrice)}
            <input type="range" min={8_000_000} max={12_000_000} step={500_000} value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} className="accent-lime-300" />
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visiblePlayers.map((player) => {
            const selected = selections[player.role] === player.id;
            const replacingSameTeam = byId.get(selections[player.role] ?? "")?.teamId === player.teamId;
            const teamFull = (teamCounts.get(player.teamId) ?? 0) >= stage.maxPlayersPerTeam && !replacingSameTeam;
            const disabled = locked || selected || teamFull || !player.eligible;
            const reason = locked ? "Stage locked" : selected ? "Selected" : teamFull ? "Team limit reached" : !player.eligible ? "Ineligible" : null;
            return (
              <article key={player.id} className={`overflow-hidden rounded-2xl border bg-gradient-to-br from-white/[0.055] to-white/[0.015] p-4 transition ${selected ? "border-lime-300/35" : "border-white/8 hover:border-cyan-300/20"}`}>
                <div className="flex items-start gap-3">
                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-black/30 font-black text-zinc-500">
                    {player.imageUrl ? <img src={player.imageUrl} alt="" className="h-full w-full object-cover" /> : player.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-black tracking-[0.15em] text-cyan-300">{player.role}</span><span className="text-sm font-black text-lime-300">{money(player.price)}</span></div>
                    <h2 className="mt-1 truncate text-lg font-black text-white">{player.name}</h2>
                    <p className="truncate text-xs text-zinc-500">{player.teamName}</p>
                  </div>
                </div>
                <div className="mt-5 flex items-end justify-between border-t border-white/8 pt-4">
                  <div><span className="block text-2xl font-black tracking-tight text-white">{player.projectedPpg.toFixed(1)}</span><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Projected FP/G</span></div>
                  <button disabled={disabled} title={reason ?? "Add to lineup"} onClick={() => addPlayer(player.id)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-zinc-200 transition hover:border-lime-300/30 hover:text-lime-300 disabled:cursor-not-allowed disabled:opacity-35">
                    {selected ? <span className="flex items-center gap-1"><Check className="size-3" /> Added</span> : "Add"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {visiblePlayers.length === 0 && <p className="py-16 text-center text-sm text-zinc-600">No players match these filters.</p>}
      </section>

      <aside className="h-fit rounded-2xl border border-white/10 bg-[#0b0e0c]/95 p-5 shadow-2xl shadow-black/20 lg:sticky lg:top-6">
        <div className="flex items-center justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">Your lineup</p><h2 className="mt-1 text-xl font-black text-white">Starting five</h2></div>
          <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${locked ? "bg-rose-300/10 text-rose-300" : "bg-cyan-300/10 text-cyan-300"}`}>{locked ? "Locked" : "Open"}</span>
        </div>
        <div className="mt-5 space-y-2">
          {PRO_ROLES.map((role) => {
            const player = byId.get(selections[role] ?? "");
            return (
              <div key={role} className="flex min-h-16 items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-3">
                <span className="w-14 text-[9px] font-black tracking-wider text-zinc-600">{role}</span>
                {player ? <>
                  <button onClick={() => { setCaptain(player.id); persistDraft(selections, player.id); }} className={`grid size-8 place-items-center rounded-lg border ${captain === player.id ? "border-amber-300/40 bg-amber-300/12 text-amber-300" : "border-white/8 text-zinc-700 hover:text-amber-300"}`} title="Make captain"><Crown className="size-3.5" /></button>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-zinc-100">{player.name}</p><p className="text-[10px] text-zinc-600">{player.teamAbbreviation ?? player.teamName} · {money(player.price)}</p></div>
                  <button onClick={() => removeRole(role)} disabled={locked} aria-label={`Remove ${player.name}`} className="text-zinc-700 hover:text-rose-300 disabled:opacity-30"><X className="size-4" /></button>
                </> : <span className="text-xs text-zinc-700">Empty slot</span>}
              </div>
            );
          })}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-y border-white/8 py-5">
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Used</p><p className={`mt-1 text-lg font-black ${validation.totalSalary > stage.salaryCap ? "text-rose-300" : "text-white"}`}>{money(validation.totalSalary)}</p></div>
          <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Remaining</p><p className="mt-1 text-lg font-black text-lime-300">{money(stage.salaryCap - validation.totalSalary)}</p></div>
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500"><Clock3 className="size-3.5" />{timeLeft(stage.lockAt, now)} · {new Date(stage.lockAt).toLocaleString()}</p>
        {!validation.valid && selectedPlayers.length > 0 && <div className="mt-4 space-y-1 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3">{validation.errors.slice(0, 3).map((error) => <p key={error} className="flex gap-2 text-xs text-amber-200"><ShieldAlert className="mt-0.5 size-3 shrink-0" />{error}</p>)}</div>}
        {serverErrors.length > 0 && <div role="alert" className="mt-4 space-y-1 rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-3">{serverErrors.map((error) => <p key={error} className="text-xs text-rose-200">{error}</p>)}</div>}
        {message && <p role="status" className="mt-4 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.05] p-3 text-xs text-cyan-200">{message}</p>}
        <button onClick={submit} disabled={pending || locked || !validation.valid} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-lime-300 px-4 py-3 font-black text-zinc-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-35">
          {pending ? "Saving…" : stage.savedRoster ? "Update lineup" : <><UserPlus className="size-4" /> Submit lineup</>}
        </button>
        <p className="mt-3 text-center text-[10px] leading-4 text-zinc-600">Captain scores 1.5×. You can edit until the stage locks.</p>
      </aside>
    </div>
  );
}
