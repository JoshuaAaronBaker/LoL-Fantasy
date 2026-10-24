import type { JSONValue, Sql } from "postgres";
import {
  PRICING_METHOD,
  PRICING_VERSION,
  WORLDS_PRICING_METHOD,
  WORLDS_PRICING_VERSION,
  priceProjectedPlayers,
  priceWorldsRankedPlayers,
} from "@/lib/domain/pricing";
import { validateRoster, type RosterCatalogPlayer } from "@/lib/domain/roster";
import { PRO_ROLES, type ProRole } from "@/lib/domain/types";

export interface StageRolloverInput {
  sourceStageId: string;
  slug: string;
  name: string;
  lockAt: string;
  eligibleTeamProviderIds: string[];
}

export function hasValidRoster(players: RosterCatalogPlayer[]) {
  const byRole = new Map(PRO_ROLES.map((role) => [
    role,
    players.filter((player) => player.role === role),
  ]));
  if (PRO_ROLES.some((role) => (byRole.get(role)?.length ?? 0) === 0)) return false;

  const search = (roleIndex: number, chosen: RosterCatalogPlayer[]): boolean => {
    if (roleIndex === PRO_ROLES.length) {
      const playerIds = chosen.map((player) => player.id);
      return validateRoster(
        { playerIds, captainPlayerId: playerIds[0] },
        chosen,
        { salaryCap: 50_000_000, maxPlayersPerTeam: 2 },
      ).valid;
    }
    return byRole.get(PRO_ROLES[roleIndex])!.some((player) => search(roleIndex + 1, [
      ...chosen,
      player,
    ]));
  };

  return search(0, []);
}

