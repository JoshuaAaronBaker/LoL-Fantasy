import "server-only";
import type { ProRole } from "@/lib/domain/types";
import { getDatabase } from "@/lib/db/client";

export interface StagePlayerView {
  id: string;
  name: string;
  imageUrl: string | null;
  role: ProRole;
  teamId: string;
  teamName: string;
  teamAbbreviation: string | null;
  teamImageUrl: string | null;
  price: number;
  projectedPpg: number;
  eligible: boolean;
}

export interface SavedRosterView {
  playerIds: string[];
  captainPlayerId: string;
  totalSalary: number;
  submittedAt: string;
}

export interface StageRosterView {
  id: string;
  slug: string;
  name: string;
  tournamentName: string;
  status: string;
  lockAt: string;
  salaryCap: number;
  maxPlayersPerTeam: number;
  pricingMethod: string;
  databaseNow: string;
  players: StagePlayerView[];
  savedRoster: SavedRosterView | null;
}

export async function getStageRosterView(stageSlug: string, userId: string): Promise<StageRosterView | null> {
  const sql = getDatabase();
  const stages = await sql<Array<{
    id: string; slug: string; name: string; tournament_name: string; status: string;
    roster_lock_time: string | null; salary_cap: string; max_players_per_team: number; pricing_method: string | null;
    database_now: string;
  }>>`
    select s.id, s.slug, s.name, t.name as tournament_name, s.status,
      s.roster_lock_time::text, s.salary_cap::text, s.max_players_per_team,
      min(psp.pricing_method) as pricing_method, clock_timestamp()::text as database_now
    from tournament_stages s
    join tournaments t on t.id = s.tournament_id
    left join player_stage_prices psp on psp.stage_id = s.id
    where s.slug = ${stageSlug}
    group by s.id, t.name
    order by s.created_at desc
    limit 1
  `;
  const stage = stages[0];
  if (!stage || !stage.roster_lock_time) return null;

  const players = await sql<Array<{
    id: string; name: string; image_url: string | null; role: ProRole; team_id: string;
    team_name: string; team_abbreviation: string | null; team_image_url: string | null;
    price: string; projected_ppg: string; eligible: boolean;
  }>>`
    select p.id, p.display_name as name, p.image_url, tp.role, team.id as team_id,
      team.name as team_name, team.abbreviation as team_abbreviation, team.image_url as team_image_url,
      price.price::text, price.projected_ppg::text, (tp.eligible and price.eligible) as eligible
    from tournament_players tp
    join pro_players p on p.id = tp.player_id
    join pro_teams team on team.id = tp.team_id
    join player_stage_prices price on price.stage_id = tp.stage_id and price.player_id = tp.player_id
    where tp.stage_id = ${stage.id}
    order by tp.role, price.price desc, p.display_name
  `;
  const rosters = await sql<Array<{
    id: string; captain_player_id: string; total_salary: string; submitted_at: string;
  }>>`
    select id, captain_player_id, total_salary::text, submitted_at::text
    from fantasy_rosters where user_id = ${userId} and stage_id = ${stage.id}
  `;
  const selected = rosters[0]
    ? await sql<Array<{ player_id: string }>>`
        select player_id from fantasy_roster_players where roster_id = ${rosters[0].id} order by role
      `
    : [];

  return {
    id: stage.id,
    slug: stage.slug,
    name: stage.name,
    tournamentName: stage.tournament_name,
    status: stage.status,
    lockAt: stage.roster_lock_time,
    salaryCap: Number(stage.salary_cap),
    maxPlayersPerTeam: stage.max_players_per_team,
    pricingMethod: stage.pricing_method ?? "unpriced",
    databaseNow: stage.database_now,
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      imageUrl: player.image_url,
      role: player.role,
      teamId: player.team_id,
      teamName: player.team_name,
      teamAbbreviation: player.team_abbreviation,
      teamImageUrl: player.team_image_url,
      price: Number(player.price),
      projectedPpg: Number(player.projected_ppg),
      eligible: player.eligible,
    })),
    savedRoster: rosters[0] ? {
      playerIds: selected.map((row) => row.player_id),
      captainPlayerId: rosters[0].captain_player_id,
      totalSalary: Number(rosters[0].total_salary),
      submittedAt: rosters[0].submitted_at,
    } : null,
  };
}

export async function getFeaturedStage() {
  const sql = getDatabase();
  const rows = await sql<Array<{ slug: string; name: string; lock_at: string; players: number }>>`
    select s.slug, s.name, s.roster_lock_time::text as lock_at, count(tp.id)::int as players
    from tournament_stages s
    join tournament_players tp on tp.stage_id = s.id and tp.eligible
    where s.status = 'OPEN' and clock_timestamp() < s.roster_lock_time
    group by s.id
    order by s.roster_lock_time
    limit 1
  `;
  return rows[0] ?? null;
}
