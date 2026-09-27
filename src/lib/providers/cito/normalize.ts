import { z } from "zod";
import type {
  NormalizedGame,
  NormalizedMatch,
  NormalizedPlayerGameStat,
  NormalizedTeam,
  NormalizedTournament,
  ProRole,
  PlayerAggregateStats,
  TeamRoster,
  TournamentTeam,
  TournamentCatalogEntry,
} from "@/lib/domain/types";

type JsonRecord = Record<string, unknown>;

const recordSchema = z.record(z.string(), z.unknown());

function record(value: unknown, context: string): JsonRecord {
  const result = recordSchema.safeParse(value);
  if (!result.success) throw new Error(`Cito ${context} must be a JSON object.`);
  return result.data;
}

function unwrap(value: unknown): unknown {
  const outer = recordSchema.safeParse(value);
  if (!outer.success) return value;
  if (outer.data.data !== undefined) return outer.data.data;
  if (outer.data.result !== undefined) return outer.data.result;
  return value;
}

function valueAt(source: JsonRecord, paths: string[]): unknown {
  for (const path of paths) {
    let current: unknown = source;
    for (const part of path.split(".")) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        current = undefined;
        break;
      }
      current = (current as JsonRecord)[part];
    }
    if (current !== undefined && current !== null) return current;
  }
  return undefined;
}

function text(source: JsonRecord, paths: string[], required = false): string | null {
  const value = valueAt(source, paths);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (required) throw new Error(`Cito payload is missing required field: ${paths.join(" or ")}.`);
  return null;
}

function numberValue(source: JsonRecord, paths: string[], fallback: number | null = null) {
  const value = valueAt(source, paths);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function booleanValue(source: JsonRecord, paths: string[]): boolean | null {
  const value = valueAt(source, paths);
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true" || value === "win" || value === "WIN") {
    return true;
  }
  if (value === 0 || value === "0" || value === "false" || value === "loss" || value === "LOSS") {
    return false;
  }
  return null;
}

function dateText(source: JsonRecord, paths: string[]) {
  const value = text(source, paths);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function arrayAt(value: unknown, keys: string[]): unknown[] {
  const unwrapped = unwrap(value);
  if (Array.isArray(unwrapped)) return unwrapped;
  const source = record(unwrapped, "collection");
  for (const key of keys) {
    const candidate = valueAt(source, [key]);
    if (Array.isArray(candidate)) return candidate;
  }
  throw new Error(`Cito payload did not contain an array at ${keys.join(", ")}.`);
}

export function canonicalRole(value: string | null): ProRole | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, ProRole> = {
    TOP: "TOP",
    TOPLANE: "TOP",
    JG: "JUNGLE",
    JUNGLE: "JUNGLE",
    JUNGLER: "JUNGLE",
    MID: "MID",
    MIDDLE: "MID",
    MIDLANE: "MID",
    ADC: "BOT",
    BOT: "BOT",
    BOTTOM: "BOT",
    BOTLANE: "BOT",
    SUPPORT: "SUPPORT",
    SUP: "SUPPORT",
  };
  return aliases[normalized] ?? null;
}

function normalizeTeamValue(value: unknown, context: string): NormalizedTeam {
  const source = record(value, context);
  return {
    provider: "cito",
    providerId: text(source, ["id", "teamId", "team_id", "slug"], true)!,
    name: text(source, ["name", "teamName", "displayName", "slug"], true)!,
    abbreviation: text(source, ["abbreviation", "code", "shortName", "acronym"]),
    imageUrl: text(source, ["logoUrl", "imageUrl", "logo"]),
    raw: value,
  };
}

export function normalizeTournamentTeams(payload: unknown): TournamentTeam[] {
  const matches = arrayAt(payload, ["matches", "items"]);
  const teams = new Map<string, TournamentTeam>();
  for (const match of matches) {
    const source = record(match, "tournament match");
    for (const candidate of [valueAt(source, ["team1", "homeTeam"]), valueAt(source, ["team2", "awayTeam"])]) {
      if (!candidate) continue;
      const team = normalizeTeamValue(candidate, "tournament team");
      if (team.providerId.toLowerCase() === "tbd") continue;
      const existing = teams.get(team.providerId);
      teams.set(team.providerId, {
        team: { ...team, imageUrl: team.imageUrl ?? existing?.team.imageUrl ?? null },
        raw: candidate,
      });
    }
  }
  return [...teams.values()].sort((left, right) => left.team.name.localeCompare(right.team.name));
}

