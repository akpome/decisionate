// Build-time presentation for separately provisioned hosted frontends. No secrets.
export const portalBrand = {
  id: process.env.NEXT_PUBLIC_PORTAL_ID || "",
  name: process.env.NEXT_PUBLIC_PORTAL_NAME || "Decisionate",
  logo: process.env.NEXT_PUBLIC_PORTAL_LOGO || (process.env.NEXT_PUBLIC_PORTAL_ID ? "" : "/icons/decisionate-logo.png"),
  color: process.env.NEXT_PUBLIC_PORTAL_COLOR || "#2563EB",
  support: process.env.NEXT_PUBLIC_PORTAL_SUPPORT || "support@decisionate.ca",
  privacy: process.env.NEXT_PUBLIC_PORTAL_PRIVACY || "/privacy",
  terms: process.env.NEXT_PUBLIC_PORTAL_TERMS || "/terms",
  url: process.env.NEXT_PUBLIC_PORTAL_URL || "",
}
