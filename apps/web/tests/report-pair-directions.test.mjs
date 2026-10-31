import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function load(relative, imports = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] || require(name) })
  return loaded.exports
}
const pairs = load("../features/reports/pair-directions.ts")
const defaults = load("../features/relationships/defaults.ts")
const { reportExcludedPairs, reportPairDirections, reportPairKey, reportTestCount, unorderedReportPairKey } = pairs
const { editableDefinition } = load("../features/reports/types.ts", { "./pair-directions": pairs, "@/features/relationships/defaults": defaults })
const key = (dataset_id, metric_key) => ({ dataset_id, metric_key })
const metrics = [key(1, "spend"), key(2, "revenue"), key(4, "clicks")].map(item => ({ ...item, date_column: "date", aggregation: "sum" }))
const lag = { enabled: true, minimum: 0, maximum: 3, direction: "a_leads_b" }
const json = value => JSON.parse(JSON.stringify(value))

test("new report pairs default to a single same-period test regardless of selection order", () => {
  const first = reportPairDirections(metrics, [])
  const reverse = reportPairDirections([...metrics].reverse(), [])
  assert.deepEqual(json(first), json(reverse))
  assert.equal(first.length, 3)
  assert.ok(first.every(pair => pair.direction === "same_period"))
  assert.equal(reportTestCount(metrics, first, lag), 3)
})

test("a middle metric can independently follow both neighbours", () => {
  const configured = reportPairDirections(metrics, []).map(pair => ({ ...pair, direction: pair.metric_a.dataset_id === 2 ? "b_leads_a" : "a_leads_b" }))
  const retained = reportPairDirections([...metrics].reverse(), configured)
  assert.deepEqual(json(retained), json(configured))
  assert.equal(retained.find(pair => pair.metric_a.dataset_id === 2).direction, "b_leads_a")
})

test("reversed endpoints preserve which actual metric leads", () => {
  const configured = [{ metric_a: key(4, "clicks"), metric_b: key(2, "revenue"), direction: "a_leads_b" }]
  assert.equal(reportPairDirections(metrics, configured).find(pair => pair.metric_a.dataset_id === 2).direction, "b_leads_a")
})

test("removing metrics prunes stale pairs while keeping retained choices and defaults for new pairs", () => {
  const configured = reportPairDirections(metrics, []).map(pair => ({ ...pair, direction: "a_leads_b" }))
  const pruned = reportPairDirections(metrics.slice(0, 2), configured)
  assert.equal(pruned.length, 1)
  assert.equal(pruned[0].direction, "a_leads_b")
  const expanded = reportPairDirections(metrics, pruned)
  assert.equal(expanded[0].direction, "a_leads_b")
  assert.equal(expanded.filter(pair => pair.direction === "same_period").length, 2)
})

test("legacy report direction is translated without changing its original selection-order meaning", () => {
  const definition = editableDefinition({ metrics: [...metrics].reverse(), lag })
  assert.ok(definition.pair_directions.every(pair => pair.direction === "b_leads_a"))
  assert.equal(reportTestCount(definition.metrics, definition.pair_directions, lag), 12)
  assert.equal(reportTestCount(metrics, null, lag), 12)
  assert.ok(editableDefinition({ metrics, pair_directions: [] }).pair_directions.every(pair => pair.direction === "same_period"))
})

test("new previews always request interpretation and multi-dataset timing without changing saved snapshots", () => {
  const current = editableDefinition({ metrics })
  assert.equal(current.include_ai_analysis, true)
  assert.equal(current.lag.enabled, true)
  assert.equal(current.lag.maximum, 12)
  assert.equal(reportTestCount(metrics, current.pair_directions, current.lag), 3)
  const legacy = { metrics, include_ai_analysis: false, lag: { ...lag, enabled: false }, pair_directions: [{ metric_a: metrics[0], metric_b: metrics[1], direction: "a_leads_b" }] }
  const original = structuredClone(legacy)
  const edited = editableDefinition(legacy)
  assert.equal(edited.include_ai_analysis, true)
  assert.equal(edited.lag.enabled, true)
  assert.equal(edited.lag.maximum, 3)
  assert.equal(reportTestCount(metrics, edited.pair_directions, edited.lag), 6)
  assert.deepEqual(legacy, original)
  const single = editableDefinition({ ...legacy, scope: "single", metrics: metrics.slice(0, 1) })
  assert.equal(single.include_ai_analysis, true)
  assert.equal(single.lag.enabled, false)
  assert.equal(single.pair_directions.length, 0)
})