export function normalizeTeamRoster(payload: unknown, requestedTeamId: string): TeamRoster {
  const source = record(payload, "team roster");
  const teamValue = valueAt(source, ["team"]);
  const team = teamValue ? normalizeTeamValue(teamValue, "roster team") : {
    provider: "cito" as const,
    providerId: requestedTeamId,
    name: requestedTeamId,
    abbreviation: null,
    imageUrl: null,
    raw: {},
  };
  const statusValue = valueAt(source, ["rosterStatus"]);
  const statusSource = statusValue && typeof statusValue === "object" ? record(statusValue, "roster status") : {};
  const players = arrayAt(source, ["data", "roster"]).map((value, index) => {
    const row = record(value, `roster player ${index + 1}`);
    const playerValue = valueAt(row, ["player"]);
    const player = playerValue && typeof playerValue === "object" ? record(playerValue, "roster player detail") : row;
    const roleText = text(row, ["role", "position"]);
    return {
      player: {
        provider: "cito" as const,
        providerId: text(row, ["lolPlayerId", "playerId", "id"], true)!,
        displayName: text(player, ["currentIgn", "playerName", "displayName", "name"], true)!,
        role: canonicalRole(roleText),
        teamProviderId: team.providerId,
        imageUrl: text(row, ["imageUrl", "player.imageUrl"]),
        raw: value,
      },
      role: canonicalRole(roleText),
      isStarter: booleanValue(row, ["isStarter"]) ?? false,
      isActive: booleanValue(row, ["isActive"]) ?? false,
      raw: value,
    };
  });
  return {
    team,
    status: text(statusSource, ["status"]),
    statusMessage: text(statusSource, ["message"]),
    checkedAt: dateText(statusSource, ["lastCheckedAt"]),
    players,
    raw: payload,
  };
}

export function normalizePlayerAggregateStats(payload: unknown): PlayerAggregateStats {
  const source = record(unwrap(payload), "player aggregate stats");
  return {
    gamesPlayed: numberValue(source, ["gamesPlayed"], 0)!,
    wins: numberValue(source, ["wins"], 0)!,
    losses: numberValue(source, ["losses"], 0)!,
    winRate: numberValue(source, ["winRate"], 0)!,
    avgKills: numberValue(source, ["avgKills"], 0)!,
    avgDeaths: numberValue(source, ["avgDeaths"], 0)!,
    avgAssists: numberValue(source, ["avgAssists"], 0)!,
    avgCs: numberValue(source, ["avgCs"], 0)!,
    avgVisionScore: numberValue(source, ["avgVisionScore", "visionScoreAvg"]),
    raw: payload,
  };
}

function collectMatchTeams(source: JsonRecord): NormalizedTeam[] {
  const direct = valueAt(source, ["teams", "participants"]);
  if (Array.isArray(direct)) {
    return direct.map((team, index) => normalizeTeamValue(team, `match team ${index + 1}`));
  }

  const sides = [valueAt(source, ["homeTeam", "team1", "blueTeam"]), valueAt(source, ["awayTeam", "team2", "redTeam"])];
  return sides
    .filter((team): team is NonNullable<typeof team> => team !== undefined && team !== null)
    .map((team, index) => normalizeTeamValue(team, `match team ${index + 1}`));
}

export function normalizeTournament(payload: unknown): NormalizedTournament {
  const unwrapped = unwrap(payload);
  const source = record(unwrapped, "tournament");
  return {
    provider: "cito",
    providerId: text(source, ["id", "tournamentId", "tournament_id", "slug"], true)!,
    name: text(source, ["name", "tournamentName", "displayName", "slug"], true)!,
    startTime: dateText(source, ["startTime", "startDate", "startsAt", "date"]),
    endTime: dateText(source, ["endTime", "endDate", "endsAt"]),
    raw: payload,
  };
}

export function normalizeTournamentCatalog(payload: unknown): TournamentCatalogEntry[] {
  return arrayAt(payload, ["tournaments", "items"]).map((value, index) => {
    const source = record(value, `tournament catalog entry ${index + 1}`);
    const leagueValue = valueAt(source, ["league"]);
    const league = leagueValue && typeof leagueValue === "object"
      ? record(leagueValue, `tournament catalog league ${index + 1}`)
      : {};
    return {
      provider: "cito" as const,
      providerId: text(source, ["tournamentId", "id", "tournament_id", "slug"], true)!,
      name: text(source, ["name", "tournamentName", "displayName", "slug"], true)!,
      startTime: dateText(source, ["startDate", "startTime", "startsAt", "date"]),
      endTime: dateText(source, ["endDate", "endTime", "endsAt"]),
      leagueName: text(league, ["name", "shortName"]),
      leagueSlug: text(league, ["slug", "id"]),
      isInternational: booleanValue(source, ["isInternational"]) ?? false,
      raw: value,
    };
  });
}

