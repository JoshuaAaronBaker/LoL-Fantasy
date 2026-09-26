"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import { isRosterStageOpen, validateRoster } from "@/lib/domain/roster";
import type { ProRole } from "@/lib/domain/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const rosterPayloadSchema = z.object({
  stageId: z.string().uuid(),
  playerIds: z.array(z.string().uuid()).length(5),
  captainPlayerId: z.string().uuid(),
});

export interface SaveRosterResult {
  ok: boolean;
  errors?: string[];
  saved?: { totalSalary: number; submittedAt: string };
}

export async function saveRosterAction(input: unknown): Promise<SaveRosterResult> {
  const payload = rosterPayloadSchema.safeParse(input);
  if (!payload.success) return { ok: false, errors: ["The submitted lineup is malformed."] };

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, errors: ["Your session expired. Log in and try again."] };

  const sql = getDatabase();
  try {
    const result = await sql.begin(async (tx) => {
      const stages = await tx<Array<{
        id: string; slug: string; status: string; roster_lock_time: string | null;
        database_now: string; salary_cap: string; max_players_per_team: number;
      }>>`
        select id, slug, status, roster_lock_time::text, clock_timestamp()::text as database_now,
          salary_cap::text, max_players_per_team
        from tournament_stages where id = ${payload.data.stageId} for update
      `;
      const stage = stages[0];
      if (!stage) return { ok: false as const, errors: ["This fantasy stage does not exist."] };
      if (stage.status !== "OPEN") return { ok: false as const, errors: ["This stage is not open for roster submissions."] };
      if (!isRosterStageOpen(stage.status, stage.database_now, stage.roster_lock_time)) {
        return { ok: false as const, errors: ["This stage is locked. Your lineup was not changed."] };
      }

      const rows = await tx<Array<{
        id: string; team_id: string; role: ProRole; price: string; eligible: boolean;
      }>>`
        select p.id, tp.team_id, tp.role, price.price::text,
          (tp.eligible and price.eligible) as eligible
        from tournament_players tp
        join pro_players p on p.id = tp.player_id
        join player_stage_prices price on price.stage_id = tp.stage_id and price.player_id = tp.player_id
        where tp.stage_id = ${stage.id} and p.id in ${tx(payload.data.playerIds)}
      `;
      const validation = validateRoster(
        { playerIds: payload.data.playerIds, captainPlayerId: payload.data.captainPlayerId },
        rows.map((row) => ({
          id: row.id, teamId: row.team_id, role: row.role, price: Number(row.price), eligible: row.eligible,
        })),
        { salaryCap: Number(stage.salary_cap), maxPlayersPerTeam: stage.max_players_per_team },
      );
      if (!validation.valid) return { ok: false as const, errors: validation.errors };

      const rosters = await tx<Array<{ id: string; submitted_at: string }>>`
        insert into fantasy_rosters (user_id, stage_id, captain_player_id, total_salary, submitted_at)
        values (${user.id}, ${stage.id}, ${payload.data.captainPlayerId}, ${validation.totalSalary}, clock_timestamp())
        on conflict (user_id, stage_id) do update set
          captain_player_id = excluded.captain_player_id,
          total_salary = excluded.total_salary,
          submitted_at = clock_timestamp()
        returning id, submitted_at::text
      `;
      await tx`delete from fantasy_roster_players where roster_id = ${rosters[0].id}`;
      for (const row of rows) {
        await tx`
          insert into fantasy_roster_players (roster_id, player_id, team_id, role, acquisition_price)
          values (${rosters[0].id}, ${row.id}, ${row.team_id}, ${row.role}, ${row.price})
        `;
      }
      return {
        ok: true as const,
        saved: { totalSalary: validation.totalSalary, submittedAt: rosters[0].submitted_at },
        slug: stage.slug,
      };
    });
    if (result.ok) revalidatePath(`/play/${result.slug}`);
    return result;
  } catch {
    return { ok: false, errors: ["The lineup could not be saved. Nothing was changed."] };
  }
}
