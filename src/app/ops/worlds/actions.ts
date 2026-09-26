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
import { CitoEsportsDataProvider } from "@/lib/providers/cito/client";

const candidateIdSchema = z.uuid();

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
      description: "Redraft through every World Championship roster window and climb one global leaderboard.",
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
