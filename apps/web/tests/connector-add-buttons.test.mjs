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
const testModule = { exports: {} }
const stubs = {
  "@/features/datasets/components/data-source-connections": { ConnectionSetupGuide: () => null },
  "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, { module: testModule, exports: testModule.exports, require: name => stubs[name] ?? require(name) })
const { DataSourcePanel } = testModule.exports

const shopify = { type: "shopify", label: "Shopify", category: "commerce", status: "available", connection_type: "oauth" }
const google = { type: "google_ads", label: "Google Ads", category: "analytics", status: "needs_setup", connection_type: "oauth" }
const savedShop = { id: 1, source_type: " Shopify ", display_name: "Store", status: "needs_setup" }

function buttons(node) {
  if (!React.isValidElement(node)) return []
  if (node.type === "button") return [node.props]
  return React.Children.toArray(node.props.children).flatMap(buttons)
}

function textContent(node) {
  if (typeof node === "string") return node
  if (!React.isValidElement(node)) return ""
  return React.Children.toArray(node.props.children).map(textContent).join("")
}

function panel(props = {}) {
  const added = []
  const result = DataSourcePanel({
    sources: [shopify, google], connections: [],
    onCreateConnection: source => added.push(source),
    ...props,
  })
  return { button: name => buttons(result).find(item => React.Children.toArray(item.children).map(textContent).join("") === name), html: () => renderToStaticMarkup(result), added }
}

test("the catalog offers only sources not already saved, even before authorization", () => {
  const view = panel({ connections: [savedShop] })
  const shop = view.button("Add Shopify"), ads = view.button("Add Google Ads")
  assert.equal(shop, undefined)
  assert.doesNotMatch(view.html(), /Shopify|Commerce/)
  assert.equal(ads.type, "button")
  assert.doesNotMatch(view.html(), /role="switch"|aria-checked=/)
  ads.onClick()
  assert.deepEqual(view.added, [google])
})

test("adding names the pending provider and disables concurrent add requests", () => {
  const adding = panel({ creatingSourceType: "shopify" })
  assert.equal(adding.button("Adding... Shopify")["aria-busy"], true)
  assert.equal(adding.button("Adding... Shopify").disabled, true)
  assert.equal(adding.button("Add Google Ads").disabled, true)
  assert.match(adding.html(), /Adding\.\.\./)
  const removing = panel({ connections: [savedShop], deletingConnectionId: savedShop.id })
  assert.equal(removing.button("Add Shopify"), undefined)
  assert.equal(removing.button("Add Google Ads").disabled, true)
})

test("the source returns only after its last saved connection is removed", () => {
  for (const connections of [[savedShop, { ...savedShop, id: 2 }], [savedShop]]) {
    const view = panel({ sources: [shopify], connections })
    assert.equal(view.button("Add Shopify"), undefined)
    assert.match(view.html(), /All available sources have been added/)
  }
  assert.ok(panel({ sources: [shopify], connections: [] }).button("Add Shopify"))
})

test("planned and upload-only sources have no add action, and a failed catalog read disables mutations", () => {
  const view = panel({ sources: [shopify, { ...google, status: "planned" }, {
    type: "csv", label: "CSV", connection_type: "upload", status: "available",
  }], loadError: true })
  assert.equal(view.button("Add Shopify").disabled, true)
  assert.equal(view.button("Add Google Ads"), undefined)
  assert.equal(view.button("Add CSV"), undefined)
  assert.match(view.html(), /Unavailable/)
})

test("providers remain grouped in a responsive catalog with named Add buttons", () => {
  const view = panel({ sources: [shopify, { ...shopify, type: "square", label: "Square" }, google] })
  const html = view.html()
  assert.equal((html.match(/grid-cols-\[repeat\(auto-fill,minmax\(min\(100%,15rem\),1fr\)\)\]/g) ?? []).length, 2)
  assert.ok(view.button("Add Shopify"))
  assert.ok(view.button("Add Square"))
  assert.ok(view.button("Add Google Ads"))
})
