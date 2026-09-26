# Architecture

## Boundaries

- `src/lib/providers` owns vendor HTTP calls and converts vendor payloads into normalized domain values.
- `src/lib/ingestion` orchestrates completed-game loading and transactional persistence.
- `src/lib/stages` builds immutable stage catalogs and price snapshots.
- `src/lib/competitions` maps a product competition to its provider tournament and builds cumulative standings.
- `src/lib/operators` centralizes the server-only operator allowlist check and restricted read models.
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

World Championship fantasy is modeled as one `fantasy_competitions` record backed by many immutable
tournament stages. An operator confirms the surviving team IDs before each stage is bootstrapped, so
the roster and pricing pipeline never loads eliminated teams for the next window. Users redraft per
stage, while the Worlds read model sums their stage-score snapshots into one global leaderboard.
The seeded Worlds shell may exist without a provider tournament, which keeps the UI honest while a
future tournament feed is not yet available.

The Worlds operator console discovers a bounded current provider catalog, stores only championship
candidates, and requires an explicit selection before connecting the product competition. Operator
identity is rechecked from Supabase Auth and the server-managed `fantasy_operators` allowlist at the
data boundary and again for every action. The allowlist and discovery records have no browser grants.

The competition read model also derives stage podiums directly from the same materialized score
snapshots. It returns every roster in the top three competitive ranks so boundary ties are preserved,
and it loads lineup details only for stages whose status or database lock time permits public reveal.

Long-running stage bootstrap work crosses a durable `operator_jobs` boundary. The operator action
validates the connected tournament and selected teams, then stores an idempotent configuration-only
payload. A separate worker exclusively claims work with `FOR UPDATE SKIP LOCKED`, owns it through a
time-bounded lease, and calls the same reusable bootstrap service as the terminal command. Provider
credentials remain worker environment state and never enter the queue.

## Deployment direction

The Next.js application is Vercel-compatible. For hosted Supabase, `DATABASE_URL` should be a server-only Supavisor transaction-pooler URL; the PostgreSQL client disables prepared statements for pooler compatibility. Hosted Auth must keep email confirmation disabled because usernames map to internal synthetic addresses. The stage-sync command is ready to run from a hosted scheduler; deployment wiring, monitoring, and Realtime are later milestones. The product intentionally uses one global stage leaderboard rather than private leagues.
