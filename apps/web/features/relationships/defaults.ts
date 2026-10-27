export const RELATIONSHIP_DEFAULTS = {
  method: "spearman",
  period: "weekly",
  aggregation: "sum",
  minimumObservations: 52,
  maximumLag: 12,
  minimumAbsCoefficient: 0.3,
  lagMode: "manual",
  lagPeriods: 0,
  lagDirection: "a_leads_b",
} as const

export const MAXIMUM_RELATIONSHIP_OBSERVATIONS = 3653
export const MINIMUM_RELATIONSHIP_OBSERVATIONS = 24
