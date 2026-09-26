import type { Sql, TransactionSql } from "postgres";
import { PRICING_METHOD, PRICING_VERSION, type PlayerPrice } from "@/lib/domain/pricing";
import { validateRoster, type RosterCatalogPlayer } from "@/lib/domain/roster";
import { PRO_ROLES, type NormalizedTournament, type TeamRoster, type TournamentTeam } from "@/lib/domain/types";

type Db = Sql | TransactionSql<Record<string, never>>;

const json = (value: unknown) => JSON.stringify(value ?? null);

export interface CatalogPlayer extends PlayerPrice {
  providerId: string;
  displayName: string;
  imageUrl: string | null;
  teamProviderId: string;
  rosterStatus: string | null;
  rosterCheckedAt: string | null;
  raw: unknown;
  statsRaw: unknown;
}

export interface StageCatalogInput {
  tournament: NormalizedTournament;
  teams: TournamentTeam[];
  rosters: TeamRoster[];
  players: CatalogPlayer[];
  slug: string;
  name: string;
  lockAt: string;
  warnings: string[];
}

export function catalogHasValidRoster(players: CatalogPlayer[], salaryCap = 50_000_000, teamLimit = 2) {
  const byRole = new Map(PRO_ROLES.map((role) => [role, players.filter((player) => player.role === role)]));
  if (PRO_ROLES.some((role) => (byRole.get(role)?.length ?? 0) === 0)) return false;

  const search = (roleIndex: number, chosen: RosterCatalogPlayer[]): boolean => {
    if (roleIndex === PRO_ROLES.length) {
      const playerIds = chosen.map((player) => player.id);
      return validateRoster(
        { playerIds, captainPlayerId: playerIds[0] },
        chosen,
        { salaryCap, maxPlayersPerTeam: teamLimit },
      ).valid;
    }
    return byRole.get(PRO_ROLES[roleIndex])!.some((player) => search(roleIndex + 1, [
      ...chosen,
      { id: player.providerId, teamId: player.teamProviderId, role: player.role, price: player.price, eligible: true },
    ]));
  };
  return search(0, []);
}

export async function getExistingStage(sql: Sql, tournamentProviderId: string, slug: string) {
  const rows = await sql<Array<{ id: string; status: string; player_count: number }>>`
    select s.id, s.status, count(tp.id)::int as player_count
    from tournament_stages s
    join tournaments t on t.id = s.tournament_id
    left join tournament_players tp on tp.stage_id = s.id and tp.eligible
    where t.provider = 'cito' and t.provider_id = ${tournamentProviderId} and s.slug = ${slug}
    group by s.id
  `;
  return rows[0] ?? null;
}

async function upsertTeam(sql: Db, tournamentId: string, source: TournamentTeam | TeamRoster["team"]) {
  const team = "team" in source ? source.team : source;
  const raw = "team" in source ? source.raw : source.raw;
  const rows = await sql<Array<{ id: string }>>`
    insert into pro_teams (provider, provider_id, name, abbreviation, image_url, raw_payload)
    values ('cito', ${team.providerId}, ${team.name}, ${team.abbreviation}, ${team.imageUrl ?? null}, ${json(raw)}::jsonb)
    on conflict (provider, provider_id) do update set
      name = excluded.name, abbreviation = excluded.abbreviation,
      image_url = excluded.image_url, raw_payload = excluded.raw_payload
    returning id
  `;
  await sql`
    insert into tournament_teams (tournament_id, team_id, source_updated_at, raw_payload)
    values (${tournamentId}, ${rows[0].id}, now(), ${json(raw)}::jsonb)
    on conflict (tournament_id, team_id) do update set
      source_updated_at = excluded.source_updated_at, raw_payload = excluded.raw_payload
  `;
  return rows[0].id;
}

