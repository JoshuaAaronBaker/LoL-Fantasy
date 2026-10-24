import postgres from "postgres";

export function createDatabase(url: string) {
  return postgres(url, {
    max: 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    keep_alive: 10,
    connection: {
      application_name: "lol-fantasy",
      statement_timeout: 30_000,
      lock_timeout: 10_000,
      idle_in_transaction_session_timeout: 60_000,
    },
  });
}
