import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/connect";
import { configureCompetition } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const sql = databaseUrl ? createDatabase(databaseUrl) : null;
const slug = "competition-config-integration";
const providerId = "competition-config-tournament";

suite("competition configuration", () => {
  afterAll(async () => {
    await sql!`delete from fantasy_competitions where slug = ${slug}`;
    await sql!`delete from tournaments where provider_id = ${providerId}`;
    await sql!.end();
  });

  it("idempotently connects a product competition to its provider tournament", async () => {
    const tournament = {
      provider: "cito" as const,
      providerId,
      name: "World Championship Test",
      startTime: "2026-10-01T00:00:00.000Z",
      endTime: "2026-11-01T00:00:00.000Z",
      raw: {},
    };
    await configureCompetition(sql!, { slug, name: "Worlds Test", description: "First", tournament });
    await configureCompetition(sql!, { slug, name: "Worlds Test Updated", description: "Second", tournament });
    const rows = await sql!<Array<{ count: number; name: string; status: string; tournament_provider_id: string }>>`
      select count(*) over ()::int as count, c.name, c.status, t.provider_id as tournament_provider_id
      from fantasy_competitions c join tournaments t on t.id = c.tournament_id
      where c.slug = ${slug}
    `;
    expect(rows).toEqual([{ count: 1, name: "Worlds Test Updated", status: "ACTIVE", tournament_provider_id: providerId }]);
  });
});
