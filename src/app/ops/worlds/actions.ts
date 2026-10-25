"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  configureCompetition,
  getCompetitionConnection,
  getTournamentCandidate,
  replaceTournamentCandidates,
  upsertTournamentTeams,
} from "@/lib/competitions/repository";
import { selectWorldChampionshipCandidates } from "@/lib/competitions/worlds-candidates";
import { getDatabase } from "@/lib/db/client";
import { validateRoster } from "@/lib/domain/roster";
import type { ProRole } from "@/lib/domain/types";
import { getServerEnv } from "@/lib/env/server";
import { recalculateRosterScores } from "@/lib/leaderboard/repository";
import { requireOperator } from "@/lib/operators/access";
import { enqueueStageBootstrapJob, stageBootstrapJobPayloadSchema } from "@/lib/operators/jobs";
import { getOperatorWorldsView } from "@/lib/operators/queries";
import { setStageSyncScheduleEnabled, upsertStageSyncSchedule } from "@/lib/operators/schedules";
import { backfillCatalogPlayerImages } from "@/lib/players/image-backfill";
import { CitoEsportsDataProvider } from "@/lib/providers/cito/client";
import { openNextRoundFromStage } from "@/lib/stages/rollover";
import { resetWorldsStagePricing } from "@/lib/stages/reset-worlds-pricing";

const candidateIdSchema = z.uuid();
const stageIdSchema = z.uuid();
const historicalRosterSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/),
  stageSlug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  topName: z.string().trim().min(1).max(50),
  jungleName: z.string().trim().min(1).max(50),
  midName: z.string().trim().min(1).max(50),
  botName: z.string().trim().min(1).max(50),
  supportName: z.string().trim().min(1).max(50),
  captainName: z.string().trim().min(1).max(50),
});
const historicalCaptainSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/),
  stageSlug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  captainName: z.string().trim().min(1).max(50),
});

function provider() {
  const apiKey = getServerEnv().CITO_API_KEY;
  if (!apiKey) throw new Error("The Cito provider is not configured.");
  return new CitoEsportsDataProvider({ apiKey });
}

function finish(message: string, isError = false): never {
  revalidatePath("/ops/worlds");
  revalidatePath("/worlds");
  redirect(`/ops/worlds?${isError ? "error" : "notice"}=${encodeURIComponent(message)}`);
}

export async function discoverWorldsTournamentsAction() {
  await requireOperator();
  let message: string;
  try {
    const catalog = await provider().getTournaments();
    const candidates = selectWorldChampionshipCandidates(catalog);
    await replaceTournamentCandidates(getDatabase(), "worlds", candidates);
    message = candidates.length === 1
      ? "Found 1 World Championship candidate."
      : `Found ${candidates.length} World Championship candidates.`;
  } catch {
    finish("Tournament discovery failed. Check the provider connection and try again.", true);
  }
  finish(message);
}

export async function connectWorldsTournamentAction(formData: FormData) {
  await requireOperator();
  const candidateId = candidateIdSchema.safeParse(formData.get("candidateId"));
  if (!candidateId.success) finish("That tournament candidate is invalid.", true);
  let message: string;
  try {
    const sql = getDatabase();
    const candidate = await getTournamentCandidate(sql, "worlds", candidateId.data);
    if (!candidate) throw new Error("That tournament candidate is no longer available.");
    const tournament = await provider().getTournament(candidate.provider_id);
    if (tournament.providerId !== candidate.provider_id) {
      throw new Error("The provider returned a different tournament.");
    }
    await configureCompetition(sql, {
      slug: "worlds",
      name: "World Championship Fantasy",
      description: "Redraft through every World Championship roster window and climb the leaderboard.",
      tournament,
    });
    message = `Connected ${tournament.name}.`;
  } catch {
    finish("Tournament connection failed. No competition settings were changed.", true);
  }
  finish(message);
}

