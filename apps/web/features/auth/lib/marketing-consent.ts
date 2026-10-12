import { marketingRequest } from "@/lib/api"

const key = "decisionate:marketing-choice:v1"
const maxAge = 48 * 60 * 60 * 1000

export function storeMarketingChoice(subscribed: boolean, version: string, language: "en" | "fr" = "en") {
  try {
    sessionStorage.setItem(key, JSON.stringify({ subscribed, version, language, at: Date.now() }))
  } catch {
    // Account creation remains available when browser storage is restricted.
  }
}

export async function completeSignupMarketing(userId: string, createdAt: number | null) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return
    const choice = JSON.parse(raw) as { subscribed: boolean; version: string; language: "en" | "fr"; at: number }
    if (!createdAt || createdAt < choice.at - 60000 || Date.now() - choice.at > maxAge) {
      sessionStorage.removeItem(key)
      return
    }
    if (choice.subscribed === true) {
      await marketingRequest(userId, "/preferences", { method: "PUT", body: JSON.stringify({ subscribed: true, consent_version: choice.version, language: choice.language, source: "signup" }) })
    }
    sessionStorage.removeItem(key)
  } catch {
    // Keep the pending choice for an explicit retry; never infer consent from signup.
  }
}
