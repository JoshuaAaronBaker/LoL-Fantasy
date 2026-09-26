# Architecture

## Boundaries

- `src/lib/providers` owns vendor HTTP calls and converts vendor payloads into normalized domain values.
- `src/lib/ingestion` orchestrates completed-game loading and transactional persistence.
- `src/lib/domain` contains pure fantasy rules with no React, network, or database dependency.
- `src/lib/db` contains server-only connections and read models.
- `src/app` renders safe read models and never handles provider secrets or authoritative score input.

The Cito implementation intentionally exposes only the operations used by this milestone. Later provider methods should be added to `EsportsDataProvider` when a real feature needs them, not speculatively.

## Data flow

The operator provides tournament and match IDs. The provider loads tournament metadata, match metadata, match games, each completed game, and its player stats. Normalization validates stable IDs and maps role aliases. A single PostgreSQL transaction upserts source entities, replaces authoritative player-game rows, and materializes scores for the selected ruleset.

An ingestion log is created before the domain transaction, so malformed data rolls back the domain write while leaving a failed run for diagnosis. Logs and raw payloads are never rendered by the web application.

## Deployment direction

The Next.js application is Vercel-compatible. For hosted Supabase, `DATABASE_URL` should be a server-only Supavisor transaction-pooler URL; the PostgreSQL client disables prepared statements for pooler compatibility. Scheduled ingestion, Supabase Auth, and Realtime are later milestones.
