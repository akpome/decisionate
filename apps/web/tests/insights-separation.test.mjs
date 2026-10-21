import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const translation = { useDecisionateText: () => ({ t: value => value }) }
function load(path, imports = {}, context = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] || require(name), queueMicrotask, ...context })
  return loaded.exports
}
function nodes(tree, predicate) {
  const result = []
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (predicate(node)) result.push(node)
    React.Children.forEach(node.props?.children, visit)
  }
  visit(tree)
  return result
}
const focused = [], changed = []
const { InsightScopeTabs } = load("../features/insights/components/insight-scope-tabs.tsx", {
  "@/app/use-decisionate-language": translation,
}, { document: { getElementById: id => ({ focus: () => focused.push(id) }) } })

test("Insights exposes exactly two named tabs with a single selected and focusable tab", () => {
  for (const scope of ["single", "multi"]) {
    const tree = InsightScopeTabs({ scope, onChange() {} })
    const tabs = nodes(tree, node => node.props?.role === "tab")
    const html = renderToStaticMarkup(tree)
    assert.equal(tabs.length, 2)
    assert.equal(tabs.filter(tab => tab.props["aria-selected"]).length, 1)
    assert.equal(tabs.filter(tab => tab.props.tabIndex === 0).length, 1)
    assert.match(html, /Single dataset insight/)
    assert.match(html, /Multi dataset insight/)
    assert.match(html, /role="tablist" aria-label="Insight scope"/)
    assert.match(html, /min-w-0.*break-words/)
    for (const tab of tabs) {
      assert.equal(tab.props.type, "button")
      assert.equal(tab.props["aria-selected"], tab.props.id === `insight-tab-${scope}`)
      assert.equal(tab.props["aria-controls"], tab.props.id.replace("insight-tab-", "insights-"))
    }
  }
})

test("tabs support mouse selection, arrow keys, Home and End with focus following selection", () => {
  const tree = InsightScopeTabs({ scope: "single", onChange: value => changed.push(value) })
  const tabs = nodes(tree, node => node.props?.role === "tab")
  tabs[1].props.onClick()
  assert.equal(changed.at(-1), "multi")
  for (const [index, key, expected] of [[0, "ArrowRight", "multi"], [1, "ArrowLeft", "single"], [0, "ArrowLeft", "multi"], [1, "ArrowRight", "single"], [1, "Home", "single"], [0, "End", "multi"]]) {
    let prevented = false
    tabs[index].props.onKeyDown({ key, preventDefault: () => { prevented = true } })
    assert.equal(changed.at(-1), expected)
    assert.equal(focused.at(-1), `insight-tab-${expected}`)
    assert.equal(prevented, true)
  }
  const count = changed.length
  tabs[0].props.onKeyDown({ key: "Tab", preventDefault: () => assert.fail("Tab must retain native behavior") })
  assert.equal(changed.length, count)
})

test("single and multi results, controls and errors belong to separate persistent tab panels", () => {
  const source = read("../app/dashboard/insights/page.tsx")
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const panels = []
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => attribute.name?.text === "role" && attribute.initializer?.text === "tabpanel")) panels.push(node.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(panels.length, 2)
  assert.match(panels[0], /id="insights-single" aria-labelledby="insight-tab-single" hidden=\{scope !== "single"\}/)
  assert.match(panels[1], /id="insights-multi" aria-labelledby="insight-tab-multi" hidden=\{scope !== "multi"\}/)
  for (const name of ["DatasetSelector", "MetricSelector", "AnomalyDetectionPanel", "InsightCard", "AIAnalysisPanel", "WorkspaceAccessNotice"]) assert.ok(panels[0].includes(`<${name}`), name)
  assert.doesNotMatch(panels[0], /<MultiMetricAnalysisPanel|<CorrelationInsights/)
  assert.match(panels[1], /<MultiMetricAnalysisPanel/)
  assert.match(panels[1], /<CorrelationInsights/)
  assert.doesNotMatch(panels[1], /<DatasetSelector|<MetricSelector|<AnomalyDetectionPanel|startDate=|periodFilter=|grouping=|defaultAggregation=/)
  assert.match(panels[1], /key=\{`analysis:\$\{user\?\.id\}:\$\{activeWorkspaceId\}`\}/)
  assert.match(panels[1], /key=\{`relationships:\$\{user\?\.id\}:\$\{activeWorkspaceId\}`\}/)
  assert.match(panels[1], /datasetsError=\{datasets\.length === 0 \? pageError : ""\}/)
  assert.match(panels[1], /onRetryDatasets=/)
})