test("saved bidirectional settings reopen as same-period without changing explicit leaders or the snapshot", () => {
  const configured = [
    { metric_a: key(4, "clicks"), metric_b: key(2, "revenue"), direction: "both" },
    { metric_a: key(2, "revenue"), metric_b: key(1, "spend"), direction: "b_leads_a" },
  ]
  const original = structuredClone(configured)
  const edited = editableDefinition({ metrics, pair_directions: configured, lag })
  assert.equal(edited.pair_directions.find(pair => pair.metric_a.dataset_id === 2).direction, "same_period")
  assert.equal(edited.pair_directions[0].direction, "a_leads_b")
  assert.equal(reportTestCount(metrics, configured, lag), 6)
  assert.deepEqual(json(configured), original)
})

test("unique-test estimates agree with the backend for mixed modes and lag bounds", () => {
  const mixed = reportPairDirections(metrics, []).map((pair, index) => ({ ...pair, direction: ["a_leads_b", "same_period", "b_leads_a"][index] }))
  assert.equal(reportTestCount(metrics, mixed, lag), 9)
  assert.equal(reportTestCount(metrics, mixed, { ...lag, enabled: false }), 3)
  assert.equal(reportTestCount(metrics, [], { ...lag, maximum: 0 }), 3)
  assert.equal(reportTestCount(metrics, [], { ...lag, minimum: 2 }), 3)
  assert.equal(reportTestCount(metrics, mixed, { ...lag, minimum: 2 }), 7)
  const large = Array.from({ length: 25 }, (_, index) => ({ ...metrics[0], dataset_id: index + 1 }))
  assert.equal(reportTestCount(large, [], { ...lag, maximum: 12 }), 300)
  const directed = reportPairDirections(large, []).map(pair => ({ ...pair, direction: "a_leads_b" }))
  assert.equal(reportTestCount(large, directed, { ...lag, maximum: 12 }), 3900)
})

test("metrics from the same dataset do not create a pair and structural keys avoid delimiter collisions", () => {
  assert.equal(reportPairDirections([...metrics, { ...metrics[0], metric_key: "orders" }], []).length, 5)
  assert.notEqual(reportPairKey({ metric_a: key(1, "a|2:b"), metric_b: key(3, "c") }), reportPairKey({ metric_a: key(1, "a"), metric_b: key(2, "b|3:c") }))
})

test("excluded pairs reduce actual test estimates without discarding direction choices", () => {
  const configured = reportPairDirections(metrics, []).map(pair => ({ ...pair, direction: "a_leads_b" }))
  const excluded = [{ metric_a: metrics[1], metric_b: metrics[0] }]
  assert.equal(reportTestCount(metrics, configured, lag, excluded), 8)
  assert.equal(reportTestCount(metrics, configured, { ...lag, enabled: false }, excluded), 2)
  assert.equal(reportTestCount(metrics, configured, lag, configured), 0)
  assert.equal(reportTestCount(metrics, configured, lag, []), 12)
  assert.equal(unorderedReportPairKey(excluded[0]), unorderedReportPairKey(configured[0]))
  const reopened = editableDefinition({ metrics, pair_directions: configured, excluded_pairs: excluded, lag })
  assert.equal(reopened.excluded_pairs.length, 1)
  assert.ok(reopened.pair_directions.every(pair => pair.direction === "a_leads_b"))
  assert.deepEqual(json(editableDefinition({ metrics }).excluded_pairs), [])
})

test("excluded pairs prune removed metrics, reject same-source pairs and deduplicate reversed endpoints", () => {
  const configured = reportPairDirections(metrics, [])
  const original = structuredClone(configured)
  const pruned = reportExcludedPairs(metrics.slice(0, 2), [...configured, { metric_a: metrics[1], metric_b: metrics[0] }, { metric_a: metrics[0], metric_b: { ...metrics[0], metric_key: "orders" } }])
  assert.deepEqual(json(pruned), [{ metric_a: key(1, "spend"), metric_b: key(2, "revenue") }])
  assert.deepEqual(json(reportExcludedPairs(metrics.slice(1), pruned)), [])
  assert.deepEqual(json(configured), original)
})

