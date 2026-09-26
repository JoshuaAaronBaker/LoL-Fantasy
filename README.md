# LoL Fantasy

The first technical milestone for a stage-based League of Legends fantasy game. This repository currently proves a narrow, production-shaped data path:

```text
Cito API or labeled fixture
        ↓
runtime validation and normalization
        ↓
idempotent PostgreSQL transaction
        ↓
versioned fantasy scoring
        ↓
read-only Next.js scorecard
```

The broader product—authentication, stage rosters, salary caps, private leagues, and leaderboards—is intentionally deferred until this path has been verified against a real completed game.

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

If `supabase start` prints a different database connection, update `DATABASE_URL` in `.env`. Never prefix the Cito key with `NEXT_PUBLIC_`.

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

The seeded rules are kills `+3`, assists `+1.5`, deaths `-1`, CS `+0.01`, and win `+2`. Captain multiplication is implemented as a deterministic domain helper but is not materialized until rosters exist.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
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