export async function refreshWorldsTeamsAction() {
  await requireOperator();
  let message: string;
  try {
    const sql = getDatabase();
    const connection = await getCompetitionConnection(sql, "worlds");
    if (!connection?.tournament_id || !connection.provider_id) {
      throw new Error("Connect a Worlds tournament before refreshing teams.");
    }
    const teams = await provider().getTournamentTeams(connection.provider_id);
    await upsertTournamentTeams(sql, connection.tournament_id, teams);
    message = teams.length === 1 ? "Refreshed 1 tournament team." : `Refreshed ${teams.length} tournament teams.`;
  } catch {
    finish("Team refresh failed. Existing team records were preserved.", true);
  }
  finish(message);
}

export async function backfillPlayerImagesAction() {
  await requireOperator();
  let message: string;
  try {
    const apiKey = getServerEnv().CITO_API_KEY;
    if (!apiKey) throw new Error("The Cito provider is not configured.");
    const result = await backfillCatalogPlayerImages(
      getDatabase(),
      new CitoEsportsDataProvider({ apiKey, minRequestIntervalMs: 6_100 }),
    );
    const restored = result.restoredFromStoredPayloads + result.restoredFromProvider;
    message = result.unresolved.length === 0
      ? `Restored ${restored} player image${restored === 1 ? "" : "s"}; every catalog player now has a picture.`
      : `Restored ${restored} player images; ${result.unresolved.length} still have no provider picture.`;
  } catch {
    finish("Player image backfill failed. Existing pictures were preserved.", true);
  }
  finish(message);
}

export async function enqueueWorldsStageBootstrapAction(formData: FormData) {
  const operator = await requireOperator();
  let message: string;
  try {
    const view = await getOperatorWorldsView();
    if (!view?.tournamentProviderId) throw new Error("No Worlds tournament is connected.");
    const requestedTeamIds = formData.getAll("teamId").map(String);
    const knownTeamIds = new Set(view.teams.map((team) => team.providerId));
    if (requestedTeamIds.some((teamId) => !knownTeamIds.has(teamId))) {
      throw new Error("The request includes a team outside the connected tournament.");
    }
    const lockAt = new Date(String(formData.get("lockAt") ?? ""));
    if (Number.isNaN(lockAt.valueOf()) || lockAt <= new Date()) {
      throw new Error("The stage lock must be a future ISO timestamp.");
    }
    const payload = stageBootstrapJobPayloadSchema.parse({
      tournamentId: view.tournamentProviderId,
      stageSlug: formData.get("stageSlug"),
      stageName: formData.get("stageName"),
      lockAt: lockAt.toISOString(),
      teamProviderIds: [...new Set(requestedTeamIds)],
    });
    const job = await enqueueStageBootstrapJob(getDatabase(), operator.userId, payload);
    message = job.status === "QUEUED"
      ? `Queued ${payload.stageName} for catalog creation.`
      : `${payload.stageName} already has a ${job.status.toLowerCase()} job.`;
  } catch {
    finish("Stage request was rejected. Check its name, slug, future lock, and selected teams.", true);
  }
  finish(message);
}

export async function openWorldsRoundFromStageAction(formData: FormData) {
  await requireOperator();
  let message: string;
  try {
    const view = await getOperatorWorldsView();
    if (!view?.tournamentId) throw new Error("No Worlds tournament is connected.");
    const sourceStageId = stageIdSchema.parse(formData.get("sourceStageId"));
    const sourceStage = view.stages.find((stage) => stage.id === sourceStageId);
    if (!sourceStage || sourceStage.eligiblePlayers === 0) {
      throw new Error("Choose a source stage with a verified player catalog.");
    }
    const requestedTeamIds = [...new Set(formData.getAll("teamId").map(String))];
    const knownTeamIds = new Set(view.teams.map((team) => team.providerId));
    if (requestedTeamIds.length === 0 || requestedTeamIds.some((teamId) => !knownTeamIds.has(teamId))) {
      throw new Error("Choose valid teams playing the next round.");
    }
    const stageSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).parse(formData.get("stageSlug"));
    const stageName = z.string().trim().min(3).max(80).parse(formData.get("stageName"));
    const lockAt = z.iso.datetime().parse(formData.get("lockAt"));
    const result = await openNextRoundFromStage(getDatabase(), {
      sourceStageId,
      slug: stageSlug,
      name: stageName,
      lockAt,
      eligibleTeamProviderIds: requestedTeamIds,
    });
    message = `Opened ${stageName} with ${result.players} players from ${result.teams} teams${result.removedRosters > 0 ? `; removed ${result.removedRosters} invalid prior lineup${result.removedRosters === 1 ? "" : "s"}` : ""}.`;
  } catch {
    finish("The redraft round could not be opened. Check the source, future lock, and teams playing this round.", true);
  }
  finish(message);
}

