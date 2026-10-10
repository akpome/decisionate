const consentKey = "decisionate:signup-consent:v1"
const consentChanged = "decisionate:signup-consent-changed"

export function readSignupConsent() {
  try {
    return window.sessionStorage.getItem(consentKey) === "accepted"
  } catch {
    return false
  }
}

export function writeSignupConsent(accepted: boolean) {
  try {
    if (accepted) window.sessionStorage.setItem(consentKey, "accepted")
    else window.sessionStorage.removeItem(consentKey)
  } catch {
    // The form can still continue in memory when browser storage is disabled.
  }
  window.dispatchEvent(new Event(consentChanged))
}

export function subscribeSignupConsent(onChange: () => void) {
  window.addEventListener(consentChanged, onChange)
  return () => window.removeEventListener(consentChanged, onChange)
}
