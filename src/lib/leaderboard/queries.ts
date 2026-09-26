import "server-only";
import type { ProRole } from "@/lib/domain/types";
import { getDatabase } from "@/lib/db/client";

export interface LeaderboardPlayerView {
  id: string;
  name: string;
  role: ProRole;
  teamName: string;
  teamAbbreviation: string | null;
  imageUrl: string | null;
  isCaptain: boolean;
  baseScore: number;
  multiplier: number;
  finalScore: number;
  gamesScored: number;
}

export interface LeaderboardEntryView {
  rank: number;
  rosterId: string;
  username: string;
  totalScore: number;
  baseScore: number;
  captainBonus: number;
  gamesScored: number;
  submittedAt: string;
  calculatedAt: string | null;
  isCurrentUser: boolean;
  lineup: LeaderboardPlayerView[] | null;
}

export interface StageLeaderboardView {
  id: string;
  slug: string;
  name: string;
  tournamentName: string;
  status: string;
  lockAt: string;
  databaseNow: string;
  lineupsRevealed: boolean;
  entries: LeaderboardEntryView[];
}

export async function getStageLeaderboard(stageSlug: string, userId: string): Promise<StageLeaderboardView | null> {
  const sql = getDatabase();
  const stages = await sql<Array<{
    id: string; slug: string; name: string; tournament_name: string; status: string;
    roster_lock_time: string | null; database_now: string;
  }>>`
    select s.id, s.slug, s.name, t.name as tournament_name, s.status,
      s.roster_lock_time::text, clock_timestamp()::text as database_now
    from tournament_stages s
    join tournaments t on t.id = s.tournament_id
    where s.slug = ${stageSlug}
    order by s.created_at desc
    limit 1
  `;
  const stage = stages[0];
  if (!stage?.roster_lock_time) return null;
  const lineupsRevealed = ["LOCKED", "LIVE", "COMPLETE"].includes(stage.status)
    || new Date(stage.database_now) >= new Date(stage.roster_lock_time);

  const rows = await sql<Array<{
    rank: string; roster_id: string; user_id: string; username: string;
    total_score: string; base_score: string; captain_bonus: string; games_scored: number;
    submitted_at: string; calculated_at: string | null;
  }>>`
    with ranked as (
      select r.id as roster_id, r.user_id, p.username,
        coalesce(score.total_score, 0) as total_score,
        coalesce(score.base_score, 0) as base_score,
        coalesce(score.captain_bonus, 0) as captain_bonus,
        coalesce(score.games_scored, 0)::int as games_scored,
        r.submitted_at, score.calculated_at,
        rank() over (order by coalesce(score.total_score, 0) desc) as rank
      from fantasy_rosters r
      join profiles p on p.id = r.user_id
      left join fantasy_roster_stage_scores score on score.roster_id = r.id
      where r.stage_id = ${stage.id}
    )
    select rank::text, roster_id, user_id, username, total_score::text, base_score::text,
      captain_bonus::text, games_scored, submitted_at::text, calculated_at::text
    from ranked
    order by rank, submitted_at, username
  `;

  const visibleRosterIds = rows
    .filter((row) => lineupsRevealed || row.user_id === userId)
    .map((row) => row.roster_id);
  const players = visibleRosterIds.length > 0
    ? await sql<Array<{
        roster_id: string; id: string; name: string; role: ProRole; team_name: string;
        team_abbreviation: string | null; image_url: string | null; is_captain: boolean;
        base_score: string; multiplier: string; final_score: string; games_scored: number;
      }>>`
        select rp.roster_id, player.id, player.display_name as name, rp.role,
          team.name as team_name, team.abbreviation as team_abbreviation, player.image_url,
          (r.captain_player_id = player.id) as is_captain,
          coalesce(score.base_score, 0)::text as base_score,
          coalesce(score.multiplier, case when r.captain_player_id = player.id then rules.captain_multiplier else 1 end)::text as multiplier,
          coalesce(score.final_score, 0)::text as final_score,
          coalesce(score.games_scored, 0)::int as games_scored
        from fantasy_roster_players rp
        join fantasy_rosters r on r.id = rp.roster_id
        join pro_players player on player.id = rp.player_id
        join pro_teams team on team.id = rp.team_id
        cross join lateral (
          select captain_multiplier from fantasy_scoring_rule_sets where is_active limit 1
        ) rules
        left join fantasy_roster_player_scores score
          on score.roster_id = rp.roster_id and score.player_id = rp.player_id
        where rp.roster_id in ${sql(visibleRosterIds)}
        order by rp.roster_id,
          case rp.role when 'TOP' then 1 when 'JUNGLE' then 2 when 'MID' then 3 when 'BOT' then 4 else 5 end
      `
    : [];
  const playersByRoster = new Map<string, LeaderboardPlayerView[]>();
  for (const player of players) {
    const lineup = playersByRoster.get(player.roster_id) ?? [];
    lineup.push({
      id: player.id,
      name: player.name,
      role: player.role,
      teamName: player.team_name,
      teamAbbreviation: player.team_abbreviation,
      imageUrl: player.image_url,
      isCaptain: player.is_captain,
      baseScore: Number(player.base_score),
      multiplier: Number(player.multiplier),
      finalScore: Number(player.final_score),
      gamesScored: player.games_scored,
    });
    playersByRoster.set(player.roster_id, lineup);
  }

  return {
    id: stage.id,
    slug: stage.slug,
    name: stage.name,
    tournamentName: stage.tournament_name,
    status: stage.status,
    lockAt: stage.roster_lock_time,
    databaseNow: stage.database_now,
    lineupsRevealed,
    entries: rows.map((row) => ({
      rank: Number(row.rank),
      rosterId: row.roster_id,
      username: row.username,
      totalScore: Number(row.total_score),
      baseScore: Number(row.base_score),
      captainBonus: Number(row.captain_bonus),
      gamesScored: row.games_scored,
      submittedAt: row.submitted_at,
      calculatedAt: row.calculated_at,
      isCurrentUser: row.user_id === userId,
      lineup: playersByRoster.get(row.roster_id) ?? null,
    })),
  };
}

