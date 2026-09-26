import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type { IngestionBundle, NormalizedTeam, ProRole, SourceKind } from "@/lib/domain/types";
import { calculateFantasyScore, type ScoringMetric, type ScoringRule } from "@/lib/domain/scoring";

type Db = Sql | TransactionSql<Record<string, never>>;

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

function payloadHash(value: unknown) {
  return createHash("sha256").update(json(value)).digest("hex");
}

function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/cito_(live|test)_[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 2_000);
}

async function upsertTeam(sql: Db, team: NormalizedTeam) {
  const rows = await sql<Array<{ id: string }>>`
    insert into pro_teams (provider, provider_id, name, abbreviation, raw_payload)
    values (${team.provider}, ${team.providerId}, ${team.name}, ${team.abbreviation}, ${json(team.raw)}::jsonb)
    on conflict (provider, provider_id) do update set
      name = excluded.name,
      abbreviation = excluded.abbreviation,
      raw_payload = excluded.raw_payload
    returning id
  `;
  return rows[0].id;
}

async function activeRules(sql: Db, ruleSetKey = "default-v1") {
  const sets = await sql<Array<{ id: string; name: string; captain_multiplier: string }>>`
    select id, name, captain_multiplier::text
    from fantasy_scoring_rule_sets
    where key = ${ruleSetKey}
    order by version desc
    limit 1
  `;
  if (!sets[0]) throw new Error(`Scoring rule set ${ruleSetKey} does not exist.`);
  const rows = await sql<Array<{ metric: ScoringMetric; points_per_unit: string; role: ProRole | null }>>`
    select metric, points_per_unit::text, role
    from fantasy_scoring_rules
    where rule_set_id = ${sets[0].id}
  `;
  return {
    id: sets[0].id,
    name: sets[0].name,
    captainMultiplier: sets[0].captain_multiplier,
    rules: rows.map<ScoringRule>((row) => ({
      metric: row.metric,
      pointsPerUnit: row.points_per_unit,
      role: row.role,
    })),
  };
}

export interface IngestionResult {
  runId: string;
  status: "SUCCEEDED" | "UNCHANGED";
  gamesProcessed: number;
  statsProcessed: number;
  gameIds: string[];
}