export async function openNextRoundFromStage(sql: Sql, input: StageRolloverInput) {
  const lockAt = new Date(input.lockAt);
  if (Number.isNaN(lockAt.valueOf()) || lockAt <= new Date()) {
    throw new Error("The round lock must be a future ISO timestamp.");
  }
  const requestedTeams = input.eligibleTeamProviderIds.map((value) => value.trim()).filter(Boolean);
  if (requestedTeams.length === 0 || new Set(requestedTeams).size !== requestedTeams.length) {
    throw new Error("Choose one or more unique teams playing the next round.");
  }

  return sql.begin(async (tx) => {
    const sourceRows = await tx<Array<{
      id: string;
      tournament_id: string;
      sequence: number;
      tournament_provider_id: string;
      tournament_name: string;
    }>>`
      select stage.id, stage.tournament_id, stage.sequence,
        tournament.provider_id as tournament_provider_id, tournament.name as tournament_name
      from tournament_stages stage
      join tournaments tournament on tournament.id = stage.tournament_id
      where stage.id = ${input.sourceStageId}
      for update
    `;
    const source = sourceRows[0];
    if (!source) throw new Error("The source stage does not exist.");

    const teamRows = await tx<Array<{ id: string; provider_id: string }>>`
      select distinct team.id, team.provider_id
      from tournament_players player
      join pro_teams team on team.id = player.team_id
      where player.stage_id = ${source.id}
        and player.eligible
        and team.provider = 'cito'
        and team.provider_id in ${tx(requestedTeams)}
    `;
    const teamByProviderId = new Map(teamRows.map((team) => [team.provider_id, team.id]));
    const missingTeams = requestedTeams.filter((providerId) => !teamByProviderId.has(providerId));
    if (missingTeams.length > 0) {
      throw new Error(`Teams are not eligible in the source stage: ${missingTeams.join(", ")}.`);
    }
    const teamIds = teamRows.map((team) => team.id);

    const sourcePlayers = await tx<Array<{
      player_id: string;
      display_name: string;
      team_id: string;
      role: ProRole;
      is_starter: boolean;
      roster_status: string | null;
      roster_checked_at: string | null;
      raw_payload: JSONValue;
      projected_ppg: string;
      source_stats: JSONValue;
    }>>`
      select player.player_id, professional.display_name, player.team_id, player.role, player.is_starter,
        player.roster_status, player.roster_checked_at::text, player.raw_payload,
        price.projected_ppg::text, price.source_stats
      from tournament_players player
      join player_stage_prices price
        on price.stage_id = player.stage_id and price.player_id = player.player_id
      join pro_players professional on professional.id = player.player_id
      where player.stage_id = ${source.id}
        and player.eligible
        and player.team_id in ${tx(teamIds)}
      order by player.role, player.player_id
    `;
    const pricingInputs = sourcePlayers.map((player) => ({
      ...player,
      playerId: player.player_id,
      displayName: player.display_name,
      projectedPpg: Number(player.projected_ppg),
    }));
    const usesWorldsRankings = /(^|[-_])worlds(?:[-_]|$)/i.test(source.tournament_provider_id)
      || /world championship|\bworlds\b/i.test(source.tournament_name);
    const priced = usesWorldsRankings
      ? priceWorldsRankedPlayers(pricingInputs)
      : priceProjectedPlayers(pricingInputs);
    const pricingMethod = usesWorldsRankings ? WORLDS_PRICING_METHOD : PRICING_METHOD;
    const pricingVersion = usesWorldsRankings ? WORLDS_PRICING_VERSION : PRICING_VERSION;
    const rosterPlayers = priced.map((player) => ({
      id: player.player_id,
      teamId: player.team_id,
      role: player.role,
      price: player.price,
      eligible: true,
    }));
    if (teamIds.length < 3 || !hasValidRoster(rosterPlayers)) {
      throw new Error("The selected teams cannot produce a valid five-role roster.");
    }

    const existing = await tx<Array<{ id: string; status: string }>>`
      select id, status
      from tournament_stages
      where tournament_id = ${source.tournament_id} and slug = ${input.slug}
      for update
    `;
    if (existing[0] && existing[0].status !== "UPCOMING") {
      throw new Error(`Stage ${input.slug} is already ${existing[0].status}; its catalog is immutable.`);
    }
    const sequenceRows = await tx<Array<{ sequence: number }>>`
      select coalesce(max(sequence), 0)::int + 1 as sequence
      from tournament_stages
      where tournament_id = ${source.tournament_id}
    `;
    const stageRows = existing[0]
      ? await tx<Array<{ id: string }>>`
          update tournament_stages set
            name = ${input.name},
            roster_lock_time = ${lockAt.toISOString()},
            start_time = clock_timestamp(),
            salary_cap = 50000000,
            max_players_per_team = 2
          where id = ${existing[0].id}
          returning id
        `
      : await tx<Array<{ id: string }>>`
          insert into tournament_stages (
            tournament_id, slug, name, sequence, start_time, roster_lock_time,
            status, salary_cap, max_players_per_team
          ) values (
            ${source.tournament_id}, ${input.slug}, ${input.name}, ${sequenceRows[0].sequence},
            clock_timestamp(), ${lockAt.toISOString()}, 'UPCOMING', 50000000, 2
          )
          returning id
        `;
    const stageId = stageRows[0].id;
    await tx`delete from player_stage_prices where stage_id = ${stageId}`;
    await tx`delete from tournament_players where stage_id = ${stageId}`;

    for (const player of priced) {
      await tx`
        insert into tournament_players (
          tournament_id, stage_id, player_id, team_id, role, is_starter, eligible,
          roster_status, roster_checked_at, raw_payload
        ) values (
          ${source.tournament_id}, ${stageId}, ${player.player_id}, ${player.team_id},
          ${player.role}, ${player.is_starter}, true, ${player.roster_status},
          ${player.roster_checked_at}, ${tx.json(player.raw_payload)}
        )
      `;
      await tx`
        insert into player_stage_prices (
          stage_id, player_id, projected_ppg, price, role_percentile, pricing_method,
          pricing_version, eligible, source_stats
        ) values (
          ${stageId}, ${player.player_id}, ${player.projectedPpg}, ${player.price},
          ${player.rolePercentile}, ${`${pricingMethod}-round-rollover`},
          ${pricingVersion}, true, ${tx.json(player.source_stats)}
        )
      `;
    }

    await tx`update tournament_stages set status = 'OPEN', updated_at = now() where id = ${stageId}`;
    return {
      stageId,
      status: "OPEN" as const,
      players: priced.length,
      teams: teamIds.length,
      sourceStageId: source.id,
    };
  });
}
