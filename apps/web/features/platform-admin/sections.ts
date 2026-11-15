import type { PlatformAdminAccessDetails } from "@/lib/api"

export const adminSections = [
  { id: "overview", label: "Overview", permissions: ["overview"] },
  { id: "workspaces", label: "Customers", permissions: ["workspaces"] },
  { id: "users", label: "People & access", permissions: ["users"] },
  { id: "analytics", label: "Usage", permissions: ["analytics"] },
  { id: "credit_settings", label: "Billing", permissions: ["credit_settings"] },
  { id: "email", label: "Email", permissions: ["email_settings", "alerts"] },
  { id: "white_label", label: "White label", permissions: [] },
  { id: "marketing", label: "Marketing", permissions: [] },
  { id: "operations", label: "Operations", permissions: ["maintenance", "audit"] },
] as const

export type AdminSection = typeof adminSections[number]["id"]

export function visibleAdminSections(access: PlatformAdminAccessDetails | null) {
  return adminSections.filter(section => access?.allowed && (access.full_access ||
    section.permissions.some(permission => access.permissions.includes(permission))))
}

export function sectionNeedsPermission(section: AdminSection, permission: string) {
  if (section === "overview") return permission === "overview"
  if (section === "analytics" && permission === "workspaces") return true
  return adminSections.find(item => item.id === section)?.permissions.some(item => item === permission) ?? false
}
