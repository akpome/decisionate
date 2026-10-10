import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const source = readFileSync(
  new URL("../features/billing/lib/ai-credit-purchases.ts", import.meta.url),
  "utf8"
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
})
const loaded = { exports: {} }
vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports })
const { creditPurchaseQuote, creditPurchaseMessage } = loaded.exports

test("one-time packs calculate credit count and price without rounding quantity", () => {
  const quote = creditPurchaseQuote("3", 5000, 1000)
  assert.equal(quote.packs, 3)
  assert.equal(quote.credits, 15000)
  assert.equal(quote.totalCents, 3000)
  assert.equal(creditPurchaseQuote("1000", 5000, 1000).packs, 1000)
})

test("blank, fractional, negative, malformed and excessive purchases are rejected", () => {
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "1e2",
    "999999999999999999999",
    "429497"
  ])
    assert.equal(creditPurchaseQuote(value, 5000, 1000), null, value)
  assert.equal(creditPurchaseQuote("1", 0, 1000), null)
  assert.equal(creditPurchaseQuote("1", 5000, -1000), null)
})

test("credit return messages never treat a success URL as payment confirmation", () => {
  assert.match(creditPurchaseMessage("checking"), /Checking/)
  assert.match(creditPurchaseMessage("pending"), /not been confirmed/)
  assert.match(creditPurchaseMessage("none"), /not been confirmed/)
  assert.match(creditPurchaseMessage("expired"), /expired/)
  assert.match(creditPurchaseMessage("failed"), /failed/)
  assert.match(creditPurchaseMessage("confirmed"), /have been added/)
})
