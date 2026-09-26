import "server-only";
import type { Sql } from "postgres";
import { getServerEnv } from "@/lib/env/server";
import { createDatabase } from "./connect";

declare global {
  var lolFantasySql: Sql | undefined;
}

export function getDatabase() {
  if (!globalThis.lolFantasySql) {
    globalThis.lolFantasySql = createDatabase(getServerEnv().DATABASE_URL);
  }
  return globalThis.lolFantasySql;
}
