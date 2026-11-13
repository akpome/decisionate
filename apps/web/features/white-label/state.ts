export type Configuration = {
  id: string; name: string; web_url: string; allowed_origins: string[]; currency: string
  logo_url: string; primary_color: string; support_email: string; sender_email: string
  privacy_url: string; terms_url: string; auth_issuer: string; railway_api_service: string
  prices: Record<string, { price_id: string; amount_cents: number | null }>; confirmed_checks: number[]
}

export type Setup = {
  configuration: Configuration; revision: number; updated_at: string
  stage: "draft" | "ready_to_deploy" | "deployment_incomplete" | "launch_review" | "launch_confirmed" | "needs_review"
  completion: { confirmed_at: string; current: boolean } | null
  readiness: {
    registered: boolean; configuration_complete: boolean; package_ready: boolean; api_url: string
    scope: string; launch_checks: string[]
    setup_checks: { key: string; label: string; step: number; complete: boolean }[]
    checks: { key: string; label: string; complete: boolean; detail: string }[]
  }
}

export type Listing = {
  setups: Setup[]; registered: { id: string; name: string; web_url: string }[]
  products: { key: string; label: string }[]
}

export const emptyConfiguration: Configuration = {
  id: "", name: "", web_url: "", allowed_origins: [], currency: "USD", logo_url: "", primary_color: "#0047FF",
  support_email: "", sender_email: "", privacy_url: "", terms_url: "", auth_issuer: "", railway_api_service: "decisionate-api",
  prices: {}, confirmed_checks: [],
}

export const stageLabels = {
  draft: "Draft", ready_to_deploy: "Ready to deploy", deployment_incomplete: "Deployment incomplete",
  launch_review: "Ready for launch review", launch_confirmed: "Launch confirmed", needs_review: "Launch needs review",
}

export function hasSetupChanges(form: Configuration, saved: Setup | null) {
  return JSON.stringify(form) !== JSON.stringify(saved?.configuration ?? emptyConfiguration)
}

export function canConfirmLaunch(saved: Setup | null, dirty: boolean) {
  return !!saved && !dirty && !saved.completion?.current && saved.readiness.configuration_complete
    && saved.readiness.launch_checks.every((_, index) => saved.configuration.confirmed_checks.includes(index))
}

export function resumeStep(saved: Setup) {
  const missing = saved.readiness.setup_checks.find(item => !item.complete)
  if (missing) return missing.step
  return saved.readiness.configuration_complete ? 3 : 2
}
