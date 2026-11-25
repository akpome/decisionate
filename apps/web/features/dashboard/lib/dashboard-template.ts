export const dashboardViewOptions = [
  ["executive", "Executive"],
  ["performance", "Performance"],
] as const

export type DashboardTemplate = (typeof dashboardViewOptions)[number][0]

export function resolveDashboardTemplate(value: unknown): DashboardTemplate {
  return value === "performance" ? "performance" : "executive"
}