test("pair controls offer same-period by default and two named lead directions only", () => {
  const { ReportPairDirections } = load("../features/reports/report-pair-directions.tsx", {
    "react": { ...React, useState: () => ["", () => {}] }, "./pair-directions": pairs,
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: value => value }) },
  })
  const datasets = metrics.map(metric => ({ dataset_id: metric.dataset_id, dataset_label: `Source ${metric.dataset_id}`, metrics: [{ ...metric, label: metric.metric_key }] }))
  const opened = [], removed = [], restored = []
  const props = { pairs: reportPairDirections(metrics, []), excludedPairs: [], datasets, onChange: (...value) => opened.push(value), onRemove: pair => removed.push(pair), onRestore: pair => restored.push(pair) }
  const html = renderToStaticMarkup(React.createElement(ReportPairDirections, props))
  for (const label of ["Check whether spend comes first", "Check whether revenue comes first", "Check whether clicks comes first", "Source 1", "Source 2", "Source 4", "Same period only"]) assert.ok(html.includes(label))
  assert.doesNotMatch(html, /Earlier selected|Later selected|Test both directions|value="both"/)
  assert.doesNotMatch(html, /overflow-y-|max-h-|tabindex=/)
  assert.doesNotMatch(html, /md:grid-cols/)
  const selects = [], buttons = []
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (node.type === "select") selects.push(node)
    if (node.type === "button") buttons.push(node)
    React.Children.forEach(node.props?.children, visit)
  }
  visit(ReportPairDirections(props))
  assert.equal(selects.length, 3)
  for (const select of selects) {
    assert.equal(select.props.value, "same_period")
    assert.deepEqual(React.Children.toArray(select.props.children).map(option => option.props.value), ["same_period", "a_leads_b", "b_leads_a"])
  }
  selects[2].props.onChange({ target: { value: "b_leads_a" } })
  assert.equal(opened[0][0].metric_a.dataset_id, 2)
  assert.equal(opened[0][1], "b_leads_a")
  assert.equal(buttons.length, 3)
  assert.ok(buttons.every(button => button.props.type === "button" && button.props.title === "Remove relationship pair"))
  buttons[0].props.onClick()
  assert.equal(unorderedReportPairKey(removed[0]), unorderedReportPairKey(props.pairs[0]))
  selects.length = buttons.length = 0
  visit(ReportPairDirections({ ...props, excludedPairs: [props.pairs[0]] }))
  assert.equal(selects.length, 2)
  const restore = buttons.find(button => button.props.title === "Restore relationship pair")
  restore.props.onClick()
  assert.equal(unorderedReportPairKey(restored[0]), unorderedReportPairKey(props.pairs[0]))
  const empty = renderToStaticMarkup(React.createElement(ReportPairDirections, { ...props, excludedPairs: props.pairs }))
  assert.match(empty, /No relationship pairs selected/)
  assert.match(empty, /Removed pairs/)
  assert.doesNotMatch(empty, /<select/)
  const sameLabels = datasets.map(dataset => ({ ...dataset, metrics: dataset.metrics.map(metric => ({ ...metric, label: "Total" })) }))
  const ambiguous = renderToStaticMarkup(React.createElement(ReportPairDirections, { ...props, datasets: sameLabels }))
  assert.match(ambiguous, /Check whether Source 1 \/ Total comes first/)
  assert.match(ambiguous, /Check whether Source 2 \/ Total comes first/)
})