export async function resetWorldsStagePricingAction(formData: FormData) {
  await requireOperator();
  let message: string;
  try {
    const stageSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).parse(formData.get("stageSlug"));
    const result = await resetWorldsStagePricing(getDatabase(), stageSlug);
    message = `Rebalanced ${stageSlug} to $7M–$13M daily-slate ranking prices and removed ${result.removedRosters} submitted lineups.`;
  } catch {
    finish("The price rebalance was rejected. The stage must be open, unlocked, and have no ingested games.", true);
  }
  finish(message);
}

export async function updateWorldsStageLockAction(formData: FormData) {
  await requireOperator();
  let message: string;
  try {
    const stageId = stageIdSchema.parse(formData.get("stageId"));
    const lockAt = z.iso.datetime().parse(formData.get("lockAt"));
    const result = await getDatabase().begin(async (tx) => {
      const stages = await tx<Array<{
        id: string; name: string; slug: string; status: string; database_now: string;
      }>>`
        select id, name, slug, status, clock_timestamp()::text as database_now
        from tournament_stages where id = ${stageId} for update
      `;
      const stage = stages[0];
      if (!stage || stages.length !== 1 || !["OPEN", "LOCKED"].includes(stage.status)) {
        throw new Error("Only one open or locked stage can be updated.");
      }
      if (new Date(lockAt) <= new Date(stage.database_now)) {
        throw new Error("The new lock must be in the future.");
      }
      const games = await tx<Array<{ count: number }>>`
        select count(*)::int as count
        from games game join matches fixture on fixture.id = game.match_id
        where fixture.stage_id = ${stage.id}
      `;
      if (games[0].count > 0) {
        throw new Error("A stage with ingested games cannot be reopened.");
      }
      await tx`
        update tournament_stages
        set roster_lock_time = ${lockAt}, status = 'OPEN', updated_at = clock_timestamp()
        where id = ${stage.id}
      `;
      return stage;
    });
    revalidatePath(`/play/${result.slug}`);
    message = `Set ${result.name} to lock at ${new Date(lockAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} Pacific.`;
  } catch {
    finish("The roster lock was not changed. Use a future ISO timestamp; stages with ingested games cannot be reopened.", true);
  }
  finish(message);
}

