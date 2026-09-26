import "server-only";
import type { Sql } from "postgres";
import { getDatabase } from "@/lib/db/client";

export interface OperatorTournamentCandidate {
  id: string;
  providerId: string;
  name: string;
  leagueName: string | null;
  leagueSlug: string | null;
  startTime: string | null;
  endTime: string | null;
  isInternational: boolean;
  discoveredAt: string;
}

export interface OperatorTournamentTeam {
  id: string;
  providerId: string;
  name: string;
  abbreviation: string | null;
  imageUrl: string | null;
}

export interface OperatorStageReadiness {
  id: string;
  slug: string;
  name: string;
  sequence: number;
  status: string;
  lockAt: string | null;
  eligiblePlayers: number;
  eligibleTeams: number;
  assignedMatches: number;
}

export interface OperatorJobView {
  id: string;
  jobType: string;
  status: string;
  stageSlug: string | null;
  stageName: string | null;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface OperatorStageSyncScheduleView {
  id: string;
  stageId: string;
  enabled: boolean;
  intervalMinutes: number;
  matchProviderIds: string[];
  refreshCompleted: boolean;
  nextRunAt: string;
  lastEnqueuedAt: string | null;
}

export interface OperatorWorldsView {
  competitionId: string;
  competitionName: string;
  competitionStatus: string;
  providerCheckedAt: string | null;
  tournamentId: string | null;
  tournamentProviderId: string | null;
  tournamentName: string | null;
  candidates: OperatorTournamentCandidate[];
  teams: OperatorTournamentTeam[];
  stages: OperatorStageReadiness[];
  jobs: OperatorJobView[];
  schedules: OperatorStageSyncScheduleView[];
}

export async function getOperatorWorldsView() {
  return getOperatorWorldsViewWithDatabase(getDatabase());
}

export async function getOperatorWorldsViewWithDatabase(sql: Sql): Promise<OperatorWorldsView | null> {
  const competitions = await sql<Array<{
    id: string; name: string; status: string; provider_checked_at: string | null;
    tournament_id: string | null; tournament_provider_id: string | null; tournament_name: string | null;
  }>>`
    select competition.id, competition.name, competition.status,
      competition.provider_checked_at::text, competition.tournament_id,
      tournament.provider_id as tournament_provider_id, tournament.name as tournament_name
    from fantasy_competitions competition
    left join tournaments tournament on tournament.id = competition.tournament_id
    where competition.slug = 'worlds'
  `;
  const competition = competitions[0];
  if (!competition) return null;

  const candidates = await sql<Array<{
    id: string; provider_id: string; name: string; league_name: string | null;
    league_slug: string | null; start_time: string | null; end_time: string | null;
    is_international: boolean; discovered_at: string;
  }>>`
    select id, provider_id, name, league_name, league_slug, start_time::text, end_time::text,
      is_international, discovered_at::text
    from competition_tournament_candidates
    where competition_id = ${competition.id}
    order by start_time desc nulls last, name
  `;
  const teams = competition.tournament_id
    ? await sql<Array<{
        id: string; provider_id: string; name: string; abbreviation: string | null; image_url: string | null;
      }>>`
        select team.id, team.provider_id, team.name, team.abbreviation, team.image_url
        from tournament_teams tournament_team
        join pro_teams team on team.id = tournament_team.team_id
        where tournament_team.tournament_id = ${competition.tournament_id}
        order by team.name
      `
    : [];
  const stages = competition.tournament_id
    ? await sql<Array<{
        id: string; slug: string; name: string; sequence: number; status: string; lock_at: string | null;
        eligible_players: number; eligible_teams: number; assigned_matches: number;
      }>>`
        select stage.id, stage.slug, stage.name, stage.sequence, stage.status,
          stage.roster_lock_time::text as lock_at,
          count(distinct player.player_id) filter (where player.eligible)::int as eligible_players,
          count(distinct player.team_id) filter (where player.eligible)::int as eligible_teams,
          count(distinct match.id)::int as assigned_matches
        from tournament_stages stage
        left join tournament_players player on player.stage_id = stage.id
        left join matches match on match.stage_id = stage.id
        where stage.tournament_id = ${competition.tournament_id}
        group by stage.id
        order by stage.sequence
      `
    : [];
  const jobs = await sql<Array<{
    id: string; job_type: string; status: string; stage_slug: string | null; stage_name: string | null;
    attempts: number; max_attempts: number; error_message: string | null; created_at: string;
    started_at: string | null; completed_at: string | null;
  }>>`
    select id, job_type, status, payload ->> 'stageSlug' as stage_slug,
      payload ->> 'stageName' as stage_name, attempts, max_attempts, error_message,
      created_at::text, started_at::text, completed_at::text
    from operator_jobs
    order by created_at desc
    limit 12
  `;
  const schedules = competition.tournament_id
    ? await sql<Array<{
        id: string; stage_id: string; enabled: boolean; interval_minutes: number;
        match_provider_ids: string[]; refresh_completed: boolean; next_run_at: string;
        last_enqueued_at: string | null;
      }>>`
        select schedule.id, schedule.stage_id, schedule.enabled, schedule.interval_minutes,
          schedule.match_provider_ids, schedule.refresh_completed, schedule.next_run_at::text,
          schedule.last_enqueued_at::text
        from stage_sync_schedules schedule
        join tournament_stages stage on stage.id = schedule.stage_id
        where stage.tournament_id = ${competition.tournament_id}
        order by stage.sequence
      `
    : [];

  return {
    competitionId: competition.id,
    competitionName: competition.name,
    competitionStatus: competition.status,
    providerCheckedAt: competition.provider_checked_at,
    tournamentId: competition.tournament_id,
    tournamentProviderId: competition.tournament_provider_id,
    tournamentName: competition.tournament_name,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      providerId: candidate.provider_id,
      name: candidate.name,
      leagueName: candidate.league_name,
      leagueSlug: candidate.league_slug,
      startTime: candidate.start_time,
      endTime: candidate.end_time,
      isInternational: candidate.is_international,
      discoveredAt: candidate.discovered_at,
    })),
    teams: teams.map((team) => ({
      id: team.id,
      providerId: team.provider_id,
      name: team.name,
      abbreviation: team.abbreviation,
      imageUrl: team.image_url,
    })),
    stages: stages.map((stage) => ({
      id: stage.id,
      slug: stage.slug,
      name: stage.name,
      sequence: stage.sequence,
      status: stage.status,
      lockAt: stage.lock_at,
      eligiblePlayers: stage.eligible_players,
      eligibleTeams: stage.eligible_teams,
      assignedMatches: stage.assigned_matches,
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      jobType: job.job_type,
      status: job.status,
      stageSlug: job.stage_slug,
      stageName: job.stage_name,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      errorMessage: job.error_message,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    })),
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      stageId: schedule.stage_id,
      enabled: schedule.enabled,
      intervalMinutes: schedule.interval_minutes,
      matchProviderIds: schedule.match_provider_ids,
      refreshCompleted: schedule.refresh_completed,
      nextRunAt: schedule.next_run_at,
      lastEnqueuedAt: schedule.last_enqueued_at,
    })),
  };
}
