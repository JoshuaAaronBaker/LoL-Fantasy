# Database

The schema is created by the versioned files in `supabase/migrations`.

## Source entities

- `tournaments` and `tournament_stages` separate provider competitions from fantasy roster periods.
- `matches` belongs to a tournament. Its nullable `stage_id` prevents the importer from inventing product stage mappings; the provider's label is retained separately.
- `games`, `pro_teams`, `pro_players`, and `player_game_stats` retain stable provider IDs and raw source payloads.

Every provider entity has a uniqueness constraint on `(provider, provider_id)`. A player's game statistics are unique on `(game_id, player_id)`.

## Scoring and operations

- `fantasy_scoring_rule_sets` versions configuration and stores the captain multiplier.
- `fantasy_scoring_rules` supports global and optional role-specific metric weights.
- `player_game_scores` is a reproducible materialization, unique by stat row and ruleset.
- `ingestion_runs` records status and row counts without storing credentials.
- `stage_sync_runs` audits each stage-wide provider sync, lifecycle result, and processed row count. It is operator-only and has no client grants.
- `operator_jobs` durably queues long-running stage bootstrap requests with idempotency keys, exclusive worker leases, attempt counts, results, and bounded errors. Payloads never contain provider credentials.
- `stage_sync_schedules` stores one operator-approved match manifest and polling cadence per stage. Due rows enqueue `STAGE_SYNC` jobs only when no sync for that schedule is already queued or running.

## Authentication and roster building

- `fantasy_competitions` maps a stable product route such as `worlds` to an optional provider tournament. A draft record can render before the provider publishes that tournament.
- `fantasy_operators` is a server-managed allowlist keyed to Auth users; it has no authenticated browser grant or self-service policy.
- `competition_tournament_candidates` stores reviewed provider discoveries separately from the selected competition tournament.
- `profiles` maps a Supabase Auth identity to a case-preserving, case-insensitively unique username.
- `tournament_teams` records the teams discovered in a provider tournament.
- `tournament_players` snapshots a player's stage team, role, starter status, eligibility, and roster freshness.
- `player_stage_prices` snapshots projected FP/G, role percentile, algorithm version, price, and source stats.
- `fantasy_rosters` is unique per user and stage and stores the captain, submitted salary, and submission time.
- `fantasy_roster_players` stores the five role-unique selections with acquisition-price and team snapshots.
- `fantasy_roster_player_scores` materializes each selected player's stage base score, multiplier, final score, and games counted.
- `fantasy_roster_stage_scores` materializes base total, captain bonus, final total, and distinct games for leaderboard ranking.

RLS is enabled on every table. Authenticated users can read the fantasy catalog and leaderboard totals. They can mutate only their own roster before lock, inspect only their own player breakdown before lock, and see opponent lineups after lock. The application also verifies identity in every server mutation and performs authoritative writes in a database transaction.
Operator-only tables are reachable only through server-side database code after a fresh Auth identity
and allowlist check.

Stage status is advanced monotonically by the operator synchronizer. The roster lock comparison uses
`clock_timestamp()` from PostgreSQL, and completion requires at least one assigned match with every
assigned match in a terminal provider state.

The cumulative Worlds leaderboard is a read model over `fantasy_roster_stage_scores`: totals are
grouped by user across every stage belonging to the competition's tournament. Stage price and player
snapshots remain the authoritative historical inputs.

Stage podiums use `rank()` within each revealed stage and retain all rosters tied within the first
three ranks. Their captain and player breakdowns come from the roster and player-score snapshots;
open-stage selections never enter this read model before database lock time.
