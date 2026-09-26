import "dotenv/config";
import { createDatabase } from "../src/lib/db/connect";
import { getServerEnv } from "../src/lib/env/server";
import { enqueueDueStageSyncJobs } from "../src/lib/operators/schedules";

async function main() {
  const sql = createDatabase(getServerEnv().DATABASE_URL);
  try {
    const jobs = await enqueueDueStageSyncJobs(sql);
    console.info(JSON.stringify({ queued: jobs.length, jobs }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
