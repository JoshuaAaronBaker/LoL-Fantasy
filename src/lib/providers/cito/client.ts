import type { EsportsDataProvider, PlayerStatsResult } from "../esports-data-provider";
import type { NormalizedGame } from "@/lib/domain/types";
import {
  normalizeGame,
  normalizeGames,
  normalizeMatch,
  normalizePlayerStats,
  normalizeTournament,
  normalizeTournamentTeams,
  normalizeTeamRoster,
  normalizePlayerAggregateStats,
} from "./normalize";

const BASE_URL = "https://api.citoapi.com/api/v1";

export class CitoApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "CitoApiError";
  }
}

export interface CitoClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

function retryDelay(response: Response | null, attempt: number) {
  const header = response?.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 60_000);
  }
  return Math.min(250 * 2 ** attempt + Math.floor(Math.random() * 100), 2_500);
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CitoEsportsDataProvider implements EsportsDataProvider {
  readonly name = "cito" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly options: CitoClientOptions) {
    if (!options.apiKey.trim()) throw new Error("CITO_API_KEY is required for live ingestion.");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private async get(path: string): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response: Response | null = null;
      try {
        response = await this.fetchImpl(`${BASE_URL}${path}`, {
          headers: { accept: "application/json", "x-api-key": this.options.apiKey },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.ok) return await response.json();

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === this.maxRetries) {
          const body = await response.text().catch(() => "");
          throw new CitoApiError(
            `Cito request failed (${response.status}) for ${path}${body ? `: ${body.slice(0, 240)}` : ""}`,
            response.status,
          );
        }
      } catch (error) {
        if (error instanceof CitoApiError) throw error;
        lastError = error;
        if (attempt === this.maxRetries) {
          throw new CitoApiError(`Cito request failed for ${path}: ${String(error)}`, null);
        }
      }
      await sleep(retryDelay(response, attempt));
    }
    throw lastError;
  }

  async getTournament(tournamentId: string) {
    return normalizeTournament(await this.get(`/lol/tournaments/${encodeURIComponent(tournamentId)}`));
  }

  async getTournamentTeams(tournamentId: string) {
    return normalizeTournamentTeams(
      await this.get(`/lol/tournaments/${encodeURIComponent(tournamentId)}/matches`),
    );
  }

  async getTeamRoster(teamId: string) {
    return normalizeTeamRoster(await this.get(`/lol/teams/${encodeURIComponent(teamId)}/roster`), teamId);
  }

  async getPlayerAggregateStats(playerId: string) {
    return normalizePlayerAggregateStats(
      await this.get(`/lol/players/${encodeURIComponent(playerId)}/stats`),
    );
  }

  async getMatch(matchId: string, tournamentId: string) {
    return normalizeMatch(await this.get(`/lol/matches/${encodeURIComponent(matchId)}`), tournamentId);
  }

  async getMatchGames(matchId: string) {
    return normalizeGames(await this.get(`/lol/matches/${encodeURIComponent(matchId)}/games`), matchId);
  }

  async getGame(gameId: string, matchId: string) {
    return normalizeGame(await this.get(`/lol/games/${encodeURIComponent(gameId)}`), matchId);
  }

  async getGamePlayerStats(game: NormalizedGame): Promise<PlayerStatsResult> {
    const raw = await this.get(`/lol/games/${encodeURIComponent(game.providerId)}/stats`);
    return { stats: normalizePlayerStats(raw, game), raw };
  }
}
