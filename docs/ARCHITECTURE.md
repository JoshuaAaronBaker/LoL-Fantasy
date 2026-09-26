# Architecture

## Boundaries

- `src/lib/providers` owns vendor HTTP calls and converts vendor payloads into normalized domain values.
- `src/lib/ingestion` orchestrates completed-game loading and transactional persistence.
- `src/lib/stages` builds immutable stage catalogs and price snapshots.
- `src/lib/rosters` exposes safe stage and saved-roster read models.
- `src/lib/leaderboard` materializes roster totals and exposes lock-aware standings read models.
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

Fantasy stages only score explicitly assigned matches through `matches.stage_id`. Each ingestion, player-score replay, roster submission, or operator replay converges `fantasy_roster_player_scores` and `fantasy_roster_stage_scores` on the same totals. Leaderboards expose usernames and totals while the stage is open, but return opponent lineup breakdowns only after database lock time.

The stage synchronizer is the operational boundary for a live contest. The first run can assign an
explicit complete match schedule; later runs reuse that manifest. It reads Cito sequentially,
skips already-ingested completed games by default, refreshes materialized leaderboard scores, and
advances `OPEN → LOCKED → LIVE → COMPLETE` from database time and assigned-match state. Lifecycle
transitions are monotonic, and every run is audited independently from lower-level ingestion runs.

## Deployment direction

The Next.js application is Vercel-compatible. For hosted Supabase, `DATABASE_URL` should be a server-only Supavisor transaction-pooler URL; the PostgreSQL client disables prepared statements for pooler compatibility. Hosted Auth must keep email confirmation disabled because usernames map to internal synthetic addresses. The stage-sync command is ready to run from a hosted scheduler; deployment wiring, monitoring, and Realtime are later milestones. The product intentionally uses one global stage leaderboard rather than private leagues.
