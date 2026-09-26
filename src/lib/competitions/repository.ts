import type { Sql } from "postgres";
import type { NormalizedTournament } from "@/lib/domain/types";

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
