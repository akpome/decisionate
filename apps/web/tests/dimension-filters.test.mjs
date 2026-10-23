import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function load(source, globals = {}) {
  const loadedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loadedModule, exports: loadedModule.exports, require: name => {
    if (name === "@/app/use-decisionate-language") return { useDecisionateText: () => ({ t: value => value }) }
    if (name === "@/lib/api") return { getDatasetDimensions: () => { throw new Error("No requests during server render") } }
    return require(name)
  }, ...globals })
  return loadedModule.exports
}
const { DatasetDimensionFilter, dimensionFilterLabel } = load(readFileSync(new URL("../features/datasets/components/dimension-filter.tsx", import.meta.url), "utf8"))
const render = props => renderToStaticMarkup(React.createElement(DatasetDimensionFilter, { datasetId: 7, userId: "owner", onChange() {}, ...props }))

test("dimension control defaults to all rows with no preselected values", () => {
  const html = render({})
  assert.match(html, /Dimension column/)
  assert.match(html, /<label[^>]*>Dimension column<\/label>/)
  assert.match(html, /<option value="" selected="">All rows<\/option>/)
  assert.doesNotMatch(html, /type="checkbox"|Clear dimension filter|Unique values/)
})

test("saved selected values remain visible before options load and distinguish missing from empty", () => {
  const html = render({ value: { column: "channel", values: ["East", null, "", "null"] } })
  assert.doesNotMatch(html, /type="checkbox"|role="checkbox"/)
  assert.equal((html.match(/<select/g) || []).length, 2)
  assert.equal((html.match(/aria-label="Remove value:/g) || []).length, 4)
  for (const value of ["East", "Missing", "Empty string", "null"]) assert.ok(html.includes(value), value)
  assert.match(html, /aria-label="channel selected values"/)
  assert.match(html, /aria-label="Clear dimension filter"/)
  assert.match(html, /Unique values/)
  assert.match(html, /Selected values.*4 \/ 50/)
  assert.match(html, /value="null" disabled="">Missing<\/option>/)
  assert.match(html, /value="&quot;&quot;" disabled="">Empty string<\/option>/)
  assert.match(html, /value="&quot;null&quot;" disabled="">null<\/option>/)
})

test("unique values use a dropdown with a search field instead of a checkbox list", () => {
  const html = render({ value: { column: "region", values: [] } })
  assert.match(html, /<label[^>]*for="[^"]+-values"[^>]*>Unique values<\/label>/)
  assert.match(html, /<select id="[^"]+-values"/)
  assert.match(html, /<option value="" selected="">Select values<\/option>/)
  assert.match(html, /aria-label="Search unique values"/)
  assert.doesNotMatch(html, /type="checkbox"|role="checkbox"|<select[^>]*multiple/)
})

test("dimension, unique values and search share a responsive equal-width control row", () => {
  const html = render({ value: { column: "region", values: ["East"] } })
  assert.match(html, /class="@container /)
  assert.match(html, /@min-\[28rem\]:grid-cols-\[repeat\(3,minmax\(0,1fr\)\)_auto\]/)
  assert.equal((html.match(/col-span-full min-w-0 @min-\[28rem\]:col-span-1/g) || []).length, 2)
  assert.match(html, /<label[^>]*for="[^"]+-search"[^>]*>Search values<\/label>/)
  assert.ok(html.indexOf("Dimension column") < html.indexOf("Unique values"))
  assert.ok(html.indexOf("Unique values") < html.indexOf(">Search values<"))
  assert.match(html, /col-start-2 row-start-1[^\"]*@min-\[28rem\]:col-start-4/)
  const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8")
  assert.match(dashboard, /min-w-0 border-y border-gray-200 py-3 print:hidden/)
  assert.match(dashboard, /value=\{dimensionFilter\} embedded/)
})

test("embedded dimension controls align with adjacent fields without changing standalone spacing", () => {
  const embedded = render({ embedded: true })
  const standalone = render({})
  assert.match(embedded, /class="@container min-w-0 space-y-3 /)
  assert.doesNotMatch(embedded, /mt-4|border-t|pt-3/)
  assert.match(standalone, /mt-4 border-t border-gray-100 pt-3/)
})

test("the value limit disables adding values without disabling removal", () => {
  const values = Array.from({ length: 50 }, (_, index) => `Value ${index}`)
  const html = render({ value: { column: "region", values } })
  assert.match(html, /<select id="[^"]+-values"[^>]*disabled=""/)
  assert.equal((html.match(/aria-label="Remove value:/g) || []).length, 50)
  assert.doesNotMatch(html, /<button[^>]*disabled/)
})

test("report selectors remain visible without eagerly reading every dataset", () => {
  const html = render({ deferLoad: true })
  assert.match(html, /Dimension column/)
  assert.match(html, /All rows/)
  assert.doesNotMatch(html, /Loading dimensions|No filterable columns/)
})

test("unselected dimension shows an explicit empty selection rather than implying all rows", () => {
  const html = render({ value: { column: "region", values: [] } })
  assert.match(html, /No dimension values selected/)
  assert.doesNotMatch(html, /checked=""/)
})

test("dimension and value names are escaped and read-only controls stay disabled", () => {
  const html = render({ disabled: true, value: { column: "<script>", values: ["<img src=x onerror=alert(1)>"] } })
  assert.match(html, /<fieldset disabled=""/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<script>|<img /)
  assert.equal(dimensionFilterLabel({ column: "region", values: ["East", null, ""] }), "region: East, Missing, Empty string")
})

test("dimension metadata requests preserve workspace, literal search, paging and cancellation", async () => {
  const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
  const ast = ts.createSourceFile("api.ts", api, ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getDatasetDimensions")
  const calls = [], controller = new AbortController()
  const { getDatasetDimensions } = load(declaration.getText(ast), {
    URLSearchParams, API_URL: "https://example.test", cleanPositiveIntegerId: value => value,
    workspaceHeaders: async (user, workspace) => ({ user, workspace }),
    apiFetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ columns: [], values: [], next_offset: null }) } },
  })
  await getDatasetDimensions(7, "owner", "workspace", { column: "channel & group", search: "a+b?", offset: 100, signal: controller.signal })
  const query = new URL(calls[0].url).searchParams
  assert.equal(query.get("column"), "channel & group")
  assert.equal(query.get("search"), "a+b?")
  assert.equal(query.get("offset"), "100")
  assert.equal(calls[0].init.signal, controller.signal)
  assert.equal(calls[0].init.headers.workspace, "workspace")
})