const metadata = [1, 2].map(id => ({ dataset_id: id, file_name: `Source ${id}.csv`, date_columns: ["date"], default_date_column: "date", numeric_columns: ["amount", "quantity"] }))
const selections = [1, 2].map(id => ({ id, datasetId: id, dateColumn: "date", metricColumn: "amount", aggregation: "sum" }))
const result = { start_date: "2026-01-01", end_date: "2026-12-31", period_count: 12, metrics: [], decision_context: "Selected evidence only.", ai_analysis: {} }
function panel(overrides = {}, api = {}, props = {}) {
  const state = ["", "all", "monthly", metadata, selections, result, false, false, "", 0]
  for (const [key, value] of Object.entries(overrides)) state[Number(key)] = value
  let cursor = 0, refCursor = 0
  const refs = [], effects = [], calls = []
  const { MultiMetricAnalysisPanel } = load("../features/insights/components/multi-metric-analysis-panel.tsx", {
    react: { ...React, useState: initial => {
      const index = cursor++
      if (index >= state.length) state[index] = initial
      return [state[index], update => { state[index] = typeof update === "function" ? update(state[index]) : update }]
    }, useRef: initial => refs[refCursor++] ||= { current: initial }, useMemo: calculate => calculate(), useEffect: effect => effects.push(effect) },
    "@/app/use-decisionate-language": translation,
    "@/features/ai/components/analysis-panel": { AIAnalysisPanel: () => null },
    "@/lib/api": { analyzeMultipleDatasetMetrics: async (...args) => { calls.push(args); return result }, getDatasetJoinMetadata: async () => ({ datasets: metadata }), ...api },
  })
  const tree = MultiMetricAnalysisPanel({ datasets: metadata.map(item => ({ id: item.dataset_id })), userId: "owner", workspaceId: "workspace-a", ...props })
  return { tree, state, refs, effects, calls }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const runButton = tree => nodes(tree, node => node.type === "button" && node.props.children?.some?.(child => child === "Analyze selected metrics"))[0]

test("multi dataset date, period and grouping settings invalidate only its own result", () => {
  for (const [label, value, index] of [["Period", "1y", 1], ["Group by", "daily", 2]]) {
    const view = panel()
    const control = nodes(view.tree, node => typeof node.type === "function" && node.props.label === label)[0]
    control.props.onChange(value)
    assert.equal(view.state[index], value)
    assert.equal(view.state[5], null)
    assert.equal(view.state[8], "")
    assert.equal(view.refs[1].current, 1)
  }
  const view = panel()
  nodes(view.tree, node => node.type === "input" && node.props.type === "date")[0].props.onChange({ target: { value: "2026-02-01" } })
  assert.equal(view.state[0], "2026-02-01")
  assert.equal(view.state[5], null)
})

test("multi dataset analysis sends only its selected metrics and independent window", async () => {
  const view = panel({ 0: "2026-02-01", 1: "1q", 2: "weekly", 5: null })
  runButton(view.tree).props.onClick()
  await flush()
  const [payload, user, workspace] = view.calls[0]
  assert.equal(user, "owner")
  assert.equal(workspace, "workspace-a")
  assert.equal(payload.start_date, "2026-02-01")
  assert.equal(payload.period_filter, "1q")
  assert.equal(payload.grouping, "weekly")
  assert.deepEqual(JSON.parse(JSON.stringify(payload.metrics)), selections.map(item => ({ dataset_id: item.datasetId, date_column: "date", metric_column: "amount", aggregation: "sum" })))
  assert.equal(view.state[5], result)
  assert.equal(view.state[7], false)
})

test("same-dataset metrics cannot be presented as multi dataset analysis", async () => {
  const view = panel({ 4: [{ ...selections[0] }, { ...selections[0], id: 2, metricColumn: "quantity" }], 5: null })
  runButton(view.tree).props.onClick()
  await flush()
  assert.equal(view.calls.length, 0)
  assert.match(view.state[8], /at least two datasets/)
})

test("late analysis results cannot overwrite refreshed or workspace-changed evidence", async () => {
  let complete
  const view = panel({ 5: null }, { analyzeMultipleDatasetMetrics: () => new Promise(resolve => { complete = resolve }) })
  runButton(view.tree).props.onClick()
  assert.equal(view.state[7], true)
  view.refs[1].current++
  complete(result)
  await flush()
  assert.equal(view.state[5], null)
})

test("loading, failed dataset lists and retry remain local to the multi tab", () => {
  const waiting = renderToStaticMarkup(panel({ 3: [] }, {}, { datasetsLoading: true }).tree)
  assert.match(waiting, /fieldset disabled/)
  assert.match(waiting, /Loading available metrics/)
  assert.doesNotMatch(waiting, /No dated numeric metrics/)
  let retries = 0
  const failed = panel({ 3: [] }, {}, { datasetsError: "Dataset list temporarily unavailable", onRetryDatasets: () => retries++ })
  const html = renderToStaticMarkup(failed.tree)
  assert.match(html, /role="alert"/)
  assert.match(html, /Dataset list temporarily unavailable/)
  nodes(failed.tree, node => node.type === "button" && node.props.children?.some?.(child => child === "Retry"))[0].props.onClick()
  assert.equal(retries, 1)
})

test("French insight tab labels and scope use the existing language dictionary", () => {
  const { getLandingText } = load("../lib/language.ts", { "./landing-translations": load("../lib/landing-translations.ts") })
  for (const label of ["Insight scope", "Single dataset insight", "Multi dataset insight", "Refresh available metrics"]) assert.notEqual(getLandingText("fr", label), label)
})
