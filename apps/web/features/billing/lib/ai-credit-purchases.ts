export function creditPurchaseQuote(
  quantity: string,
  packSize: number,
  priceCents: number
) {
  const packs = /^\d+$/.test(quantity) ? Number(quantity) : 0
  const credits = packs * packSize
  const totalCents = packs * priceCents
  const valid =
    Number.isSafeInteger(packs) &&
    packs > 0 &&
    Number.isSafeInteger(credits) &&
    credits > 0 &&
    credits <= 2_147_483_647 &&
    Number.isSafeInteger(totalCents) &&
    totalCents >= 0
  return valid ? { packs, credits, totalCents } : null
}

export function creditPurchaseMessage(status: string) {
  if (status === "confirmed")
    return "Payment confirmed. Your purchased credits have been added."
  if (status === "expired")
    return "This credit checkout has expired. No credits were added. You can start a new purchase below."
  if (status === "failed")
    return "Your credit payment failed. No credits were added. Please try again."
  if (status === "checking") return "Checking your credit payment..."
  return "Your credit payment has not been confirmed yet. Check again before making another purchase."
}
