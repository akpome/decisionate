const retryWindow = 24 * 60 * 60 * 1000

export async function decisionCreationKey(signature: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature))
  const storageKey = `decision-create:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`
  const now = Date.now()
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null")
    if (typeof saved?.key === "string" && typeof saved.expires === "number" && saved.expires > now) return saved.key
  } catch {
    // Storage can be unavailable; the API also checks for identical active decisions.
  }
  const key = crypto.randomUUID()
  try {
    // Persist only a digest and request token, never the decision or evidence text.
    sessionStorage.setItem(storageKey, JSON.stringify({ key, expires: now + retryWindow }))
  } catch {}
  return key
}
