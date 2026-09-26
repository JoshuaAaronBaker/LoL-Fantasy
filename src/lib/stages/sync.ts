import type { Sql } from "postgres";
import type { IngestionBundle } from "@/lib/domain/types";
import type { EsportsDataProvider } from "@/lib/providers/esports-data-provider";
import { persistIngestionBundle, type IngestionResult } from "@/lib/ingestion/repository";
import { recalculateRosterScores } from "@/lib/leaderboard/repository";
import {
  determineStageStatus,
  isCompletedGameStatus,
  type StageStatus,
} from "./lifecycle";

interface StageRow {
  id: string;
  tournament_id: string;
  tournament_provider_id: string;
  name: string;
  status: StageStatus;
  roster_lock_time: string | null;
}

export interface SynchronizeStageInput {
  stageSlug: string;
  matchIds?: string[];
  refreshCompleted?: boolean;
}

export interface StageSyncResult {
  runId: string;
  status: "SUCCEEDED" | "UNCHANGED";
  stageId: string;
  stageName: string;
  previousStageStatus: StageStatus;
  stageStatus: StageStatus;
  matchesProcessed: number;
  matchesAssigned: number;
  gamesIngested: number;
  matchResults: Array<IngestionResult & { matchId: string }>;
  scoring: { stages: number; rosters: number; players: number };
}

function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/cito_(live|test)_[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 2_000);
}

