# Architecture

## Boundaries

- `src/lib/providers` owns vendor HTTP calls and converts vendor payloads into normalized domain values.
- `src/lib/ingestion` orchestrates completed-game loading and transactional persistence.
- `src/lib/stages` builds immutable stage catalogs and price snapshots.
- `src/lib/rosters` exposes safe stage and saved-roster read models.
- `src/lib/supabase` owns cookie-backed authentication clients and session refresh.
- `src/lib/domain` contains pure fantasy rules with no React, network, or database dependency.
- `src/lib/db` contains server-only connections and read models.
- `src/app` renders safe read models and never handles provider secrets or authoritative score input.

The Cito implementation exposes completed-game ingestion plus the tournament-team, current-roster, and aggregate-player-stat operations required by the roster builder.

## Data flow

The operator provides tournament and match IDs. The provider loads tournament metadata, match metadata, match games, each completed game, and its player stats. Normalization validates stable IDs and maps role aliases. A single PostgreSQL transaction upserts source entities, replaces authoritative player-game rows, and materializes scores for the selected ruleset.

An ingestion log is created before the domain transaction, so malformed data rolls back the domain write while leaving a failed run for diagnosis. Logs and raw payloads are never rendered by the web application.

Stage bootstrap is a separate operator flow. It paces Cito calls, snapshots active starters, calculates prices within each role, proves that the catalog can produce a legal lineup, and changes the stage from `UPCOMING` to `OPEN` in one database transaction. Database triggers prevent price or eligibility changes after opening.

Browser drafts are convenience state only. A roster submission contains IDs, then a protected server action reloads stage rules and catalog facts, locks the stage row, validates against database time, and transactionally replaces the user's roster.

## Deployment direction

The Next.js application is Vercel-compatible. For hosted Supabase, `DATABASE_URL` should be a server-only Supavisor transaction-pooler URL; the PostgreSQL client disables prepared statements for pooler compatibility. Hosted Auth must keep email confirmation disabled because usernames map to internal synthetic addresses. Scheduled ingestion, roster scoring, private leagues, and Realtime are later milestones.
