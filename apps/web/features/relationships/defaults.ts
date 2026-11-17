export const RELATIONSHIP_DEFAULTS = {
  method: "spearman",
  period: "daily",
  aggregation: "sum",
  minimumObservations: 30,
  maximumLag: 12,
  minimumAbsCoefficient: 0.3,
  lagMode: "automatic",
  lagPeriods: 0,
  lagDirection: "auto",
} as const

export const MAXIMUM_RELATIONSHIP_OBSERVATIONS = 3653
export const MINIMUM_RELATIONSHIP_OBSERVATIONS = 24
