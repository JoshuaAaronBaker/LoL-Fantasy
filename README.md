# LoL Fantasy

An authenticated, stage-based League of Legends fantasy roster builder backed by real competitive data:

```text
Cito API or labeled fixture
        ↓
runtime validation and normalization
        ↓
idempotent PostgreSQL transaction
        ↓
versioned fantasy scoring and role-balanced pricing
        ↓
username auth, local drafts, and server-verified rosters
```

## Prerequisites

- Node.js 24+
- Docker Desktop
- A Cito API key for live verification only

## Local setup

```bash
npm install
cp .env.example .env
npm run db:start
npm run db:reset
npm run ingest:fixture
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The fixture is synthetic and is visibly labeled everywhere it appears.

Copy the local API URL and publishable key from `supabase status -o env` into `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. If Supabase prints a different database connection, update `DATABASE_URL`. Never prefix the Cito key with `NEXT_PUBLIC_`.

Accounts use a public username plus a Supabase-managed password. No email is collected and password recovery is intentionally unavailable in this MVP.

## Live Cito verification

Add `CITO_API_KEY` to `.env`, then use stable IDs from Cito:

```bash
npm run ingest:cito -- --tournament <tournament-id> --match <match-id>
npm run ingest:cito -- --tournament <tournament-id> --match <match-id> --game <game-id>
```

The first form imports every completed game in the match. The second targets one game. Repeating either command updates the same rows; it never increments scores.

## Scoring recalculation

```bash
npm run scores:recalculate -- --ruleset default-v1
npm run scores:recalculate -- --ruleset default-v1 --game <game-id>
```

The seeded rules are kills `+3`, assists `+1.5`, deaths `-1`, CS `+0.01`, and win `+2`. Stage totals apply the configured `1.5×` captain multiplier and are materialized idempotently for the global leaderboard.

## Build a fantasy stage

The bootstrap discovers tournament teams, loads current starters and aggregate stats sequentially, calculates role-relative prices, verifies that a legal lineup exists, and then atomically opens an immutable stage:

```bash
npm run stage:bootstrap -- \
  --tournament lol-lcs_split_3_2026 \
  --stage lcs-dev-playoffs \
  --name "LCS Development Playoffs" \
  --lock-at 2099-01-01T00:00:00.000Z
```

Repeating the command for an open stage is a no-op. Change a development lock with:

```bash
npm run stage:set-lock -- --stage lcs-dev-playoffs --lock-at <future-ISO-timestamp>
```

Explicitly attach ingested matches to the stage before they count toward fantasy totals:

```bash
npm run stage:assign-matches -- \
  --stage lcs-dev-playoffs \
  --matches <match-id>,<another-match-id>
```

Ingestion and player-score recalculation automatically refresh affected leaderboards. An operator can also replay the materialization directly:

```bash
npm run leaderboard:recalculate -- --stage lcs-dev-playoffs
```

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Database integration tests are opt-in so unit tests remain runnable without Docker:

```bash
TEST_DATABASE_URL="$DATABASE_URL" npm test
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [Scoring](docs/SCORING.md)
- [Cito integration](docs/ESPORTS_API.md)