export async function repairHistoricalRosterAction(formData: FormData) {
  await requireOperator();
  let message: string;
  try {
    const input = historicalRosterSchema.parse({
      username: formData.get("username"),
      stageSlug: formData.get("stageSlug"),
      topName: formData.get("topName"),
      jungleName: formData.get("jungleName"),
      midName: formData.get("midName"),
      botName: formData.get("botName"),
      supportName: formData.get("supportName"),
      captainName: formData.get("captainName"),
    });
    const requested = [
      { role: "TOP" as const, name: input.topName },
      { role: "JUNGLE" as const, name: input.jungleName },
      { role: "MID" as const, name: input.midName },
      { role: "BOT" as const, name: input.botName },
      { role: "SUPPORT" as const, name: input.supportName },
    ];
    const result = await getDatabase().begin(async (tx) => {
      const stages = await tx<Array<{
        id: string; slug: string; status: string; roster_lock_time: string | null;
        salary_cap: string; max_players_per_team: number;
      }>>`
        select id, slug, status, roster_lock_time::text, salary_cap::text, max_players_per_team
        from tournament_stages where slug = ${input.stageSlug} for update
      `;
      const stage = stages[0];
      if (!stage || stages.length !== 1 || !["LOCKED", "LIVE", "COMPLETE"].includes(stage.status)) {
        throw new Error("Historical repairs require one locked or completed stage.");
      }
      const profiles = await tx<Array<{ id: string; username: string }>>`
        select id, username from profiles where username_normalized = ${input.username}
      `;
      const profile = profiles[0];
      if (!profile) throw new Error("That username does not exist.");
      const existing = await tx<Array<{ id: string }>>`
        select id from fantasy_rosters where user_id = ${profile.id} and stage_id = ${stage.id}
      `;
      if (existing.length > 0) throw new Error("That user already has a roster for this stage.");

      const normalizedNames = requested.map((player) => player.name.toLowerCase());
      if (new Set(normalizedNames).size !== 5) throw new Error("The five players must be unique.");
      const players = await tx<Array<{
        id: string; display_name: string; team_id: string; role: ProRole;
        price: string; eligible: boolean;
      }>>`
        select player.id, player.display_name, tournament_player.team_id, tournament_player.role,
          price.price::text, (tournament_player.eligible and price.eligible) as eligible
        from tournament_players tournament_player
        join pro_players player on player.id = tournament_player.player_id
        join player_stage_prices price
          on price.stage_id = tournament_player.stage_id and price.player_id = tournament_player.player_id
        where tournament_player.stage_id = ${stage.id}
          and lower(player.display_name) in ${tx(normalizedNames)}
      `;
      const playersByName = new Map(players.map((player) => [player.display_name.toLowerCase(), player]));
      const orderedPlayers = requested.map((requestedPlayer) => {
        const player = playersByName.get(requestedPlayer.name.toLowerCase());
        if (!player || player.role !== requestedPlayer.role) {
          throw new Error(`${requestedPlayer.name} is not the ${requestedPlayer.role} player in this stage.`);
        }
        return player;
      });
      const captain = playersByName.get(input.captainName.toLowerCase());
      if (!captain) throw new Error("The captain must be one of the five selected players.");
      const validation = validateRoster(
        { playerIds: orderedPlayers.map((player) => player.id), captainPlayerId: captain.id },
        orderedPlayers.map((player) => ({
          id: player.id,
          teamId: player.team_id,
          role: player.role,
          price: Number(player.price),
          eligible: player.eligible,
        })),
        { salaryCap: Number(stage.salary_cap), maxPlayersPerTeam: stage.max_players_per_team },
      );
      if (!validation.valid) throw new Error(validation.errors.join(" "));

      const rosters = await tx<Array<{ id: string }>>`
        insert into fantasy_rosters (
          user_id, stage_id, captain_player_id, total_salary, submitted_at
        ) values (
          ${profile.id}, ${stage.id}, ${captain.id}, ${validation.totalSalary},
          coalesce(${stage.roster_lock_time}::timestamptz - interval '1 millisecond', clock_timestamp())
        ) returning id
      `;
      for (const player of orderedPlayers) {
        await tx`
          insert into fantasy_roster_players (
            roster_id, player_id, team_id, role, acquisition_price
          ) values (
            ${rosters[0].id}, ${player.id}, ${player.team_id}, ${player.role}, ${player.price}
          )
        `;
      }
      await recalculateRosterScores(tx, stage.id);
      const scores = await tx<Array<{
        total_score: string; base_score: string; captain_bonus: string; games_scored: number;
      }>>`
        select total_score::text, base_score::text, captain_bonus::text, games_scored
        from fantasy_roster_stage_scores where roster_id = ${rosters[0].id}
      `;
      if (!scores[0]) throw new Error("The repaired roster did not receive a stage score.");
      return { username: profile.username, stageSlug: stage.slug, score: scores[0] };
    });
    revalidatePath("/worlds");
    revalidatePath(`/play/${result.stageSlug}/leaderboard`);
    message = `Added ${result.username}'s historical lineup: ${Number(result.score.total_score).toFixed(2)} points (${Number(result.score.captain_bonus).toFixed(2)} captain bonus across ${result.score.games_scored} games).`;
  } catch {
    finish("Historical lineup repair was rejected. Verify the account, stage, roles, captain, and that no roster already exists.", true);
  }
  finish(message);
}