export async function persistIngestionBundle(
  sql: Sql,
  bundle: IngestionBundle,
  sourceKind: SourceKind,
): Promise<IngestionResult> {
  const runRows = await sql<Array<{ id: string }>>`
    insert into ingestion_runs (provider, resource_type, resource_id, source_kind, status)
    values ('cito', 'match', ${bundle.match.providerId}, ${sourceKind}, 'RUNNING')
    returning id
  `;
  const runId = runRows[0].id;

  try {
    const result = await sql.begin(async (tx) => {
      const ruleSet = await activeRules(tx);
      const tournamentRows = await tx<Array<{ id: string }>>`
        insert into tournaments (provider, provider_id, name, start_time, end_time, raw_payload)
        values (
          ${bundle.tournament.provider}, ${bundle.tournament.providerId}, ${bundle.tournament.name},
          ${bundle.tournament.startTime}, ${bundle.tournament.endTime}, ${json(bundle.tournament.raw)}::jsonb
        )
        on conflict (provider, provider_id) do update set
          name = excluded.name,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          raw_payload = excluded.raw_payload
        returning id
      `;
      const tournamentId = tournamentRows[0].id;

      const allTeams = new Map<string, NormalizedTeam>();
      for (const team of bundle.match.teams) allTeams.set(team.providerId, team);
      for (const item of bundle.games) {
        for (const stat of item.stats) allTeams.set(stat.team.providerId, stat.team);
      }
      const teamIds = new Map<string, string>();
      for (const team of allTeams.values()) teamIds.set(team.providerId, await upsertTeam(tx, team));

      const matchRows = await tx<Array<{ id: string }>>`
        insert into matches (
          provider, provider_id, tournament_id, provider_stage_label, start_time, status, raw_payload
        ) values (
          ${bundle.match.provider}, ${bundle.match.providerId}, ${tournamentId}, ${bundle.match.stageLabel},
          ${bundle.match.startTime}, ${bundle.match.status}, ${json(bundle.match.raw)}::jsonb
        )
        on conflict (provider, provider_id) do update set
          tournament_id = excluded.tournament_id,
          provider_stage_label = excluded.provider_stage_label,
          start_time = excluded.start_time,
          status = excluded.status,
          raw_payload = excluded.raw_payload
        returning id
      `;
      const matchId = matchRows[0].id;
      let statsProcessed = 0;
      let unchangedGames = 0;

      for (const item of bundle.games) {
        const hash = payloadHash(item.statsRaw);
        const previous = await tx<Array<{ stats_payload_hash: string | null }>>`
          select stats_payload_hash from games
          where provider = ${item.game.provider} and provider_id = ${item.game.providerId}
        `;
        if (previous[0]?.stats_payload_hash === hash) unchangedGames += 1;

        const winnerTeamId = item.game.winnerTeamProviderId
          ? (teamIds.get(item.game.winnerTeamProviderId) ?? null)
          : null;
        const gameRows = await tx<Array<{ id: string }>>`
          insert into games (
            provider, provider_id, match_id, game_number, status, winner_team_id,
            started_at, ended_at, source_kind, raw_payload, stats_payload_hash, ingested_at
          ) values (
            ${item.game.provider}, ${item.game.providerId}, ${matchId}, ${item.game.gameNumber},
            ${item.game.status}, ${winnerTeamId}, ${item.game.startedAt}, ${item.game.endedAt},
            ${sourceKind}, ${json(item.game.raw)}::jsonb, ${hash}, now()
          )
          on conflict (provider, provider_id) do update set
            match_id = excluded.match_id,
            game_number = excluded.game_number,
            status = excluded.status,
            winner_team_id = excluded.winner_team_id,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            source_kind = excluded.source_kind,
            raw_payload = excluded.raw_payload,
            stats_payload_hash = excluded.stats_payload_hash,
            ingested_at = now()
          returning id
        `;
        const gameId = gameRows[0].id;
        const currentPlayerIds: string[] = [];

        for (const stat of item.stats) {
          const teamId = teamIds.get(stat.team.providerId);
          if (!teamId) throw new Error(`Normalized team ${stat.team.providerId} was not persisted.`);
          const playerRows = await tx<Array<{ id: string }>>`
            insert into pro_players (
              provider, provider_id, display_name, current_team_id, role, raw_payload
            ) values (
              ${stat.player.provider}, ${stat.player.providerId}, ${stat.player.displayName},
              ${teamId}, ${stat.player.role}, ${json(stat.player.raw)}::jsonb
            )
            on conflict (provider, provider_id) do update set
              display_name = excluded.display_name,
              current_team_id = excluded.current_team_id,
              role = coalesce(excluded.role, pro_players.role),
              raw_payload = excluded.raw_payload
            returning id
          `;
          const playerId = playerRows[0].id;
          currentPlayerIds.push(playerId);
          const statRows = await tx<Array<{ id: string }>>`
            insert into player_game_stats (
              game_id, player_id, team_id, role, provider_role, kills, deaths, assists, cs, won, raw_payload
            ) values (
              ${gameId}, ${playerId}, ${teamId}, ${stat.role}, ${stat.providerRole}, ${stat.kills},
              ${stat.deaths}, ${stat.assists}, ${stat.cs}, ${stat.won}, ${json(stat.raw)}::jsonb
            )
            on conflict (game_id, player_id) do update set
              team_id = excluded.team_id,
              role = excluded.role,
              provider_role = excluded.provider_role,
              kills = excluded.kills,
              deaths = excluded.deaths,
              assists = excluded.assists,
              cs = excluded.cs,
              won = excluded.won,
              raw_payload = excluded.raw_payload
            returning id
          `;
          const score = calculateFantasyScore(stat, ruleSet.rules);
          await tx`
            insert into player_game_scores (
              player_game_stat_id, rule_set_id, base_score, breakdown, calculated_at
            ) values (
              ${statRows[0].id}, ${ruleSet.id}, ${score.total}, ${json(score.breakdown)}::jsonb, now()
            )
            on conflict (player_game_stat_id, rule_set_id) do update set
              base_score = excluded.base_score,
              breakdown = excluded.breakdown,
              calculated_at = now()
          `;
          statsProcessed += 1;
        }

        if (currentPlayerIds.length > 0) {
          await tx`
            delete from player_game_stats
            where game_id = ${gameId} and player_id not in ${tx(currentPlayerIds)}
          `;
        }
      }

      return {
        status: unchangedGames === bundle.games.length ? ("UNCHANGED" as const) : ("SUCCEEDED" as const),
        statsProcessed,
      };
    });

    await sql`
      update ingestion_runs set status = ${result.status}, games_processed = ${bundle.games.length},
        stats_processed = ${result.statsProcessed}, completed_at = now()
      where id = ${runId}
    `;
    return {
      runId,
      status: result.status,
      gamesProcessed: bundle.games.length,
      statsProcessed: result.statsProcessed,
      gameIds: bundle.games.map((item) => item.game.providerId),
    };
  } catch (error) {
    await sql`
      update ingestion_runs set status = 'FAILED', error_message = ${cleanError(error)}, completed_at = now()
      where id = ${runId}
    `.catch(() => undefined);
    throw error;
  }
}

export async function recalculateScores(sql: Sql, ruleSetKey: string, providerGameId?: string) {
  return sql.begin(async (tx) => {
    const ruleSet = await activeRules(tx, ruleSetKey);
    const stats = await tx<
      Array<{
        id: string;
        kills: number;
        deaths: number;
        assists: number;
        cs: string;
        won: boolean;
        role: ProRole | null;
      }>
    >`
      select s.id, s.kills, s.deaths, s.assists, s.cs::text, s.won, s.role
      from player_game_stats s
      join games g on g.id = s.game_id
      where ${providerGameId ? tx`g.provider_id = ${providerGameId}` : tx`true`}
    `;

    for (const stat of stats) {
      const score = calculateFantasyScore(
        { ...stat, cs: Number(stat.cs) },
        ruleSet.rules,
      );
      await tx`
        insert into player_game_scores (
          player_game_stat_id, rule_set_id, base_score, breakdown, calculated_at
        ) values (${stat.id}, ${ruleSet.id}, ${score.total}, ${json(score.breakdown)}::jsonb, now())
        on conflict (player_game_stat_id, rule_set_id) do update set
          base_score = excluded.base_score,
          breakdown = excluded.breakdown,
          calculated_at = now()
      `;
    }
    return { count: stats.length, ruleSet: ruleSet.name };
  });
}
