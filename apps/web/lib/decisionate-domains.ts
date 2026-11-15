// The primary product's hosts only. Hosted portals keep their own routing.
export const DECISIONATE_MARKETING_ORIGIN = "https://decisionate.ca"
export const DECISIONATE_APPLICATION_ORIGIN = "https://app.decisionate.ca"
export function isDecisionatePwaHost(hostname: string) {
  return hostname === new URL(DECISIONATE_APPLICATION_ORIGIN).hostname
}
export const DECISIONATE_AUTH_LINKS = {
  signIn: `${DECISIONATE_APPLICATION_ORIGIN}/sign-in`,
  signUp: `${DECISIONATE_APPLICATION_ORIGIN}/sign-up`,
} as const
