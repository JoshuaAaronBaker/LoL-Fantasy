import type { Sql } from "postgres";
import type { NormalizedTournament, TournamentCatalogEntry, TournamentTeam } from "@/lib/domain/types";

const json = (value: unknown) => JSON.stringify(value ?? null);

export interface ConfigureCompetitionInput {
  slug: string;
  name: string;
  description: string;
  tournament: NormalizedTournament;
}

export async function configureCompetition(sql: Sql, input: ConfigureCompetitionInput) {
  return sql.begin(async (tx) => {
    const tournaments = await tx<Array<{ id: string }>>`
      insert into tournaments (provider, provider_id, name, start_time, end_time, raw_payload, source_updated_at)
      values ('cito', ${input.tournament.providerId}, ${input.tournament.name},
        ${input.tournament.startTime}, ${input.tournament.endTime}, ${json(input.tournament.raw)}::jsonb, now())
      on conflict (provider, provider_id) do update set
        name = excluded.name,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        raw_payload = excluded.raw_payload,
        source_updated_at = now()
      returning id
    `;
    const rows = await tx<Array<{ id: string; slug: string; status: string; tournament_id: string }>>`
      insert into fantasy_competitions (slug, name, description, tournament_id, status)
      values (${input.slug}, ${input.name}, ${input.description}, ${tournaments[0].id}, 'ACTIVE')
      on conflict (slug) do update set
        name = excluded.name,
        description = excluded.description,
        tournament_id = excluded.tournament_id,
        status = 'ACTIVE'
      returning id, slug, status, tournament_id
    `;
    return rows[0];
  });
}

export async function replaceTournamentCandidates(
  sql: Sql,
  competitionSlug: string,
  candidates: TournamentCatalogEntry[],
) {
  return sql.begin(async (tx) => {
    const competitions = await tx<Array<{ id: string }>>`
      select id from fantasy_competitions where slug = ${competitionSlug} for update
    `;
    if (!competitions[0]) throw new Error(`Competition ${competitionSlug} does not exist.`);
    const competitionId = competitions[0].id;
    await tx`delete from competition_tournament_candidates where competition_id = ${competitionId}`;
    for (const candidate of candidates) {
      await tx`
        insert into competition_tournament_candidates (
          competition_id, provider, provider_id, name, league_name, league_slug,
          start_time, end_time, is_international, raw_payload, discovered_at
        ) values (
          ${competitionId}, 'cito', ${candidate.providerId}, ${candidate.name},
          ${candidate.leagueName}, ${candidate.leagueSlug}, ${candidate.startTime}, ${candidate.endTime},
          ${candidate.isInternational}, ${json(candidate.raw)}::jsonb, now()
        )
      `;
    }
    await tx`update fantasy_competitions set provider_checked_at = now() where id = ${competitionId}`;
    return { competitionId, count: candidates.length };
  });
}

export async function getTournamentCandidate(sql: Sql, competitionSlug: string, candidateId: string) {
  const rows = await sql<Array<{ id: string; provider_id: string }>>`
    select candidate.id, candidate.provider_id
    from competition_tournament_candidates candidate
    join fantasy_competitions competition on competition.id = candidate.competition_id
    where competition.slug = ${competitionSlug} and candidate.id = ${candidateId}
  `;
  return rows[0] ?? null;
}

export async function getCompetitionConnection(sql: Sql, competitionSlug: string) {
  const rows = await sql<Array<{ competition_id: string; tournament_id: string | null; provider_id: string | null }>>`
    select competition.id as competition_id, competition.tournament_id, tournament.provider_id
    from fantasy_competitions competition
    left join tournaments tournament on tournament.id = competition.tournament_id
    where competition.slug = ${competitionSlug}
  `;
  return rows[0] ?? null;
}

export async function upsertTournamentTeams(sql: Sql, tournamentId: string, teams: TournamentTeam[]) {
  return sql.begin(async (tx) => {
    for (const source of teams) {
      const team = source.team;
      const rows = await tx<Array<{ id: string }>>`
        insert into pro_teams (provider, provider_id, name, abbreviation, image_url, raw_payload)
        values ('cito', ${team.providerId}, ${team.name}, ${team.abbreviation},
          ${team.imageUrl ?? null}, ${json(source.raw)}::jsonb)
        on conflict (provider, provider_id) do update set
          name = excluded.name, abbreviation = excluded.abbreviation,
          image_url = excluded.image_url, raw_payload = excluded.raw_payload
        returning id
      `;
      await tx`
        insert into tournament_teams (tournament_id, team_id, source_updated_at, raw_payload)
        values (${tournamentId}, ${rows[0].id}, now(), ${json(source.raw)}::jsonb)
        on conflict (tournament_id, team_id) do update set
          source_updated_at = excluded.source_updated_at, raw_payload = excluded.raw_payload
      `;
    }
    return { count: teams.length };
  });
}