export async function persistStageCatalog(sql: Sql, input: StageCatalogInput) {
  if (!catalogHasValidRoster(input.players)) {
    throw new Error("The synchronized catalog cannot produce a valid five-role roster under the salary and team limits.");
  }

  return sql.begin(async (tx) => {
    const tournaments = await tx<Array<{ id: string }>>`
      insert into tournaments (provider, provider_id, name, start_time, end_time, raw_payload, source_updated_at)
      values ('cito', ${input.tournament.providerId}, ${input.tournament.name}, ${input.tournament.startTime},
        ${input.tournament.endTime}, ${json(input.tournament.raw)}::jsonb, now())
      on conflict (provider, provider_id) do update set
        name = excluded.name, start_time = excluded.start_time, end_time = excluded.end_time,
        raw_payload = excluded.raw_payload, source_updated_at = now()
      returning id
    `;
    const tournamentId = tournaments[0].id;
    const existing = await tx<Array<{ id: string; status: string }>>`
      select id, status from tournament_stages
      where tournament_id = ${tournamentId} and slug = ${input.slug}
      for update
    `;
    if (existing[0] && existing[0].status !== "UPCOMING") {
      throw new Error(`Stage ${input.slug} is already ${existing[0].status}; its catalog is immutable.`);
    }
    const sequenceRows = await tx<Array<{ sequence: number }>>`
      select coalesce(max(sequence), 0)::int + 1 as sequence from tournament_stages where tournament_id = ${tournamentId}
    `;
    const stages = existing[0]
      ? await tx<Array<{ id: string }>>`
          update tournament_stages set name = ${input.name}, roster_lock_time = ${input.lockAt},
            start_time = coalesce(start_time, now()), salary_cap = 50000000, max_players_per_team = 2
          where id = ${existing[0].id} returning id
        `
      : await tx<Array<{ id: string }>>`
          insert into tournament_stages (
            tournament_id, slug, name, sequence, start_time, roster_lock_time, status, salary_cap, max_players_per_team
          ) values (
            ${tournamentId}, ${input.slug}, ${input.name}, ${sequenceRows[0].sequence}, now(), ${input.lockAt},
            'UPCOMING', 50000000, 2
          ) returning id
        `;
    const stageId = stages[0].id;
    await tx`delete from player_stage_prices where stage_id = ${stageId}`;
    await tx`delete from tournament_players where stage_id = ${stageId}`;

    const teamIds = new Map<string, string>();
    for (const team of input.teams) teamIds.set(team.team.providerId, await upsertTeam(tx, tournamentId, team));
    for (const roster of input.rosters) {
      if (!teamIds.has(roster.team.providerId)) {
        teamIds.set(roster.team.providerId, await upsertTeam(tx, tournamentId, roster.team));
      }
    }

    for (const player of input.players) {
      const teamId = teamIds.get(player.teamProviderId);
      if (!teamId) throw new Error(`Team ${player.teamProviderId} was not persisted.`);
      const playerRows = await tx<Array<{ id: string }>>`
        insert into pro_players (provider, provider_id, display_name, current_team_id, role, image_url, raw_payload)
        values ('cito', ${player.providerId}, ${player.displayName}, ${teamId}, ${player.role},
          ${player.imageUrl}, ${json(player.raw)}::jsonb)
        on conflict (provider, provider_id) do update set
          display_name = excluded.display_name, current_team_id = excluded.current_team_id,
          role = excluded.role, image_url = excluded.image_url, raw_payload = excluded.raw_payload
        returning id
      `;
      const playerId = playerRows[0].id;
      await tx`
        insert into tournament_players (
          tournament_id, stage_id, player_id, team_id, role, is_starter, eligible,
          roster_status, roster_checked_at, raw_payload
        ) values (
          ${tournamentId}, ${stageId}, ${playerId}, ${teamId}, ${player.role}, true, true,
          ${player.rosterStatus}, ${player.rosterCheckedAt}, ${json(player.raw)}::jsonb
        )
      `;
      await tx`
        insert into player_stage_prices (
          stage_id, player_id, projected_ppg, price, role_percentile, pricing_method,
          pricing_version, eligible, source_stats
        ) values (
          ${stageId}, ${playerId}, ${player.projectedPpg}, ${player.price}, ${player.rolePercentile},
          ${PRICING_METHOD}, ${PRICING_VERSION}, true, ${json(player.statsRaw)}::jsonb
        )
      `;
    }

    await tx`update tournament_stages set status = 'OPEN' where id = ${stageId}`;
    return { stageId, status: "OPEN" as const, players: input.players.length, warnings: input.warnings };
  });
}
