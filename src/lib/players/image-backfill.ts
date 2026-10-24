import type { Sql } from "postgres";
import type { EsportsDataProvider } from "@/lib/providers/esports-data-provider";

type MissingPlayer = {
  id: string;
  provider_id: string;
  display_name: string;
  team_provider_id: string;
};

export type PlayerImageBackfillResult = {
  missingBefore: number;
  restoredFromStoredPayloads: number;
  restoredFromProvider: number;
  teamsFetched: number;
  unresolved: string[];
  warnings: string[];
};

export function normalizeImageMatchName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function backfillCatalogPlayerImages(
  sql: Sql,
  provider: EsportsDataProvider,
  options: {
    stageSlug?: string;
    progress?: (message: string) => void;
  } = {},
): Promise<PlayerImageBackfillResult> {
  const stageSlug = options.stageSlug ?? null;
  const progress = options.progress ?? (() => undefined);

  const missingBeforeRows = await sql<Array<{ count: number }>>`
    select count(distinct player.id)::int as count
    from pro_players player
    join tournament_players tournament_player on tournament_player.player_id = player.id
    join tournament_stages stage on stage.id = tournament_player.stage_id
    where player.provider = 'cito'
      and nullif(btrim(player.image_url), '') is null
      and (${stageSlug}::text is null or stage.slug = ${stageSlug})
    `;

  const restoredFromStoredPayloads = await sql<Array<{ id: string }>>`
    update pro_players player set
      image_url = coalesce(
        nullif(player.raw_payload->>'imageUrl', ''),
        nullif(player.raw_payload->>'headshotUrl', ''),
        nullif(player.raw_payload #>> '{player,imageUrl}', ''),
        nullif(player.raw_payload #>> '{player,headshotUrl}', '')
      ),
      updated_at = now()
    where player.provider = 'cito'
      and nullif(btrim(player.image_url), '') is null
      and coalesce(
        nullif(player.raw_payload->>'imageUrl', ''),
        nullif(player.raw_payload->>'headshotUrl', ''),
        nullif(player.raw_payload #>> '{player,imageUrl}', ''),
        nullif(player.raw_payload #>> '{player,headshotUrl}', '')
      ) is not null
      and exists (
        select 1
        from tournament_players tournament_player
        join tournament_stages stage on stage.id = tournament_player.stage_id
        where tournament_player.player_id = player.id
          and (${stageSlug}::text is null or stage.slug = ${stageSlug})
      )
    returning player.id
  `;

  const missing = await sql<MissingPlayer[]>`
    select distinct on (player.id)
      player.id,
      player.provider_id,
      player.display_name,
      team.provider_id as team_provider_id
    from pro_players player
    join tournament_players tournament_player on tournament_player.player_id = player.id
    join tournament_stages stage on stage.id = tournament_player.stage_id
    join pro_teams team on team.id = tournament_player.team_id
    where player.provider = 'cito'
      and nullif(btrim(player.image_url), '') is null
      and team.provider = 'cito'
      and (${stageSlug}::text is null or stage.slug = ${stageSlug})
    order by player.id, stage.sequence desc
  `;

  const missingByTeam = new Map<string, MissingPlayer[]>();
  for (const player of missing) {
    const teamPlayers = missingByTeam.get(player.team_provider_id) ?? [];
    teamPlayers.push(player);
    missingByTeam.set(player.team_provider_id, teamPlayers);
  }

  let restoredFromProvider = 0;
  let teamsFetched = 0;
  const warnings: string[] = [];

  for (const [teamProviderId, teamPlayers] of missingByTeam) {
    progress(`Fetching ${teamProviderId} roster for ${teamPlayers.length} missing image(s)`);
    try {
      const roster = await provider.getTeamRoster(teamProviderId);
      teamsFetched += 1;
      const byProviderId = new Map(roster.players.map((row) => [row.player.providerId, row.player]));
      const byName = new Map(roster.players.map((row) => [normalizeImageMatchName(row.player.displayName), row.player]));

      for (const missingPlayer of teamPlayers) {
        const candidate = byProviderId.get(missingPlayer.provider_id)
          ?? byName.get(normalizeImageMatchName(missingPlayer.display_name));
        if (!candidate?.imageUrl) continue;
        const updated = await sql<Array<{ id: string }>>`
          update pro_players set image_url = ${candidate.imageUrl}, updated_at = now()
          where id = ${missingPlayer.id} and nullif(btrim(image_url), '') is null
          returning id
        `;
        restoredFromProvider += updated.length;
      }
    } catch (error) {
      warnings.push(`${teamProviderId}: ${errorMessage(error)}`);
    }
  }

  const unresolvedRows = await sql<Array<{ display_name: string; team_name: string }>>`
    select distinct player.display_name, team.name as team_name
    from pro_players player
    join tournament_players tournament_player on tournament_player.player_id = player.id
    join tournament_stages stage on stage.id = tournament_player.stage_id
    join pro_teams team on team.id = tournament_player.team_id
    where player.provider = 'cito'
      and nullif(btrim(player.image_url), '') is null
      and (${stageSlug}::text is null or stage.slug = ${stageSlug})
    order by team.name, player.display_name
  `;

  return {
    missingBefore: missingBeforeRows[0]?.count ?? 0,
    restoredFromStoredPayloads: restoredFromStoredPayloads.length,
    restoredFromProvider,
    teamsFetched,
    unresolved: unresolvedRows.map((row) => `${row.display_name} (${row.team_name})`),
    warnings,
  };
}
