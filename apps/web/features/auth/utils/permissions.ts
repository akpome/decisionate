export function canViewDashboard(role: string) {
  return ["owner", "admin", "analyst"].includes(role)
}