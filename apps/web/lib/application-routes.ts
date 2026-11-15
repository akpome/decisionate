export const workspaceRoutes = [
  { path: "/weekly-reports", internal: "/dashboard/reports/weekly" },
  ...[
    "action-needed", "alerts", "billing", "budget-planner", "business-impact",
    "connections", "dashboards", "datasets", "decisions", "entity-matching",
    "forecasts", "help", "insights", "relationships", "reports", "settings", "white-label",
  ].map(segment => ({ path: `/${segment}`, internal: `/dashboard/${segment}` })),
]

function isPathWithin(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`)
}

export function isWorkspacePathname(pathname: string) {
  return pathname === "/dashboard" || workspaceRoutes.some(route => isPathWithin(pathname, route.path))
}

export function canonicalWorkspacePathname(pathname: string) {
  if (isPathWithin(pathname, "/reports/weekly")) {
    return "/weekly-reports" + pathname.slice("/reports/weekly".length)
  }
  const legacy = workspaceRoutes.find(route => isPathWithin(pathname, route.internal))
  return legacy ? legacy.path + pathname.slice(legacy.internal.length) : pathname
}
