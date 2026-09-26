import "server-only";
import { getDatabase } from "./client";

export interface LatestGame {
  providerGameId: string;
  tournamentName: string;
  ingestedAt: string;
  sourceKind: "fixture" | "live";
}

export interface GameScoreRow {
  playerName: string;
  teamName: string;
  teamAbbreviation: string | null;
  role: string | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: string;
  won: boolean;
  baseScore: string;
  breakdown: Record<string, string>;
}

export interface GameScoreView {
  providerGameId: string;
  providerMatchId: string;
  gameNumber: number | null;
  status: string;
  sourceKind: "fixture" | "live";
  ingestedAt: string;
  tournamentName: string;
  stageLabel: string | null;
  rulesetName: string;
  rows: GameScoreRow[];
}

export async function getLatestGame(): Promise<LatestGame | null> {
  const sql = getDatabase();
  const rows = await sql<
    Array<{ provider_game_id: string; tournament_name: string; ingested_at: string; source_kind: "fixture" | "live" }>
  >`
    select g.provider_id as provider_game_id, t.name as tournament_name,
           g.ingested_at::text, g.source_kind
    from games g
    join matches m on m.id = g.match_id
    join tournaments t on t.id = m.tournament_id
    order by g.ingested_at desc
    limit 1
  `;
  const row = rows[0];
  return row
    ? {
        providerGameId: row.provider_game_id,
        tournamentName: row.tournament_name,
        ingestedAt: row.ingested_at,
        sourceKind: row.source_kind,
      }
    : null;
}

export async function getGameScoreView(providerGameId: string): Promise<GameScoreView | null> {
  const sql = getDatabase();
  const headers = await sql<
    Array<{
      provider_game_id: string;
      provider_match_id: string;
      game_number: number | null;
      status: string;
      source_kind: "fixture" | "live";
      ingested_at: string;
      tournament_name: string;
      stage_label: string | null;
      ruleset_name: string;
    }>
  >`
    select g.provider_id as provider_game_id, m.provider_id as provider_match_id,
           g.game_number, g.status, g.source_kind, g.ingested_at::text,
           t.name as tournament_name, m.provider_stage_label as stage_label,
           rs.name as ruleset_name
    from games g
    join matches m on m.id = g.match_id
    join tournaments t on t.id = m.tournament_id
    cross join fantasy_scoring_rule_sets rs
    where g.provider_id = ${providerGameId} and rs.is_active
    limit 1
  `;
  if (!headers[0]) return null;

  const rows = await sql<
    Array<{
      player_name: string;
      team_name: string;
      team_abbreviation: string | null;
      role: string | null;
      kills: number;
      deaths: number;
      assists: number;
      cs: string;
      won: boolean;
      base_score: string;
      breakdown: Record<string, string>;
    }>
  >`
    select p.display_name as player_name, team.name as team_name,
           team.abbreviation as team_abbreviation, s.role, s.kills, s.deaths,
           s.assists, s.cs::text, s.won, score.base_score::text, score.breakdown
    from games g
    join player_game_stats s on s.game_id = g.id
    join pro_players p on p.id = s.player_id
    join pro_teams team on team.id = s.team_id
    join player_game_scores score on score.player_game_stat_id = s.id
    join fantasy_scoring_rule_sets rs on rs.id = score.rule_set_id and rs.is_active
    where g.provider_id = ${providerGameId}
    order by score.base_score desc, p.display_name
  `;

  const header = headers[0];
  return {
    providerGameId: header.provider_game_id,
    providerMatchId: header.provider_match_id,
    gameNumber: header.game_number,
    status: header.status,
    sourceKind: header.source_kind,
    ingestedAt: header.ingested_at,
    tournamentName: header.tournament_name,
    stageLabel: header.stage_label,
    rulesetName: header.ruleset_name,
    rows: rows.map((row) => ({
      playerName: row.player_name,
      teamName: row.team_name,
      teamAbbreviation: row.team_abbreviation,
      role: row.role,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      cs: row.cs,
      won: row.won,
      baseScore: row.base_score,
      breakdown: row.breakdown,
    })),
  };
}
