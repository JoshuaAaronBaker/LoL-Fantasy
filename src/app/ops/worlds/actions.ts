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
import { getServerEnv } from "@/lib/env/server";
import { requireOperator } from "@/lib/operators/access";
import { enqueueStageBootstrapJob, stageBootstrapJobPayloadSchema } from "@/lib/operators/jobs";
import { getOperatorWorldsView } from "@/lib/operators/queries";
import { setStageSyncScheduleEnabled, upsertStageSyncSchedule } from "@/lib/operators/schedules";
import { CitoEsportsDataProvider } from "@/lib/providers/cito/client";
import { openNextRoundFromStage } from "@/lib/stages/rollover";

const candidateIdSchema = z.uuid();
const stageIdSchema = z.uuid();

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
    message = `Opened ${stageName} with ${result.players} players from ${result.teams} teams.`;
  } catch {
    finish("The redraft round could not be opened. Check the source, future lock, and teams playing this round.", true);
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