export async function repairHistoricalCaptainAction(formData: FormData) {
  await requireOperator();
  let message: string;
  try {
    const input = historicalCaptainSchema.parse({
      username: formData.get("username"),
      stageSlug: formData.get("stageSlug"),
      captainName: formData.get("captainName"),
    });
    const result = await getDatabase().begin(async (tx) => {
      const stages = await tx<Array<{ id: string; slug: string; status: string }>>`
        select id, slug, status from tournament_stages
        where slug = ${input.stageSlug} for update
      `;
      const stage = stages[0];
      if (!stage || stages.length !== 1 || !["LOCKED", "LIVE", "COMPLETE"].includes(stage.status)) {
        throw new Error("Historical repairs require one locked or completed stage.");
      }
      const rosters = await tx<Array<{ id: string; username: string }>>`
        select roster.id, profile.username
        from fantasy_rosters roster
        join profiles profile on profile.id = roster.user_id
        where roster.stage_id = ${stage.id}
          and profile.username_normalized = ${input.username}
        for update of roster
      `;
      const roster = rosters[0];
      if (!roster || rosters.length !== 1) throw new Error("That user has no roster for this stage.");
      const captains = await tx<Array<{ id: string; display_name: string }>>`
        select player.id, player.display_name
        from fantasy_roster_players roster_player
        join pro_players player on player.id = roster_player.player_id
        where roster_player.roster_id = ${roster.id}
          and lower(player.display_name) = ${input.captainName.toLowerCase()}
      `;
      const captain = captains[0];
      if (!captain || captains.length !== 1) {
        throw new Error("The new captain must already be on the submitted roster.");
      }
      await tx`
        update fantasy_rosters set captain_player_id = ${captain.id}, updated_at = clock_timestamp()
        where id = ${roster.id}
      `;
      await recalculateRosterScores(tx, stage.id);
      const scores = await tx<Array<{
        total_score: string; captain_bonus: string; games_scored: number;
      }>>`
        select total_score::text, captain_bonus::text, games_scored
        from fantasy_roster_stage_scores where roster_id = ${roster.id}
      `;
      if (!scores[0]) throw new Error("The repaired captain did not receive a stage score.");
      return {
        username: roster.username,
        captainName: captain.display_name,
        stageSlug: stage.slug,
        score: scores[0],
      };
    });
    revalidatePath("/worlds");
    revalidatePath(`/play/${result.stageSlug}/leaderboard`);
    message = `Made ${result.captainName} captain for ${result.username}: ${Number(result.score.total_score).toFixed(2)} points (${Number(result.score.captain_bonus).toFixed(2)} captain bonus across ${result.score.games_scored} games).`;
  } catch {
    finish("Captain correction was rejected. Verify the account, completed stage, and that the captain is already on the roster.", true);
  }
  finish(message);
}

export async function configureWorldsStageSyncAction(formData: FormData) {
  const operator = await requireOperator();
  let message: string;
  try {
    const stageId = stageIdSchema.parse(formData.get("stageId"));
    const intervalMinutes = z.coerce.number().int().min(5).max(1_440).parse(formData.get("intervalMinutes"));
    const matchProviderIds = String(formData.get("matchIds") ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const view = await getOperatorWorldsView();
    const stage = view?.stages.find((entry) => entry.id === stageId);
    if (!stage || !["OPEN", "LOCKED", "LIVE"].includes(stage.status)) {
      throw new Error("That stage cannot be scheduled.");
    }
    await upsertStageSyncSchedule(getDatabase(), operator.userId, {
      stageId,
      intervalMinutes,
      matchProviderIds,
      refreshCompleted: formData.get("refreshCompleted") === "true",
    });
    message = `Scheduled ${stage.name} every ${intervalMinutes} minutes.`;
  } catch {
    finish("Sync schedule was rejected. Check the stage, interval, and complete unique match manifest.", true);
  }
  finish(message);
}

export async function toggleWorldsStageSyncAction(formData: FormData) {
  await requireOperator();
  let message: string;
  try {
    const stageId = stageIdSchema.parse(formData.get("stageId"));
    const enabled = formData.get("enabled") === "true";
    const view = await getOperatorWorldsView();
    const stage = view?.stages.find((entry) => entry.id === stageId);
    if (!stage) throw new Error("Stage not found.");
    await setStageSyncScheduleEnabled(getDatabase(), stageId, enabled);
    message = `${stage.name} synchronization ${enabled ? "resumed" : "paused"}.`;
  } catch {
    finish("The synchronization schedule could not be changed.", true);
  }
  finish(message);
}