export function normalizeMatch(payload: unknown, tournamentId: string): NormalizedMatch {
  const unwrapped = unwrap(payload);
  const source = record(unwrapped, "match");
  return {
    provider: "cito",
    providerId: text(source, ["id", "matchId", "match_id"], true)!,
    tournamentProviderId:
      text(source, ["tournamentId", "tournament.id", "tournament.slug"]) ?? tournamentId,
    stageLabel: text(source, ["stage", "stageName", "blockName", "round", "phase"]),
    startTime: dateText(source, ["startTime", "startDate", "scheduledAt", "date"]),
    status: text(source, ["status", "state"])?.toUpperCase() ?? "UNKNOWN",
    teams: collectMatchTeams(source),
    raw: payload,
  };
}

export function normalizeGame(payload: unknown, matchId: string): NormalizedGame {
  const unwrapped = unwrap(payload);
  const source = record(unwrapped, "game");
  const statsSettled = booleanValue(source, ["statsSettled"]);
  const providerStatus = text(source, ["status", "state", "statsStatus"])?.toUpperCase();
  return {
    provider: "cito",
    providerId: text(source, ["id", "gameId", "game_id"], true)!,
    matchProviderId: text(source, ["matchId", "match.id", "match_id"]) ?? matchId,
    gameNumber: numberValue(source, ["gameNumber", "number", "game_number"]),
    status: statsSettled || providerStatus === "FINAL" ? "COMPLETED" : (providerStatus ?? "UNKNOWN"),
    winnerTeamProviderId: text(source, [
      "winnerTeamId",
      "winner.id",
      "winnerTeam.id",
      "winningTeamId",
      "winnerSlug",
    ]),
    startedAt: dateText(source, ["startedAt", "startTime", "startDate"]),
    endedAt: dateText(source, ["endedAt", "endTime", "completedAt"]),
    raw: payload,
  };
}

export function normalizeGames(payload: unknown, matchId: string) {
  return arrayAt(payload, ["games", "items"]).map((game) => normalizeGame(game, matchId));
}

export function normalizePlayerStats(payload: unknown, game: NormalizedGame): NormalizedPlayerGameStat[] {
  return arrayAt(payload, ["players", "playerStats", "stats", "participants", "items"]).map(
    (value, index) => {
      const source = record(value, `player stat ${index + 1}`);
      const teamValue = valueAt(source, ["team"]);
      const teamSource = teamValue && typeof teamValue === "object" ? record(teamValue, "stat team") : source;
      const team: NormalizedTeam = {
        provider: "cito",
        providerId: text(teamSource, ["id", "teamId", "team_id", "teamSlug", "slug"], true)!,
        name: text(teamSource, ["name", "teamName", "team_name", "teamSlug", "slug"], true)!,
        abbreviation: text(teamSource, ["abbreviation", "teamCode", "code", "shortName"]),
        raw: teamValue ?? value,
      };

      const playerValue = valueAt(source, ["player"]);
      const playerSource =
        playerValue && typeof playerValue === "object" ? record(playerValue, "stat player") : source;
      const providerRole = text(source, ["role", "position", "lane", "player.role"]);
      const playerId = text(playerSource, ["id", "playerId", "player_id", "lolPlayerId", "slug"], true)!;
      const explicitWin = booleanValue(source, ["win", "won", "isWinner", "result"]);

      return {
        provider: "cito",
        player: {
          provider: "cito",
          providerId: playerId,
          displayName: text(
            playerSource,
            ["displayName", "name", "handle", "summonerName", "currentIgn", "slug"],
            true,
          )!,
          role: canonicalRole(providerRole),
          teamProviderId: team.providerId,
          raw: playerValue ?? value,
        },
        team,
        role: canonicalRole(providerRole),
        providerRole,
        kills: numberValue(source, ["kills", "k"], 0)!,
        deaths: numberValue(source, ["deaths", "d"], 0)!,
        assists: numberValue(source, ["assists", "a"], 0)!,
        cs: numberValue(source, ["cs", "creepScore", "totalCs", "minionsKilled"], 0)!,
        visionScore: numberValue(source, ["visionScore", "vision_score"]),
        won: explicitWin ?? (game.winnerTeamProviderId === team.providerId),
        raw: value,
      };
    },
  );
}
