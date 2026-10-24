import type { JSONValue, Sql } from "postgres";
import {
  WORLDS_PRICING_METHOD,
  WORLDS_PRICING_VERSION,
  priceWorldsRankedPlayers,
} from "@/lib/domain/pricing";
import type { ProRole } from "@/lib/domain/types";
import { hasValidRoster } from "@/lib/stages/rollover";

export async function resetWorldsStagePricing(sql: Sql, stageSlug: string) {
  return sql.begin(async (tx) => {
    const stages = await tx<Array<{
      id: string;
      status: string;
      roster_lock_time: string | null;
      before_lock: boolean;
      provider_id: string;
      tournament_name: string;
    }>>`
      select stage.id, stage.status, stage.roster_lock_time::text,
        clock_timestamp() < stage.roster_lock_time as before_lock,
        tournament.provider_id, tournament.name as tournament_name
      from tournament_stages stage
      join tournaments tournament on tournament.id = stage.tournament_id
      where stage.slug = ${stageSlug}
      for update
    `;
    if (stages.length !== 1) {
      throw new Error("The stage slug must resolve to exactly one stage.");
    }
    const stage = stages[0];
    const isWorlds = /(^|[-_])worlds(?:[-_]|$)/i.test(stage.provider_id)
      || /world championship|\bworlds\b/i.test(stage.tournament_name);
    if (!isWorlds) throw new Error("Only a Worlds stage can use the Worlds ranking reset.");
    if (stage.status !== "OPEN") throw new Error(`Stage ${stageSlug} is ${stage.status}, not OPEN.`);
    if (!stage.roster_lock_time || !stage.before_lock) {
      throw new Error("The stage is already locked.");
    }

    const activity = await tx<Array<{ games: number; scored_rosters: number }>>`
      select
        (select count(*)::int from games game
          join matches match on match.id = game.match_id
          where match.stage_id = ${stage.id}) as games,
        (select count(*)::int from fantasy_roster_stage_scores score
          where score.stage_id = ${stage.id} and score.games_scored > 0) as scored_rosters
    `;
    if (activity[0].games > 0 || activity[0].scored_rosters > 0) {
      throw new Error("The stage already has ingested or scored games and cannot be reset.");
    }

    const players = await tx<Array<{
      player_id: string;
      display_name: string;
      team_id: string;
      role: ProRole;
      projected_ppg: string;
      source_stats: JSONValue;
    }>>`
      select tournament_player.player_id, player.display_name, tournament_player.team_id,
        tournament_player.role, price.projected_ppg::text, price.source_stats
      from tournament_players tournament_player
      join pro_players player on player.id = tournament_player.player_id
      join player_stage_prices price
        on price.stage_id = tournament_player.stage_id
        and price.player_id = tournament_player.player_id
      where tournament_player.stage_id = ${stage.id}
        and tournament_player.eligible
        and price.eligible
      order by tournament_player.role, player.display_name
    `;
    const priced = priceWorldsRankedPlayers(players.map((player) => ({
      ...player,
      playerId: player.player_id,
      displayName: player.display_name,
      projectedPpg: Number(player.projected_ppg),
    })));
    if (!hasValidRoster(priced.map((player) => ({
      id: player.player_id,
      teamId: player.team_id,
      role: player.role,
      price: player.price,
      eligible: true,
    })))) {
      throw new Error("The ranking prices cannot produce a valid $50M roster.");
    }

    const rosters = await tx<Array<{ count: number }>>`
      select count(*)::int as count from fantasy_rosters where stage_id = ${stage.id}
    `;
    await tx`update tournament_stages set status = 'UPCOMING', updated_at = now() where id = ${stage.id}`;
    await tx`delete from fantasy_rosters where stage_id = ${stage.id}`;
    await tx`delete from player_stage_prices where stage_id = ${stage.id}`;
    for (const player of priced) {
      await tx`
        insert into player_stage_prices (
          stage_id, player_id, projected_ppg, price, role_percentile, pricing_method,
          pricing_version, eligible, source_stats
        ) values (
          ${stage.id}, ${player.player_id}, ${player.projectedPpg}, ${player.price},
          ${player.rolePercentile}, ${WORLDS_PRICING_METHOD}, ${WORLDS_PRICING_VERSION},
          true, ${tx.json(player.source_stats)}
        )
      `;
    }
    await tx`update tournament_stages set status = 'OPEN', updated_at = now() where id = ${stage.id}`;

    return {
      stageId: stage.id,
      stageSlug,
      status: "OPEN" as const,
      players: priced.length,
      removedRosters: rosters[0].count,
      minimumPrice: Math.min(...priced.map((player) => player.price)),
      maximumPrice: Math.max(...priced.map((player) => player.price)),
      pricingMethod: WORLDS_PRICING_METHOD,
      pricingVersion: WORLDS_PRICING_VERSION,
    };
  });
}
