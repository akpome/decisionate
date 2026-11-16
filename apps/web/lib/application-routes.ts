export const workspaceRoutes = [
  { path: "/weekly-reports", internal: "/dashboard/reports/weekly" },
  { path: "/business-analysis", internal: "/dashboard/reports" },
  ...[
    "action-needed", "alerts", "billing", "budget-planner", "business-impact",
    "connections", "dashboards", "datasets", "decisions", "entity-matching",
    "forecasts", "help", "insights", "relationships", "settings", "white-label", "hosted-portal",
  ].map(segment => ({ path: `/${segment}`, internal: `/dashboard/${segment}` })),
]

function isPathWithin(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`)
}

export function isWorkspacePathname(pathname: string) {
  return pathname === "/dashboard" || workspaceRoutes.some(route => isPathWithin(pathname, route.path))
}

export function internalWorkspacePathname(pathname: string) {
  const route = workspaceRoutes.find(route => isPathWithin(pathname, route.path))
  return route ? route.internal + pathname.slice(route.path.length) : pathname
}

export function canonicalWorkspacePathname(pathname: string) {
  const weekly = ["/reports/weekly", "/business-analysis/weekly"].find(path => isPathWithin(pathname, path))
  if (weekly) {
    return "/weekly-reports" + pathname.slice(weekly.length)
  }
  if (isPathWithin(pathname, "/reports")) {
    return "/business-analysis" + pathname.slice("/reports".length)
  }
  const legacy = workspaceRoutes.find(route => isPathWithin(pathname, route.internal))
  return legacy ? legacy.path + pathname.slice(legacy.internal.length) : pathname
}
