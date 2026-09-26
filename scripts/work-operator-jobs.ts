import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { claimOperatorJob, completeOperatorJob, failOperatorJob } from "../src/lib/operators/jobs";
import { CitoEsportsDataProvider } from "../src/lib/providers/cito/client";
import { runStageBootstrap } from "../src/lib/stages/bootstrap-runner";

async function main() {
  const env = getServerEnv();
  if (!env.CITO_API_KEY) throw new Error("CITO_API_KEY is required to process operator jobs.");
  const sql = createDatabase(env.DATABASE_URL);
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  try {
    const job = await claimOperatorJob(sql, workerId);
    if (!job) {
      console.info(JSON.stringify({ workerId, status: "IDLE" }, null, 2));
      return;
    }
    console.info(JSON.stringify({ workerId, jobId: job.id, jobType: job.jobType, attempt: job.attempts }, null, 2));
    try {
      const result = await runStageBootstrap(
        sql,
        new CitoEsportsDataProvider({ apiKey: env.CITO_API_KEY, minRequestIntervalMs: 6_100 }),
        {
          tournamentId: job.payload.tournamentId,
          slug: job.payload.stageSlug,
          name: job.payload.stageName,
          lockAt: job.payload.lockAt,
          eligibleTeamIds: job.payload.teamProviderIds,
        },
        (message) => console.info(`[${job.id}] ${message}`),
      );
      await completeOperatorJob(sql, job.id, workerId, result);
      console.info(JSON.stringify({ jobId: job.id, status: "SUCCEEDED", result }, null, 2));
    } catch (error) {
      await failOperatorJob(sql, job.id, workerId, error);
      throw error;
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
