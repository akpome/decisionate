import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const source = readFileSync(new URL("../features/datasets/components/data-source-panel.tsx", import.meta.url), "utf8")
const module = { exports: {} }
const stubs = {
  "@/features/datasets/components/data-source-connections": { ConnectionSetupGuide: () => null },
  "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, { module, exports: module.exports, require: name => stubs[name] ?? require(name) })
const { DataSourcePanel } = module.exports

const shopify = { type: "shopify", label: "Shopify", category: "commerce", status: "available", connection_type: "oauth" }
const google = { type: "google_ads", label: "Google Ads", category: "analytics", status: "needs_setup", connection_type: "oauth" }
const savedShop = { id: 1, source_type: " Shopify ", display_name: "Store", status: "needs_setup" }

function switches(node) {
  if (!React.isValidElement(node)) return []
  if (node.props.role === "switch") return [node.props]
  return React.Children.toArray(node.props.children).flatMap(switches)
}

function panel(props = {}) {
  const added = [], removed = []
  const result = DataSourcePanel({
    sources: [shopify, google], connections: [],
    onCreateConnection: source => added.push(source),
    onRemoveConnection: connection => removed.push(connection),
    ...props,
  })
  return { switchFor: label => switches(result).find(item => item["aria-label"] === label), html: () => renderToStaticMarkup(result), added, removed }
}

test("turning on an available connector requests one draft and turning off targets only the saved connection", () => {
  const view = panel({ connections: [savedShop] })
  const shop = view.switchFor("Shopify"), ads = view.switchFor("Google Ads")
  assert.equal(shop["aria-checked"], true, "A saved draft is on even if authorization is not complete")
  assert.equal(ads["aria-checked"], false)
  shop.onClick()
  ads.onClick()
  assert.deepEqual(view.removed, [savedShop])
  assert.deepEqual(view.added, [google])
})

test("the switch uses the saved state until a pending mutation succeeds", () => {
  const adding = panel({ creatingSourceType: "shopify" })
  assert.equal(adding.switchFor("Shopify")["aria-checked"], false)
  assert.equal(adding.switchFor("Shopify").disabled, true)
  assert.equal(adding.switchFor("Google Ads").disabled, true)
  assert.match(adding.html(), /Adding\.\.\./)
  const removing = panel({ connections: [savedShop], deletingConnectionId: savedShop.id })
  assert.equal(removing.switchFor("Shopify")["aria-checked"], true)
  assert.equal(removing.switchFor("Shopify").disabled, true)
  assert.match(removing.html(), /Removing\.\.\./)
})

test("saved accounts are never removed in bulk from the provider switch", () => {
  const view = panel({ connections: [savedShop, { ...savedShop, id: 2 }] })
  assert.equal(view.switchFor("Shopify")["aria-checked"], true)
  assert.equal(view.switchFor("Shopify").disabled, true)
  assert.match(view.html(), /href="#saved-connections"[^>]*>Manage connections/)
})

test("planned and upload-only sources have no switch, and a failed catalog read disables mutations", () => {
  const view = panel({ sources: [shopify, { ...google, status: "planned" }, {
    type: "csv", label: "CSV", connection_type: "upload", status: "available",
  }], loadError: true })
  assert.equal(view.switchFor("Shopify").disabled, true)
  assert.equal(view.switchFor("Google Ads"), undefined)
  assert.equal(view.switchFor("CSV"), undefined)
  assert.match(view.html(), /Unavailable/)
})

test("providers remain grouped in a responsive catalog with their own switches", () => {
  const view = panel({ sources: [shopify, { ...shopify, type: "square", label: "Square" }, google] })
  const html = view.html()
  assert.equal((html.match(/grid-cols-\[repeat\(auto-fill,minmax\(min\(100%,15rem\),1fr\)\)\]/g) ?? []).length, 2)
  assert.ok(view.switchFor("Shopify"))
  assert.ok(view.switchFor("Square"))
  assert.ok(view.switchFor("Google Ads"))
})
