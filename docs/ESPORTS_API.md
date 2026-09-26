# Cito API integration

The implementation was checked against Cito's current machine-readable references:

- [Endpoint manifest](https://citoapi.com/ai/endpoints.json)
- [League of Legends Postman collection](https://citoapi.com/postman/citoapi-league-of-legends.postman_collection.json)
- [Authentication](https://citoapi.com/docs/authentication/)
- [Rate limits](https://citoapi.com/docs/rate-limits/)

## Completed-game request chain

```text
GET /api/v1/lol/tournaments/{tournamentId}
GET /api/v1/lol/matches/{matchId}
GET /api/v1/lol/matches/{matchId}/games
GET /api/v1/lol/games/{gameId}
GET /api/v1/lol/games/{gameId}/stats
```

## Stage-catalog request chain

```text
GET /api/v1/lol/tournaments/{tournamentId}
GET /api/v1/lol/tournaments/{tournamentId}/matches
GET /api/v1/lol/teams/{teamSlug}/roster
GET /api/v1/lol/players/{playerId}/stats
```

Catalog calls run sequentially with a minimum interval compatible with the free 10-request-per-minute allowance. Stale roster reports are preserved as operator warnings rather than silently treated as fresh data.

World Championship roster windows add an operator-confirmed provider-team whitelist to this chain.
Tournament discovery still verifies each team, but roster and player-stat calls run only for the
surviving teams selected for that stage. Unknown or duplicate team identifiers fail before the stage
catalog transaction begins.

All calls use `https://api.citoapi.com` and send `x-api-key` from the server-only `CITO_API_KEY` environment variable. The client times out after 15 seconds, never retries ordinary `4xx` responses, and retries `429`/`5xx` responses up to three times while honoring `Retry-After`.

Cito payloads are validated at the adapter boundary. The original payload is retained for debugging and future re-normalization, while fantasy scoring reads only normalized statistics.

## Repeated stage synchronization

`npm run stage:sync` paces calls at just over six seconds, fetches tournament metadata once, then processes configured matches in order.
For each match it requests the match and game list, but only requests game details and player stats
for completed games that are not already stored. This keeps normal polling economical while retaining
an explicit `--refresh-completed true` repair path for provider corrections. Every imported game
triggers idempotent player and roster score materialization; the final stage-wide pass converges the
global leaderboard even when no new game was found.

## Production caveat

Cito describes itself as an independent aggregator and not an official, rights-cleared Riot feed. A production launch must separately review data licensing, branding, trademark, and commercial-use requirements.
