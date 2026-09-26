import postgres from "postgres";

export function createDatabase(url: string) {
  return postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
}
