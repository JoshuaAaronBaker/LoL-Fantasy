import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { claimOperatorJob, completeOperatorJob, failOperatorJob } from "../src/lib/operators/jobs";
import { finishStageSyncSchedule } from "../src/lib/operators/schedules";
import { CitoEsportsDataProvider } from "../src/lib/providers/cito/client";
import { runStageBootstrap } from "../src/lib/stages/bootstrap-runner";
import { synchronizeStage } from "../src/lib/stages/sync";

async function processNextJob(
  sql: ReturnType<typeof createDatabase>,
  workerId: string,
  apiKey: string,
) {
  const job = await claimOperatorJob(sql, workerId);
  if (!job) return false;
  console.info(JSON.stringify({ workerId, jobId: job.id, jobType: job.jobType, attempt: job.attempts }, null, 2));
  try {
    const provider = new CitoEsportsDataProvider({
      apiKey,
      minRequestIntervalMs: 6_100,
      maxRetries: 1,
    });
    let result: unknown;
    if (job.jobType === "STAGE_BOOTSTRAP") {
      result = await runStageBootstrap(
        sql,
        provider,
        {
          tournamentId: job.payload.tournamentId,
          slug: job.payload.stageSlug,
          name: job.payload.stageName,
          lockAt: job.payload.lockAt,
          eligibleTeamIds: job.payload.teamProviderIds,
        },
        (message) => console.info(`[${job.id}] ${message}`),
      );
    } else {
      const syncResult = await synchronizeStage(sql, provider, {
        stageSlug: job.payload.stageSlug,
        matchIds: job.payload.matchProviderIds,
        refreshCompleted: job.payload.refreshCompleted,
      }, (message) => console.info(`[${job.id}] ${message}`));
      result = syncResult;
      await finishStageSyncSchedule(sql, job.payload.scheduleId, syncResult.stageStatus);
    }
    await completeOperatorJob(sql, job.id, workerId, result);
    console.info(JSON.stringify({ jobId: job.id, status: "SUCCEEDED", result }, null, 2));
    return true;
  } catch (error) {
    await Promise.race([
      failOperatorJob(sql, job.id, workerId, error),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out while recording the failed operator job.")), 15_000);
      }),
    ]).catch((failureError) => {
      console.error(failureError instanceof Error ? failureError.message : failureError);
    });
    throw error;
  }
}

async function main() {
  const env = getServerEnv();
  if (!env.CITO_API_KEY) throw new Error("CITO_API_KEY is required to process operator jobs.");
  const databaseEndpoint = new URL(env.DATABASE_URL);
  console.info(JSON.stringify({
    databaseHost: databaseEndpoint.hostname,
    databasePort: databaseEndpoint.port || "5432",
  }));
  const sql = createDatabase(env.DATABASE_URL);
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  try {
    const maxJobs = 5;
    let processed = 0;
    while (processed < maxJobs && await processNextJob(sql, workerId, env.CITO_API_KEY)) {
      processed += 1;
    }
    console.info(JSON.stringify({ workerId, status: "IDLE", processed, maxJobs }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
