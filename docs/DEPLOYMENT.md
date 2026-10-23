# Production deployment

The supported low-operations deployment uses Vercel for the Next.js application, hosted Supabase
for Postgres and Auth, and GitHub Actions for the paced Cito worker. Use separate Supabase projects
for staging and production. Never point Vercel preview deployments at the production database.

## 1. Create and migrate Supabase

Create the project, save its project reference, then run:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

Do not pass `--include-seed` in production. In Authentication settings:

- enable email/password signups;
- disable email confirmation because usernames map to synthetic internal addresses;
- set Site URL to the canonical production URL;
- add the production URL and explicitly approved preview URLs to Redirect URLs;
- enable Cloudflare Turnstile CAPTCHA and enter the Turnstile secret key;
- review Auth rate limits before advertising the site.

Use the Supabase transaction-pooler URI for `DATABASE_URL`. Keep prepared statements disabled, as
configured in `src/lib/db/connect.ts`.

## 2. Deploy the web application

Import `JoshuaAaronBaker/LoL-Fantasy` into Vercel and use the default Next.js build settings. Set
these variables for the Production environment:

```text
DATABASE_URL
CITO_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_TURNSTILE_SITE_KEY
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
```

Generate the Server Action key once with `openssl rand -base64 32` and keep it stable across
deployments. `SUPABASE_SERVICE_ROLE_KEY` is not required by the web application and should remain in
a trusted operator environment. After deployment, confirm `/api/health` returns HTTP 200 and add it
to an uptime monitor.

## 3. Initialize production data

Store production operator values in an ignored `.env.production.local` file and prefix commands with
`DOTENV_CONFIG_PATH=.env.production.local`. Connect Worlds and create the operator account:

```bash
DOTENV_CONFIG_PATH=.env.production.local npm run competition:configure -- \
  --competition worlds \
  --name "World Championship Fantasy" \
  --tournament <cito-tournament-id>

DOTENV_CONFIG_PATH=.env.production.local npm run operator:grant -- \
  --username <operator-username>
```

From `/ops/worlds`, refresh tournament teams, queue the first stage using only surviving teams, run
the worker, and save the complete provider match manifest with a five-minute interval. Confirm the
real roster lock timestamp before opening registration.

## 4. Enable scheduled scoring

Add the following GitHub Actions repository secrets:

```text
LIVE_DATABASE_URL
CITO_API_KEY
```

`LIVE_DATABASE_URL` must be the same hosted Supabase transaction-pooler URI used by production.
Then create the repository variable `LIVE_SYNC_ENABLED=true`. The `live-sync.yml` workflow runs every
five minutes, queues a due synchronization, and processes one durable job without overlapping a
previous run. Keep the variable disabled until the tournament, stage, and match manifest have been
verified. Trigger one manual run and inspect `/ops/worlds` before relying on the schedule.

## 5. Verify the release

CI runs lint, TypeScript, unit tests, the production build, migrated database integration tests, and
Playwright. Before announcing a contest, manually verify with two non-operator accounts:

- registration, login, logout, and generic authentication failures;
- roster draft restoration, submission, replacement, captain choice, salary cap, and team limit;
- exact lock-time rejection and opponent lineup concealment before lock;
- operator isolation and failed-job retry behavior;
- completed-game ingestion, support vision scoring, captain scoring, stage standings, and Worlds totals;
- automatic leaderboard refresh and stale-feed warning;
- desktop and mobile layouts.

Run the production audit locally as an additional release gate:

```bash
npm audit --omit=dev --audit-level=high
```

## 6. Operations and recovery

- Watch GitHub Actions failures and the Ops job history during every live match window.
- Configure an external uptime check for `/api/health` and the `/worlds` page.
- Enable the backup/PITR option appropriate for the Supabase plan and perform one restore rehearsal.
- If Cito corrects a completed game, run stage sync with `--refresh-completed true` and verify the
  idempotent leaderboard result.
- If the web release is faulty, use Vercel's previous deployment rollback. Database migrations must
  be forward-fixed unless a separately tested down migration exists.
- If the scheduler misbehaves, set `LIVE_SYNC_ENABLED=false`; queued work remains visible in Ops.

For an operator-assisted password reset, keep the service-role key only in the trusted CLI environment:

```bash
read -s OPERATOR_RESET_PASSWORD
export OPERATOR_RESET_PASSWORD
DOTENV_CONFIG_PATH=.env.production.local npm run operator:reset-password -- --username <username>
unset OPERATOR_RESET_PASSWORD
```

## 7. Launch decision

Before public promotion, review Cito's data license and the permitted use of team marks, player
images, Riot trademarks, and commercial features. The in-app privacy notice, terms, and unofficial
project disclaimer are product baselines, not a substitute for legal review.

