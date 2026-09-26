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

The primary product route is [http://localhost:3000/worlds](http://localhost:3000/worlds). It remains in a clearly labeled waiting state until a real World Championship tournament is connected; development LCS data is never presented as Worlds data.

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

For World Championship roster windows, explicitly supply only the teams still alive at the start of
that round. The command rejects duplicate or unknown provider team IDs before loading rosters:

```bash
npm run stage:bootstrap -- \
  --tournament <worlds-tournament-id> \
  --stage worlds-<round> \
  --name "Worlds <Round>" \
  --lock-at <future-ISO-timestamp> \
  --teams <team-slug>,<another-team-slug>
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

## Operate a live stage

Use the stage synchronizer for the normal contest loop. On its first run, pass the complete stage
schedule. It fetches provider data sequentially, assigns those matches, imports only newly completed
games, refreshes the global leaderboard, and advances the stage with database time:

```bash
npm run stage:sync -- \
  --stage lcs-dev-playoffs \
  --matches <match-id>,<another-match-id>
```

Every later run can use the stored assignments:

```bash
npm run stage:sync -- --stage lcs-dev-playoffs
```

The lifecycle is monotonic: `OPEN` before the exact lock timestamp, then `LOCKED`, `LIVE` after play
starts, and `COMPLETE` when every assigned match is terminal. Assign the complete schedule before
lock so completion is based on the full contest. Completed games are skipped on routine replays to
stay within the Cito free tier. To deliberately re-fetch settled stats after a correction:

```bash
npm run stage:sync -- --stage lcs-dev-playoffs --refresh-completed true
```

The command is idempotent and scheduler-ready: a replay with no provider or lifecycle changes is
recorded as `UNCHANGED` and does not increment scores.

## Connect the World Championship

The seeded `worlds` competition is deliberately provider-neutral while the next tournament feed is
unavailable. Once Cito publishes the tournament, connect it without changing application code:

```bash
npm run competition:configure -- \
  --competition worlds \
  --tournament <worlds-tournament-id> \
  --name "World Championship Fantasy" \
  --description "Redraft every round and climb one global leaderboard."
```

Then bootstrap one immutable stage per roster window with `--teams`. Stage scores automatically roll
up into the single cumulative leaderboard at `/worlds`; no private leagues or invite codes are used.
Once a stage locks, the Worlds hub also shows its tie-aware leading rosters, winning captain and
lineup, live/final scoring state, and a link to the full stage leaderboard.

Operators can perform the provider discovery and connection workflow at `/ops/worlds`. Grant access
from a trusted terminal; the browser cannot add operators or edit the allowlist:

```bash
npm run operator:grant -- --username <username>
```

The console reviews provider candidates before connection, refreshes the tournament team field, shows
stage readiness, and queues the next immutable roster window with an explicit surviving-team field.
Run one durable queued job with:

```bash
npm run jobs:work
```

The worker exclusively claims one job, paces Cito requests, builds and validates the catalog, then
atomically opens the stage. A crashed worker's lease expires after 30 minutes so another worker can
recover the request. Failed jobs remain visible and can be explicitly requeued from the same form.

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