function uniqueIds(values: string[]) {
  const ids = values.map((value) => value.trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error("Stage match IDs must be unique.");
  return ids;
}

async function findStage(sql: Sql, slug: string) {
  const rows = await sql<StageRow[]>`
    select s.id, s.tournament_id, t.provider_id as tournament_provider_id,
      s.name, s.status, s.roster_lock_time::text
    from tournament_stages s
    join tournaments t on t.id = s.tournament_id
    where s.slug = ${slug} and t.provider = 'cito'
  `;
  if (rows.length !== 1) throw new Error(`Expected one Cito stage with slug ${slug}; found ${rows.length}.`);
  if (rows[0].status === "UPCOMING") throw new Error(`Stage ${slug} must be opened before it can be synchronized.`);
  if (!rows[0].roster_lock_time) throw new Error(`Stage ${slug} does not have a roster lock time.`);
  return rows[0];
}

async function assignedMatchIds(sql: Sql, stageId: string) {
  const rows = await sql<Array<{ provider_id: string }>>`
    select provider_id from matches
    where provider = 'cito' and stage_id = ${stageId}
    order by start_time nulls last, provider_id
  `;
  return rows.map((row) => row.provider_id);
}

async function validateKnownMatches(
  sql: Sql,
  stage: StageRow,
  matchIds: string[],
) {
  const rows = await sql<Array<{
    provider_id: string;
    tournament_id: string;
    stage_id: string | null;
    status: string;
  }>>`
    select provider_id, tournament_id, stage_id, status
    from matches
    where provider = 'cito' and provider_id in ${sql(matchIds)}
  `;
  const conflict = rows.find((row) =>
    row.tournament_id !== stage.tournament_id || (row.stage_id && row.stage_id !== stage.id),
  );
  if (conflict) {
    throw new Error(`Match ${conflict.provider_id} already belongs to another tournament or fantasy stage.`);
  }
  return new Map(rows.map((row) => [row.provider_id, { status: row.status, stageId: row.stage_id }]));
}

async function knownGameIds(sql: Sql, matchId: string) {
  const rows = await sql<Array<{ provider_id: string }>>`
    select g.provider_id
    from games g
    join matches m on m.id = g.match_id
    where m.provider = 'cito' and m.provider_id = ${matchId}
  `;
  return new Set(rows.map((row) => row.provider_id));
}

export async function synchronizeStage(
  sql: Sql,
  provider: EsportsDataProvider,
  input: SynchronizeStageInput,
): Promise<StageSyncResult> {
  const stage = await findStage(sql, input.stageSlug);
  const requestedIds = input.matchIds ? uniqueIds(input.matchIds) : await assignedMatchIds(sql, stage.id);
  if (requestedIds.length === 0) {
    throw new Error(`Stage ${input.stageSlug} has no assigned matches. Pass --matches with the complete stage schedule.`);
  }
  const knownStatuses = await validateKnownMatches(sql, stage, requestedIds);
  const unassignedIds = requestedIds.filter((matchId) => knownStatuses.get(matchId)?.stageId !== stage.id);
  if (stage.status === "COMPLETE" && unassignedIds.length > 0) {
    throw new Error(`Completed stage ${input.stageSlug} cannot accept additional matches.`);
  }
  const runRows = await sql<Array<{ id: string }>>`
    insert into stage_sync_runs (stage_id, status, previous_stage_status, requested_match_ids)
    values (${stage.id}, 'RUNNING', ${stage.status}, ${requestedIds})
    returning id
  `;
  const runId = runRows[0].id;

  try {
    // Fetch once per stage, then keep every provider request sequential for low-volume plans.
    const tournament = await provider.getTournament(stage.tournament_provider_id);
    if (tournament.providerId !== stage.tournament_provider_id) {
      throw new Error(`Provider returned tournament ${tournament.providerId} for ${stage.tournament_provider_id}.`);
    }

    const matchResults: StageSyncResult["matchResults"] = [];
    let matchesAssigned = 0;
    let metadataChanged = false;

    for (const matchId of requestedIds) {
      const match = await provider.getMatch(matchId, stage.tournament_provider_id);
      if (match.providerId !== matchId) throw new Error(`Provider returned match ${match.providerId} for ${matchId}.`);
      if (match.tournamentProviderId !== stage.tournament_provider_id) {
        throw new Error(`Match ${matchId} belongs to tournament ${match.tournamentProviderId}.`);
      }
      if (knownStatuses.get(matchId)?.status !== match.status) metadataChanged = true;

      const listedGames = await provider.getMatchGames(matchId);
      const existingGames = input.refreshCompleted ? new Set<string>() : await knownGameIds(sql, matchId);
      const selectedGames = listedGames.filter((game) =>
        isCompletedGameStatus(game.status) && !existingGames.has(game.providerId),
      );
      const games: IngestionBundle["games"] = [];
      for (const listedGame of selectedGames) {
        const game = await provider.getGame(listedGame.providerId, match.providerId);
        if (!isCompletedGameStatus(game.status)) continue;
        const stats = await provider.getGamePlayerStats(game);
        games.push({ game, stats: stats.stats, statsRaw: stats.raw });
      }

      const result = await persistIngestionBundle(sql, { tournament, match, games }, "live");
      const assignments = await sql<Array<{ id: string }>>`
        update matches
        set stage_id = ${stage.id}
        where provider = 'cito' and provider_id = ${matchId}
          and tournament_id = ${stage.tournament_id}
          and (stage_id is null or stage_id = ${stage.id})
        returning id
      `;
      if (assignments.length !== 1) throw new Error(`Match ${matchId} could not be assigned to stage ${input.stageSlug}.`);
      if (knownStatuses.get(matchId)?.stageId !== stage.id) matchesAssigned += 1;
      matchResults.push({ ...result, matchId });
    }

    const finalized = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${stage.id}, 0))`;
      const lockedStages = await tx<Array<{
        status: StageStatus;
        roster_lock_time: string;
        database_now: string;
      }>>`
        select status, roster_lock_time::text, clock_timestamp()::text as database_now
        from tournament_stages where id = ${stage.id} for update
      `;
      const current = lockedStages[0];
      if (!current?.roster_lock_time) throw new Error(`Stage ${input.stageSlug} no longer has a lock time.`);
      const matches = await tx<Array<{ status: string }>>`
        select status from matches where stage_id = ${stage.id} order by provider_id
      `;
      const gameCounts = await tx<Array<{ count: number }>>`
        select count(*)::int as count
        from games g join matches m on m.id = g.match_id
        where m.stage_id = ${stage.id} and g.status in ('COMPLETE', 'COMPLETED', 'FINISHED', 'FINAL')
      `;
      const nextStatus = determineStageStatus({
        currentStatus: current.status,
        databaseNow: current.database_now,
        lockAt: current.roster_lock_time,
        matchStatuses: matches.map((match) => match.status),
        completedGames: gameCounts[0].count,
      });
      await tx`
        update tournament_stages
        set status = ${nextStatus},
          end_time = case when ${nextStatus} = 'COMPLETE' then coalesce(end_time, clock_timestamp()) else end_time end
        where id = ${stage.id}
      `;
      const scoring = await recalculateRosterScores(tx, stage.id);
      return { previousStatus: current.status, nextStatus, scoring };
    });

    const gamesIngested = matchResults.reduce((total, result) => total + result.gamesProcessed, 0);
    const changed = metadataChanged
      || matchesAssigned > 0
      || finalized.previousStatus !== finalized.nextStatus
      || matchResults.some((result) => result.status === "SUCCEEDED");
    const status = changed ? "SUCCEEDED" as const : "UNCHANGED" as const;
    await sql`
      update stage_sync_runs
      set status = ${status}, resulting_stage_status = ${finalized.nextStatus},
        matches_processed = ${matchResults.length}, games_ingested = ${gamesIngested}, completed_at = now()
      where id = ${runId}
    `;
    return {
      runId,
      status,
      stageId: stage.id,
      stageName: stage.name,
      previousStageStatus: finalized.previousStatus,
      stageStatus: finalized.nextStatus,
      matchesProcessed: matchResults.length,
      matchesAssigned,
      gamesIngested,
      matchResults,
      scoring: finalized.scoring,
    };
  } catch (error) {
    await sql`
      update stage_sync_runs
      set status = 'FAILED', error_message = ${cleanError(error)}, completed_at = now()
      where id = ${runId}
    `.catch(() => undefined);
    throw error;
  }
}
