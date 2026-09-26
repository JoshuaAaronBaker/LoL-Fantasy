import type { Sql } from "postgres";

export interface CompetitionStageView {
  id: string;
  slug: string;
  name: string;
  sequence: number;
  status: string;
  lockAt: string | null;
  eligiblePlayers: number;
  eligibleTeams: number;
  submittedRosters: number;
  assignedMatches: number;
  hasCurrentUserRoster: boolean;
}

export interface CompetitionStandingView {
  rank: number;
  username: string;
  totalScore: number;
  baseScore: number;
  captainBonus: number;
  gamesScored: number;
  stagesEntered: number;
  isCurrentUser: boolean;
}

export interface CompetitionTeamView {
  id: string;
  name: string;
  abbreviation: string | null;
  imageUrl: string | null;
}

export interface CompetitionHubView {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  tournamentName: string | null;
  tournamentProviderId: string | null;
  tournamentStart: string | null;
  tournamentEnd: string | null;
  databaseNow: string;
  currentStage: CompetitionStageView | null;
  stages: CompetitionStageView[];
  remainingTeams: CompetitionTeamView[];
  standings: CompetitionStandingView[];
}

function selectCurrentStage(stages: CompetitionStageView[], now: string) {
  const nowValue = new Date(now).valueOf();
  return stages.find((stage) =>
    stage.status === "OPEN" && stage.lockAt && nowValue < new Date(stage.lockAt).valueOf(),
  ) ?? stages.find((stage) => stage.status === "LIVE")
    ?? stages.find((stage) => stage.status === "LOCKED")
    ?? stages.find((stage) => stage.status === "UPCOMING")
    ?? [...stages].reverse().find((stage) => stage.status === "COMPLETE")
    ?? null;
}

export async function getCompetitionHub(
  competitionSlug: string,
  userId: string | null,
): Promise<CompetitionHubView | null> {
  const { getDatabase } = await import("@/lib/db/client");
  return getCompetitionHubWithDatabase(getDatabase(), competitionSlug, userId);
}

export async function getCompetitionHubWithDatabase(
  sql: Sql,
  competitionSlug: string,
  userId: string | null,
): Promise<CompetitionHubView | null> {
  const competitions = await sql<Array<{
    id: string;
    slug: string;
    name: string;
    description: string;
    status: string;
    tournament_id: string | null;
    tournament_name: string | null;
    tournament_provider_id: string | null;
    tournament_start: string | null;
    tournament_end: string | null;
    database_now: string;
  }>>`
    select c.id, c.slug, c.name, c.description, c.status, c.tournament_id,
      t.name as tournament_name, t.provider_id as tournament_provider_id,
      t.start_time::text as tournament_start, t.end_time::text as tournament_end,
      clock_timestamp()::text as database_now
    from fantasy_competitions c
    left join tournaments t on t.id = c.tournament_id
    where c.slug = ${competitionSlug}
  `;
  const competition = competitions[0];
  if (!competition) return null;

  const stageRows = competition.tournament_id
    ? await sql<Array<{
        id: string; slug: string; name: string; sequence: number; status: string;
        roster_lock_time: string | null; eligible_players: number; eligible_teams: number;
        submitted_rosters: number; assigned_matches: number; has_current_user_roster: boolean;
      }>>`
        select s.id, s.slug, s.name, s.sequence, s.status, s.roster_lock_time::text,
          count(distinct tp.player_id) filter (where tp.eligible)::int as eligible_players,
          count(distinct tp.team_id) filter (where tp.eligible)::int as eligible_teams,
          count(distinct r.id)::int as submitted_rosters,
          count(distinct m.id)::int as assigned_matches,
          coalesce(bool_or(r.user_id = ${userId}), false) as has_current_user_roster
        from tournament_stages s
        left join tournament_players tp on tp.stage_id = s.id
        left join fantasy_rosters r on r.stage_id = s.id
        left join matches m on m.stage_id = s.id
        where s.tournament_id = ${competition.tournament_id}
        group by s.id
        order by s.sequence
      `
    : [];
  const stages: CompetitionStageView[] = stageRows.map((stage) => ({
    id: stage.id,
    slug: stage.slug,
    name: stage.name,
    sequence: stage.sequence,
    status: stage.status,
    lockAt: stage.roster_lock_time,
    eligiblePlayers: stage.eligible_players,
    eligibleTeams: stage.eligible_teams,
    submittedRosters: stage.submitted_rosters,
    assignedMatches: stage.assigned_matches,
    hasCurrentUserRoster: stage.has_current_user_roster,
  }));
  const currentStage = selectCurrentStage(stages, competition.database_now);

  const teams = currentStage
    ? await sql<Array<{ id: string; name: string; abbreviation: string | null; image_url: string | null }>>`
        select distinct team.id, team.name, team.abbreviation, team.image_url
        from tournament_players tp
        join pro_teams team on team.id = tp.team_id
        where tp.stage_id = ${currentStage.id} and tp.eligible
        order by team.name
      `
    : [];
  const standings = competition.tournament_id
    ? await sql<Array<{
        rank: string; user_id: string; username: string; total_score: string;
        base_score: string; captain_bonus: string; games_scored: number; stages_entered: number;
      }>>`
        with totals as (
          select r.user_id, p.username,
            coalesce(sum(score.total_score), 0) as total_score,
            coalesce(sum(score.base_score), 0) as base_score,
            coalesce(sum(score.captain_bonus), 0) as captain_bonus,
            coalesce(sum(score.games_scored), 0)::int as games_scored,
            count(distinct r.stage_id)::int as stages_entered
          from fantasy_rosters r
          join tournament_stages s on s.id = r.stage_id
          join profiles p on p.id = r.user_id
          left join fantasy_roster_stage_scores score on score.roster_id = r.id
          where s.tournament_id = ${competition.tournament_id}
          group by r.user_id, p.username
        )
        select rank() over (order by total_score desc)::text as rank,
          user_id, username, total_score::text, base_score::text, captain_bonus::text,
          games_scored, stages_entered
        from totals
        order by rank, username
      `
    : [];

  return {
    id: competition.id,
    slug: competition.slug,
    name: competition.name,
    description: competition.description,
    status: competition.status,
    tournamentName: competition.tournament_name,
    tournamentProviderId: competition.tournament_provider_id,
    tournamentStart: competition.tournament_start,
    tournamentEnd: competition.tournament_end,
    databaseNow: competition.database_now,
    currentStage,
    stages,
    remainingTeams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      abbreviation: team.abbreviation,
      imageUrl: team.image_url,
    })),
    standings: standings.map((entry) => ({
      rank: Number(entry.rank),
      username: entry.username,
      totalScore: Number(entry.total_score),
      baseScore: Number(entry.base_score),
      captainBonus: Number(entry.captain_bonus),
      gamesScored: entry.games_scored,
      stagesEntered: entry.stages_entered,
      isCurrentUser: entry.user_id === userId,
    })),
  };
}
