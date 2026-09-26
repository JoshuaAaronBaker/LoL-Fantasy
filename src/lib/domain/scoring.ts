import Decimal from "decimal.js";
import type { ProRole } from "./types";

export type ScoringMetric = "kills" | "deaths" | "assists" | "cs" | "win";

export interface ScoringRule {
  metric: ScoringMetric;
  pointsPerUnit: string | number;
  role: ProRole | null;
}

export interface ScoreableStats {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  won: boolean;
  role: ProRole | null;
}

export interface ScoreResult {
  total: string;
  breakdown: Record<ScoringMetric, string>;
}

const METRICS: ScoringMetric[] = ["kills", "deaths", "assists", "cs", "win"];

function unitsFor(metric: ScoringMetric, stats: ScoreableStats) {
  if (metric === "win") return stats.won ? 1 : 0;
  return stats[metric];
}

export function calculateFantasyScore(stats: ScoreableStats, rules: ScoringRule[]): ScoreResult {
  const breakdown = Object.fromEntries(METRICS.map((metric) => [metric, "0.00"])) as Record<
    ScoringMetric,
    string
  >;

  for (const metric of METRICS) {
    const applicableRules = rules.filter(
      (rule) => rule.metric === metric && (rule.role === null || rule.role === stats.role),
    );
    const roleRule = applicableRules.find((rule) => rule.role === stats.role && rule.role !== null);
    const rule = roleRule ?? applicableRules.find((candidate) => candidate.role === null);
    if (!rule) continue;
    breakdown[metric] = new Decimal(unitsFor(metric, stats))
      .mul(rule.pointsPerUnit)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2);
  }

  const total = Object.values(breakdown)
    .reduce((sum, value) => sum.add(value), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);

  return { total, breakdown };
}

export function applyCaptainMultiplier(score: string | number, multiplier: string | number) {
  return new Decimal(score)
    .mul(multiplier)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
