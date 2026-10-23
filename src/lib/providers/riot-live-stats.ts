import type { NormalizedGame, NormalizedPlayerGameStat } from "@/lib/domain/types";

const RIOT_LIVE_STATS_BASE_URL = "https://feed.lolesports.com/livestats/v1";

type JsonRecord = Record<string, unknown>;

interface RiotParticipantMetadata {
  participantId: number;
  playerName: string;
}

interface RiotParticipantStats {
  participantId: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  wardsPlaced: number;
  wardsDestroyed: number;
}

export interface RiotFinalStatsSnapshot {
  capturedAt: string;
  participants: Array<RiotParticipantMetadata & RiotParticipantStats>;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function numberAt(source: JsonRecord | null, key: string) {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unwrap(value: unknown): JsonRecord | null {
  const outer = record(value);
  return record(outer?.data) ?? record(outer?.result) ?? outer;
}

function gameDurationSeconds(game: NormalizedGame) {
  const source = unwrap(game.raw);
  return numberAt(source, "duration") ?? numberAt(source, "durationSeconds");
}

function riotGameId(providerId: string) {
  return providerId.replace(/^lol-game-/, "");
}

function playerNameKey(value: string) {
  return value.trim().split(/\s+/).at(-1)?.toLocaleLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}

async function getJson(fetchImpl: typeof fetch, url: URL, timeoutMs: number) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Riot live stats request failed (${response.status}) for ${url.pathname}.`);
  return response.json() as Promise<unknown>;
}

function participantMetadata(payload: unknown) {
  const source = record(payload);
  const metadata = record(source?.gameMetadata);
  const teams = [record(metadata?.blueTeamMetadata), record(metadata?.redTeamMetadata)];
  const participants: RiotParticipantMetadata[] = [];
  for (const team of teams) {
    const rows = Array.isArray(team?.participantMetadata) ? team.participantMetadata : [];
    for (const value of rows) {
      const row = record(value);
      const participantId = numberAt(row, "participantId");
      const summonerName = row?.summonerName;
      if (participantId === null || typeof summonerName !== "string" || !summonerName.trim()) continue;
      participants.push({ participantId, playerName: summonerName.trim() });
    }
  }
  return participants;
}

function firstFrameTime(payload: unknown) {
  const frames = record(payload)?.frames;
  if (!Array.isArray(frames)) return null;
  for (const value of frames) {
    const timestamp = record(value)?.rfc460Timestamp;
    if (typeof timestamp === "string" && !Number.isNaN(new Date(timestamp).valueOf())) return timestamp;
  }
  return null;
}

function finalFrame(payload: unknown) {
  const frames = record(payload)?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return null;
  return [...frames]
    .map((value) => record(value))
    .filter((value): value is JsonRecord => value !== null)
    .sort((left, right) => String(left.rfc460Timestamp).localeCompare(String(right.rfc460Timestamp)))
    .at(-1) ?? null;
}

function participantStats(frame: JsonRecord) {
  const rows = Array.isArray(frame.participants) ? frame.participants : [];
  const participants: RiotParticipantStats[] = [];
  for (const value of rows) {
    const row = record(value);
    const participantId = numberAt(row, "participantId");
    const kills = numberAt(row, "kills");
    const deaths = numberAt(row, "deaths");
    const assists = numberAt(row, "assists");
    const cs = numberAt(row, "creepScore");
    const wardsPlaced = numberAt(row, "wardsPlaced");
    const wardsDestroyed = numberAt(row, "wardsDestroyed");
    if ([participantId, kills, deaths, assists, cs, wardsPlaced, wardsDestroyed].some((entry) => entry === null)) {
      continue;
    }
    participants.push({
      participantId: participantId!,
      kills: kills!,
      deaths: deaths!,
      assists: assists!,
      cs: cs!,
      wardsPlaced: wardsPlaced!,
      wardsDestroyed: wardsDestroyed!,
    });
  }
  return participants;
}

export async function getRiotFinalStats(
  fetchImpl: typeof fetch,
  game: NormalizedGame,
  timeoutMs = 15_000,
): Promise<RiotFinalStatsSnapshot> {
  const duration = gameDurationSeconds(game);
  if (!duration || duration <= 0) throw new Error(`Final game duration is missing for ${game.providerId}.`);

  const gameId = riotGameId(game.providerId);
  const windowUrl = new URL(`${RIOT_LIVE_STATS_BASE_URL}/window/${encodeURIComponent(gameId)}`);
  const windowPayload = await getJson(fetchImpl, windowUrl, timeoutMs);
  const metadata = participantMetadata(windowPayload);
  const startedAt = firstFrameTime(windowPayload);
  if (metadata.length !== 10 || !startedAt) {
    throw new Error(`Riot live stats metadata is incomplete for ${game.providerId}.`);
  }

  const estimatedFinalTime = new Date(startedAt).valueOf() + (duration + 60) * 1_000;
  // Riot's endpoint accepts timestamps on ten-second boundaries.
  const finalTarget = new Date(Math.floor(estimatedFinalTime / 10_000) * 10_000).toISOString();
  const detailsUrl = new URL(`${RIOT_LIVE_STATS_BASE_URL}/details/${encodeURIComponent(gameId)}`);
  detailsUrl.searchParams.set("startingTime", finalTarget);
  const detailsPayload = await getJson(fetchImpl, detailsUrl, timeoutMs);
  const frame = finalFrame(detailsPayload);
  if (!frame || typeof frame.rfc460Timestamp !== "string") {
    throw new Error(`Riot final frame is missing for ${game.providerId}.`);
  }
  const stats = participantStats(frame);
  if (stats.length !== 10) throw new Error(`Riot final frame is incomplete for ${game.providerId}.`);

  const statsById = new Map(stats.map((entry) => [entry.participantId, entry]));
  return {
    capturedAt: frame.rfc460Timestamp,
    participants: metadata.map((entry) => {
      const stat = statsById.get(entry.participantId);
      if (!stat) throw new Error(`Riot participant ${entry.participantId} is missing for ${game.providerId}.`);
      return { ...entry, ...stat };
    }),
  };
}

export function mergeRiotFinalStats(
  stats: NormalizedPlayerGameStat[],
  snapshot: RiotFinalStatsSnapshot,
) {
  const riotByName = new Map(snapshot.participants.map((entry) => [playerNameKey(entry.playerName), entry]));
  const matched = new Set<number>();
  const merged = stats.map((stat) => {
    const riot = riotByName.get(playerNameKey(stat.player.displayName));
    if (!riot) throw new Error(`Riot final stats could not be matched to ${stat.player.displayName}.`);
    matched.add(riot.participantId);
    return {
      ...stat,
      kills: riot.kills,
      deaths: riot.deaths,
      assists: riot.assists,
      cs: riot.cs,
      // Riot's public esports feed exposes ward placement and denial, but not its internal vision-score formula.
      // Ward activity is deterministic and keeps support scoring available when Cito omits visionScore.
      visionScore: riot.wardsPlaced + riot.wardsDestroyed,
      raw: {
        cito: stat.raw,
        riotLiveStats: riot,
        visionMetric: "wardsPlaced + wardsDestroyed",
        capturedAt: snapshot.capturedAt,
      },
    };
  });
  if (matched.size !== stats.length || matched.size !== snapshot.participants.length) {
    throw new Error("Riot final stats did not match the complete Cito player set.");
  }
  return merged;
}
