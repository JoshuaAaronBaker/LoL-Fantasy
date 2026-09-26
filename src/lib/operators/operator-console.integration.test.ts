import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replaceTournamentCandidates } from "@/lib/competitions/repository";
import { createDatabase } from "@/lib/db/connect";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const userId = "95000000-0000-0000-0000-000000000001";
const slug = "operator-console-integration";

suite("operator console persistence and isolation", () => {
  beforeAll(async () => {
    await sql!`delete from auth.users where id = ${userId}`;
    await sql!`delete from fantasy_competitions where slug = ${slug}`;
    await sql!`
      insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
      values (${userId}, 'authenticated', 'authenticated', 'operator_test@users.lolfantasy.invalid',
        '{"username":"operator_test"}', now(), now())
    `;
    await sql!`insert into fantasy_operators (user_id) values (${userId})`;
    await sql!`insert into fantasy_competitions (slug, name) values (${slug}, 'Operator Test')`;
  });

  afterAll(async () => {
    await sql!`delete from fantasy_competitions where slug = ${slug}`;
    await sql!`delete from auth.users where id = ${userId}`;
    await sql!.end();
  });

  it("idempotently replaces provider candidates and records freshness", async () => {
    const candidate = {
      provider: "cito" as const,
      providerId: "lol-worlds_2026",
      name: "Worlds 2026",
      startTime: "2026-10-20T00:00:00.000Z",
      endTime: "2026-11-20T00:00:00.000Z",
      leagueName: "World Championship",
      leagueSlug: "worlds",
      isInternational: true,
      raw: { safe: true },
    };
    await replaceTournamentCandidates(sql!, slug, [candidate]);
    await replaceTournamentCandidates(sql!, slug, [candidate]);
    const rows = await sql!<Array<{ count: number; provider_id: string; checked: boolean }>>`
      select count(*) over ()::int as count, candidate.provider_id,
        (competition.provider_checked_at is not null) as checked
      from competition_tournament_candidates candidate
      join fantasy_competitions competition on competition.id = candidate.competition_id
      where competition.slug = ${slug}
    `;
    expect(rows).toEqual([{ count: 1, provider_id: "lol-worlds_2026", checked: true }]);
  });

  it("does not expose the operator allowlist to authenticated browser roles", async () => {
    await expect(sql!.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
      await tx`set local role authenticated`;
      await tx`select user_id from fantasy_operators`;
    })).rejects.toThrow(/permission denied/i);
  });
});
