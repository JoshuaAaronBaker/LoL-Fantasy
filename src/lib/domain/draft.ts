import type { ProRole } from "./types";

export const DRAFT_VERSION = 1;

export interface RosterDraft {
  version: 1;
  selections: Partial<Record<ProRole, string>>;
  captainPlayerId: string | null;
}

export function parseRosterDraft(
  value: string | null,
  catalog: Array<{ id: string; role: ProRole }>,
): RosterDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<RosterDraft>;
    if (parsed.version !== DRAFT_VERSION || !parsed.selections || typeof parsed.selections !== "object") return null;
    const known = new Map(catalog.map((player) => [player.id, player.role]));
    const selections: Partial<Record<ProRole, string>> = {};
    for (const [role, id] of Object.entries(parsed.selections)) {
      if (typeof id === "string" && known.get(id) === role) selections[role as ProRole] = id;
    }
    const selectedIds = new Set(Object.values(selections));
    const captainPlayerId = parsed.captainPlayerId && selectedIds.has(parsed.captainPlayerId)
      ? parsed.captainPlayerId
      : null;
    return { version: DRAFT_VERSION, selections, captainPlayerId };
  } catch {
    return null;
  }
}

