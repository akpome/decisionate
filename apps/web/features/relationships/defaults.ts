export const RELATIONSHIP_DEFAULTS = {
  method: "spearman",
  period: "daily",
  aggregation: "sum",
  minimumObservations: 24,
  maximumLag: 12,
  minimumAbsCoefficient: 0.3,
  lagMode: "manual",
  lagPeriods: 0,
} as const

export const MAXIMUM_RELATIONSHIP_OBSERVATIONS = 3653
