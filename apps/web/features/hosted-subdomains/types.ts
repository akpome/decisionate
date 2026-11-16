export type HostedBrand = {
  name: string; logo_url: string; favicon_url: string; background_url: string
  primary_color: string; accent_color: string; background_color: string
  support_email: string; welcome_heading: string; welcome_text: string
}
export type HostedPortal = {
  id: string; hostname: string; origin: string; active: boolean
  primary_origin: string; branding: HostedBrand | null
}
export const hostedPrimaryOrigin = "https://app.decisionate.ca"
export const isHostedHostname = (hostname: string) => /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?\.decisionate\.app$/.test(hostname)