test("report dates stay in a nonshrinking row outside the settings scroll area", () => {
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  const tree = ts.createSourceFile("report-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const elements = []
  function visit(node) {
    if (ts.isJsxElement(node)) elements.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const attribute = (node, name) => node.openingElement.attributes.properties.find(item => item.name?.text === name)?.initializer?.text
  const settings = elements.find(node => node.openingElement.tagName.getText(tree) === "section" && attribute(node, "aria-label") === "Analysis settings")
  assert.ok(settings)
  const children = settings.children.filter(ts.isJsxElement)
  const scroll = children.find(node => attribute(node, "className")?.includes("report-builder-scroll"))
  const dates = elements.find(node => node.getText(tree).startsWith('<div className="grid shrink-0 grid-cols-2 gap-3"><label') && node.getText(tree).includes('type="date"'))
  assert.ok(scroll)
  assert.ok(dates)
  assert.match(attribute(dates, "className"), /\bshrink-0\b/)
  assert.ok(dates.end < scroll.pos)
  assert.equal((dates.getText(tree).match(/type="date"/g) || []).length, 2)
  assert.match(dates.getText(tree), /max=\{definition\.date_range\.end \|\| undefined\}/)
  assert.match(dates.getText(tree), /min=\{definition\.date_range\.start \|\| undefined\}/)
  assert.doesNotMatch(scroll.getText(tree), /type="date"/)
  assert.match(scroll.getText(tree), /Group results by/)
  assert.match(scroll.getText(tree), /Relationship analysis/)
})

test("the builder shows timing above pairs without checkboxes and invalidates results on pair changes", () => {
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(source, /const taskCount = definition\.impact \? 0 : reportTestCount/)
  assert.match(source, /const showPairDirections = definition\.pair_directions\.length > 0/)
  const settings = source.slice(source.indexOf('aria-label="Analysis settings"'), source.indexOf('id="report-report"'))
  assert.match(settings, /showPairDirections && <ReportPairDirections/)
  assert.ok(settings.indexOf("Delay to check") < settings.indexOf("Maximum delay"))
  assert.ok(settings.indexOf("Maximum delay") < settings.indexOf("<ReportPairDirections"))
  assert.ok(settings.indexOf("<ReportPairDirections") < settings.indexOf("{previewButton}"))
  assert.ok(settings.indexOf("{previewButton}") < settings.lastIndexOf("</section>"))
  const relationshipSettings = settings.slice(settings.indexOf('<div role="group"'), settings.indexOf("</div></section>"))
  assert.match(relationshipSettings, /aria-label="Analysis settings" tabIndex=\{0\}/)
  assert.match(relationshipSettings, /className="report-builder-scroll /)
  assert.ok(relationshipSettings.includes("Correlation method"))
  assert.ok(relationshipSettings.includes("<ReportPairDirections"))
  assert.match(relationshipSettings, /<section aria-label="Relationship analysis"/)
  assert.match(relationshipSettings, /<h3[^>]*>\{t\("Relationship analysis"\)\}<\/h3>/)
  assert.match(relationshipSettings, /Minimum matching [^\n]+<input[^>]*min=\{MINIMUM_RELATIONSHIP_OBSERVATIONS\}/)
  assert.match(relationshipSettings, /<section aria-label=\{t\("Delay to check"\)\}/)
  assert.doesNotMatch(source, /Include AI interpretation|checked=\{definition\.lag\.enabled\}|definition\.lag\.enabled &&/)
  assert.doesNotMatch(settings, /<details|<summary|cursor-pointer/)
  assert.equal((settings.match(/report-builder-scroll/g) || []).length, 1)
  assert.doesNotMatch(settings, /overflow-y-|max-h-/)
  assert.equal((source.match(/<ReportPairDirections /g) || []).length, 1)
  assert.equal((source.match(/\{previewButton\}/g) || []).length, 2)
  assert.match(source, /definition\.impact && !weekly \? <ImpactBuilder/)
  assert.match(source, /"filters", "lag", "pair_directions"/)
  assert.match(source, /"pair_directions", "excluded_pairs"/)
  assert.match(source, /definition\.lag, definition\.excluded_pairs\)/)
  assert.match(source, /onRemove=\{pair => edit\(\{ excluded_pairs:/)
  assert.match(source, /onRestore=\{pair => edit\(\{ excluded_pairs:/)
  assert.doesNotMatch(source, /Earlier selected metric leads|Later selected metric leads/)
  const translations = readFileSync(new URL("../lib/language.ts", import.meta.url), "utf8")
  assert.match(translations, /"\{metric\} leads": "\{metric\} précède"/)
  assert.doesNotMatch(translations, /"leads": "précède"/)
})
