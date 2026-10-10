import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

function load(relativePath, overrides = {}) {
  const path = new URL(relativePath, import.meta.url)
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, {
    module: loaded,
    exports: loaded.exports,
    require: name => {
      if (Object.hasOwn(overrides, name)) return overrides[name]
      assert.ok(!name.startsWith("@/") && !name.startsWith("next") && !name.startsWith("@clerk/"), `Unexpected recovery dependency: ${name}`)
      return require(name)
    },
    ...overrides.globals,
  })
  return loaded.exports
}

const recoveryPath = "../components/app-error-recovery.tsx"
const { AppErrorRecovery } = load(recoveryPath)
const overrides = { "@/components/app-error-recovery": { AppErrorRecovery } }
const { default: PageError } = load("../app/error.tsx", overrides)
const { default: GlobalError } = load("../app/global-error.tsx", overrides)
const render = (component, error) => renderToStaticMarkup(React.createElement(component, { error }))

test("page and root recovery render without authentication, theme, language, or router providers", () => {
  for (const component of [PageError, GlobalError]) {
    const html = render(component, new TypeError("Sensitive diagnostic details"))
    assert.match(html, /role="alert"/)
    assert.match(html, /This page could not load/)
    assert.match(html, /Reload page/)
    assert.match(html, /href="\/"/)
    assert.doesNotMatch(html, /Sensitive diagnostic details|TypeError|Reference:|screenshot/)
  }
})

test("global recovery supplies a standalone document, viewport, and inline styling", () => {
  const html = render(GlobalError, new Error("Startup failure"))
  assert.match(html, /<html lang="en"/)
  assert.match(html, /<body style="margin:0"/)
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/)
  assert.match(html, /min-height:100vh/)
  assert.match(html, /min-width:0/)
  assert.match(html, /flex-wrap:wrap/)
  assert.match(html, /min-height:44px/)
  assert.doesNotMatch(html, /stylesheet/)
})

test("error references show the server digest without exposing the underlying message", () => {
  const error = Object.assign(new Error("token=private-value"), { digest: "test-reference" })
  const html = render(PageError, error)
  assert.match(html, /Reference: <code>test-reference<\/code>/)
  assert.doesNotMatch(html, /private-value/)
})

test("reload uses native navigation when the application router is unavailable", () => {
  let reloadCount = 0
  const { AppErrorRecovery: Recovery } = load(recoveryPath, {
    react: { ...React, useEffect: () => {} },
    globals: { window: { location: { reload: () => { reloadCount += 1 } } } },
  })
  function findButton(element) {
    if (element.type === "button") return element
    for (const child of React.Children.toArray(element.props.children)) {
      if (React.isValidElement(child)) {
        const found = findButton(child)
        if (found) return found
      }
    }
  }
  const button = findButton(Recovery({ error: new Error("Root failure") }))
  assert.ok(button)
  button.props.onClick()
  assert.equal(reloadCount, 1)
})
