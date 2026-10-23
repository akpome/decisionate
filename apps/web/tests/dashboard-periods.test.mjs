import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const allowed = ["1m", "1q", "6m", "1y", "2y", "3y"]
function load(code, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, require, ...globals })
  return loaded.exports
}
for (const path of ["../app/dashboard/page.tsx", "../app/share/dashboard/page.tsx"]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function find(predicate) {
    let found
    function visit(node) {
      if (predicate(node)) found = node
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.ok(found)
    return found
  }
  const declaration = name => find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)
  const periods = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "periodFilters")
  const saved = load(`const ${periods.getText(ast)}\n${declaration("isSavedPeriodFilter")}\n${declaration("getSavedPeriodFilter")}\nexport { periodFilters, getSavedPeriodFilter }`)

  test(`${path}: new views and reset states use one year`, () => {
    assert.match(source, /useState<PeriodFilter>\("1y"\)/)
    assert.match(source, /setPeriodFilter\("1y"\)/)
    assert.doesNotMatch(source, /useState<PeriodFilter>\("1m"\)|setPeriodFilter\("1m"\)/)
  })
  test(`${path}: retired or invalid saved periods become one year`, () => {
    assert.deepEqual([...saved.periodFilters], allowed)
    for (const value of [undefined, null, "", "5y", "all", "10y", {}, 1]) {
      assert.equal(saved.getSavedPeriodFilter(value), "1y")
    }
  })
  test(`${path}: valid deliberate saved periods are preserved`, () => {
    for (const value of allowed) assert.equal(saved.getSavedPeriodFilter(value), value)
  })

  const native = find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "select"
    && node.openingElement.attributes.properties.some(attribute => attribute.name?.getText(ast) === "value"
      && attribute.initializer?.expression?.getText(ast) === "periodFilter"))
  const menus = [native]
  if (!path.includes("share")) {
    menus.push(find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "CompactSelect"
      && node.attributes.properties.some(attribute => attribute.name?.getText(ast) === "label" && attribute.initializer?.text === "Period")))
    test("resetting the business dashboard restores one year and the existing chart defaults", () => {
      const values = {}
      const globals = Object.fromEntries(["PeriodFilter", "Aggregation", "AggregationType", "StartDate", "ScaleMode", "ChartType"]
        .map(name => [`set${name}`, value => { values[name] = value }]))
      const { handleResetView } = load(`${declaration("handleResetView")}\nexport { handleResetView }`, globals)
      handleResetView()
      assert.deepEqual(values, { PeriodFilter: "1y", Aggregation: "monthly", AggregationType: "sum", StartDate: "", ScaleMode: "actual", ChartType: "line" })
    })
  }
  menus.forEach((menu, index) => {
    test(`${path}: period menu ${index + 1} offers one month through three years only`, () => {
      const compact = !path.includes("share") ? declaration("CompactSelect") : ""
      const { Menu } = load(`${compact}\nexport function Menu() { return (${menu.getText(ast)}) }`, {
        periodFilter: "1y", setPeriodFilter() {},
      })
      const html = renderToStaticMarkup(React.createElement(Menu))
      assert.deepEqual([...html.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), allowed)
      assert.match(html, /value="1y" selected=""/)
      assert.doesNotMatch(html, /5 years|All data|5Y|>All</)
    })
  })
}
