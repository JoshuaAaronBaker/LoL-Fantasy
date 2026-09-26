# Database

The schema is created by `supabase/migrations/202609250001_foundation.sql`.

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

RLS is enabled on every table and access is revoked from `anon` and `authenticated`. This milestone reads and writes through server-only PostgreSQL connections. User-facing policies will be introduced with authentication, once their exact ownership rules exist.
