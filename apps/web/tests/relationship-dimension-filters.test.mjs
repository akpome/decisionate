import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const defaultModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/relationships/defaults.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: defaultModule, exports: defaultModule.exports })
const { RELATIONSHIP_DEFAULTS, MAXIMUM_RELATIONSHIP_OBSERVATIONS, MINIMUM_RELATIONSHIP_OBSERVATIONS } = defaultModule.exports
const source = readFileSync(new URL("../app/dashboard/relationships/page.tsx", import.meta.url), "utf8")
function declarations(source, names) {
  const tree = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), found = []
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.push(node.getText(tree))
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(found.length, names.length)
  return found.join("\n")
}
function functions(names, globals = {}, input = source) {
  return vm.runInNewContext(ts.transpileModule(`${declarations(input, names)}\n({ ${names.join(", ")} })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: {}, require, ...globals })
}
const plain = value => JSON.parse(JSON.stringify(value))
const selection = { column: "region", values: ["East", null, "", "null"] }
function payloadHarness(extra = {}) {
  const errors = []
  const globals = { incompleteFilter: false, leftDatasetId: "1", rightDatasetId: "2", resolvedLeftDateColumn: "date",
    resolvedRightDateColumn: "paid_date", resolvedLeftMetric: "spend", resolvedRightMetric: "revenue", name: "Filtered monitor",
    period: "monthly", aggregation: "sum", method: "pearson", lagMode: "manual", lagPeriods: "0",
    minimumObservations: "24", maximumLag: "12", lagDirection: "a_leads_b", RELATIONSHIP_DEFAULTS, MAXIMUM_RELATIONSHIP_OBSERVATIONS, MINIMUM_RELATIONSHIP_OBSERVATIONS,
    leftFilter: undefined, rightFilter: undefined, setError: error => errors.push(error), ...extra }
  return { ...functions(["buildPayload"], globals), errors }
}

test("each relationship side submits its exact independent column and value filter", () => {
  const right = { column: "channel", values: ["Web"] }
  const result = plain(payloadHarness({ leftFilter: selection, rightFilter: right }).buildPayload())
  assert.deepEqual(result.left.dimension_filter, selection)
  assert.deepEqual(result.right.dimension_filter, right)
  assert.equal(result.left.dataset_id, 1)
  assert.equal(result.right.dataset_id, 2)
})

test("all-rows relationships preserve their original payload and incomplete selections cannot submit", () => {
  const original = payloadHarness().buildPayload()
  assert.equal(original.left.dimension_filter, undefined)
  assert.equal(original.right.dimension_filter, undefined)
  const pending = payloadHarness({ incompleteFilter: true })
  assert.equal(pending.buildPayload(), null)
  assert.match(pending.errors[0], /unique value/)
})

test("monitor settings submit exact values and invalid observation or lag bounds cannot preview", () => {
  const payload = payloadHarness({ minimumObservations: "48", maximumLag: "3", lagMode: "automatic", lagDirection: "b_leads_a" }).buildPayload()
  assert.equal(payload.minimum_observations, 48)
  assert.equal(payload.maximum_lag, 3)
  assert.equal(payload.lag_direction, "b_leads_a")
  for (const settings of [{ minimumObservations: "23" }, { minimumObservations: "3654" }, { maximumLag: "13" }, { maximumLag: "-1" }, { maximumLag: "2", lagPeriods: "3" }]) {
    const harness = payloadHarness(settings)
    assert.equal(harness.buildPayload(), null)
    assert.equal(harness.errors.length, 1)
  }
  for (const setting of ["period", "aggregation", "method", "lagMode", "lagPeriods", "lagDirection", "minimumObservations", "maximumLag"]) {
    assert.match(source, new RegExp(`useState(?:<[^>]+>)?\\((?:String\\()?RELATIONSHIP_DEFAULTS\\.${setting}`))
  }
  assert.doesNotMatch(source, /Pearson \(default\)|showAdvanced/)
  assert.match(source, /Minimum historical observations/)
  assert.match(source, /Maximum lag/)
})

test("each dataset side renders the shared dropdown control with current workspace and disabled state", () => {
  const controls = []
  const { RelationshipSide } = functions(["RelationshipSide", "SelectField"], {
    useDecisionateText: () => ({ t: value => value }),
    useId: React.useId,
    DatasetDimensionFilter: props => { controls.push(props); return React.createElement("span", null, "Dimension column") },
  })
  const html = renderToStaticMarkup(React.createElement(RelationshipSide, { label: "Dataset A", datasets: [], datasetId: "7",
    dateColumn: "date", metric: "revenue", onDatasetChange() {}, onDateChange() {}, onMetricChange() {}, userId: "owner",
    workspaceId: "workspace", filterContext: "context-7", dimensionFilter: selection, onDimensionFilterChange() {}, disabled: true }))
  assert.match(html, /<fieldset disabled="" aria-label="Dataset A"/)
  assert.match(html, /Dimension column/)
  assert.equal(controls.length, 1)
  assert.equal(controls[0].datasetId, 7)
  assert.equal(controls[0].workspaceId, "workspace")
  assert.equal(controls[0].value, selection)
  assert.equal(controls[0].disabled, true)
})

test("opening a saved monitor restores both filters without overwriting another workspace", () => {
  let filters = { "old-workspace": { column: "region", values: ["Private"] } }, result
  const globals = { RELATIONSHIP_DEFAULTS, filterKey: identity => `owner:workspace:${identity}`, setDimensionFilters: update => { filters = update(filters) },
    setResult: value => { result = value }, setStatusMessage() {}, setError() {} }
  for (const name of ["setLeftDatasetId", "setRightDatasetId", "setLeftDateColumn", "setRightDateColumn", "setLeftMetric", "setRightMetric", "setName", "setPeriod", "setAggregation", "setMethod", "setLagMode", "setLagPeriods", "setLagDirection", "setMinimumObservations", "setMaximumLag"]) globals[name] = () => {}
  const record = { name: "Saved", period: "daily", aggregation: "sum", method: "pearson", lag_periods: 0,
    left: { dataset_id: 1, date_column: "date", metric_column: "spend", dimension_filter: selection },
    right: { dataset_id: 2, date_column: "date", metric_column: "revenue", dimension_filter: { column: "channel", values: ["Web"] } } }
  functions(["openSavedRelationship"], globals).openSavedRelationship(record)
  assert.deepEqual(filters["owner:workspace:1"], selection)
  assert.deepEqual(filters["owner:workspace:2"], record.right.dimension_filter)
  assert.equal(filters["old-workspace"].values[0], "Private")
  assert.equal(result, record)
})

test("late previews cannot replace evidence after the workspace or filter changes", async () => {
  for (const changed of [true, false]) {
    let complete, result
    const currentSetup = { current: "original" }
    const view = functions(["handlePreview"], { user: { id: "owner" }, activeWorkspaceId: "workspace", setupScope: "original", currentSetup,
      buildPayload: () => payloadHarness({ leftFilter: selection }).buildPayload(), setBusy() {}, setError() {}, setStatusMessage() {},
      previewDatasetRelationship: () => new Promise(resolve => { complete = resolve }), setResult: value => { result = value } })
    const pending = view.handlePreview()
    if (changed) currentSetup.current = "new-workspace-or-filter"
    complete({ id: 3 }); await pending
    assert.equal(result?.id, changed ? undefined : 3)
  }
})

test("filter changes clear old evidence and source keys include user, workspace and dataset", () => {
  let result = { id: 1 }, filters = {}
  functions(["changeDimensionFilter"], { filterKey: identity => `scope:${identity}`, setDimensionFilters: update => { filters = update(filters) },
    setResult: value => { result = value }, setStatusMessage() {}, setError() {} }).changeDimensionFilter("7", selection)
  assert.equal(result, null)
  assert.deepEqual(filters["scope:7"], selection)
  assert.match(source, /JSON.stringify\(\[user\?\.id, activeWorkspaceId, workspaceVersion, identity\]\)/)
})

test("preview and save send scope unchanged and reject an API that ignores filters", async () => {
  const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
  const names = ["verifyDatasetRelationshipFilters", "previewDatasetRelationship", "createDatasetRelationship"]
  const payload = plain(payloadHarness({ leftFilter: selection }).buildPayload())
  for (const name of ["previewDatasetRelationship", "createDatasetRelationship"]) {
    const calls = []
    let echo = payload
    const methods = functions(names, { API_URL: "https://example.test", workspaceJsonHeaders: async (user, workspace) => ({ user, workspace }),
      apiFetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => echo } },
      ApiError: class extends Error { constructor(message, status) { super(message); this.status = status } } }, api)
    await methods[name](payload, "owner", "workspace")
    assert.deepEqual(JSON.parse(calls[0].init.body), payload)
    assert.ok(calls[0].url.endsWith("/filtered"))
    assert.equal(calls[0].init.headers.workspace, "workspace")
    echo = { ...payload, left: { ...payload.left, dimension_filter: null } }
    await assert.rejects(methods[name](payload, "owner", "workspace"), error => error.status === 503)
    for (const setting of ["minimum_observations", "maximum_lag", "lag_direction"]) {
      echo = { ...payload }; delete echo[setting]
      await assert.rejects(methods[name](payload, "owner", "workspace"), error => error.status === 503 && /relationship settings/.test(error.message))
    }
  }
})

test("direction selection removes fixed-lag editing and resets stale timing explicitly", () => {
  let mode = "manual", periods = "3", direction = "a_leads_b"
  const view = functions(["changeRelationshipDirection"], { changeAnalysisSetting: update => update(),
    setLagMode: value => { mode = value }, setLagPeriods: value => { periods = value }, setLagDirection: value => { direction = value } })
  view.changeRelationshipDirection("legacy_fixed")
  assert.deepEqual([mode, periods], ["manual", "3"])
  view.changeRelationshipDirection("b_leads_a")
  assert.deepEqual([mode, periods, direction], ["automatic", "0", "b_leads_a"])
  view.changeRelationshipDirection("same_period")
  assert.deepEqual([mode, periods], ["manual", "0"])
  assert.doesNotMatch(source, /Left metric leads by|Advanced manual/)
  assert.match(source, /lagMode === "automatic" && <label[^\n]+Maximum lag/)
  assert.match(source, /Saved fixed lag/)
})

test("saved monitor labels follow the selected leader and do not imply a leader for same-period comparisons", () => {
  const { relationshipPairLabel } = functions(["relationshipPairLabel"])
  const record = { left_dataset_name: "Ads", left: { metric_column: "spend" }, right_dataset_name: "Store", right: { metric_column: "revenue" }, lag_mode: "automatic", lag_periods: 2 }
  assert.equal(relationshipPairLabel(record), "Ads · spend → Store · revenue")
  assert.equal(relationshipPairLabel({ ...record, lag_direction: "b_leads_a" }), "Store · revenue → Ads · spend")
  assert.equal(relationshipPairLabel({ ...record, lag_mode: "manual", lag_periods: 0 }), "Ads · spend / Store · revenue")
  assert.equal(relationshipPairLabel({ ...record, lag_mode: "manual", lag_periods: 3 }), "Ads · spend → Store · revenue")
  assert.match(source, /\{relationshipPairLabel\(relationship\)\}/)
})

test("changing analysis settings invalidates old evidence without changing the saved definition", () => {
  let result = { id: 5 }, method = "pearson"
  functions(["changeAnalysisSetting"], { setResult: value => { result = value }, setStatusMessage() {}, setError() {} })
    .changeAnalysisSetting(() => { method = "spearman" })
  assert.equal(method, "spearman")
  assert.equal(result, null)
  assert.match(source, /minimumObservations, maximumLag\]\)/)
})

const insufficientRelationship = {
  id: 7, name: "Cross-source relationship", status: "insufficient_data",
  left: { dataset_id: 1, date_column: "date", metric_column: "spend" },
  right: { dataset_id: 2, date_column: "date", metric_column: "orders" },
  left_dataset_name: "meta_ads_daily_2025.csv", right_dataset_name: "shopify_daily_2025.csv",
  period: "monthly", aggregation: "sum", method: "pearson", minimum_observations: 24,
  matched_period_count: 12, correlation: null, relationship_strength: "insufficient evidence", direction: "undetermined",
  lag_mode: "automatic", lag_periods: 0, lag_credibility: "insufficient_data", delay_description: "in the same period",
  association_summary: "Insufficient evidence for a reliable association.", evidence: [],
  lag_candidates: [{ lag_periods: 0, matched_period_count: 12, correlation: null, credible: false }],
}

function relationshipResult(overrides = {}) {
  const { RelationshipResult } = functions(["RelationshipResult", "MetricStat", "hasCorrelationScore", "unavailableCorrelationLabel", "formatCorrelation", "formatPeriodUnit", "relationshipTone", "relationshipPairLabel"], {
    useDecisionateText: () => ({ t: value => value }),
    dimensionFilterLabel: value => `${value.column}: ${value.values.join(", ")}`,
  })
  return renderToStaticMarkup(React.createElement(RelationshipResult, { relationship: { ...insufficientRelationship, ...overrides } }))
}

test("unavailable correlation names the missing score and shows the saved observation threshold", () => {
  const html = relationshipResult()
  assert.match(html, /Correlation coefficient/)
  assert.match(html, /More history needed/)
  assert.match(html, /12 of 24 matching periods/)
  assert.doesNotMatch(html, /Not available|Undetermined|undetermined|insufficient_data/)
  assert.match(html, /Lag \(observed\)/)
  assert.match(html, /Not established/)
  assert.doesNotMatch(html, /in the same period|Best observed delay/)
  assert.match(html, /View timing evidence/)
  assert.match(html, /Not calculated/)
})

test("unavailable scores distinguish unusable values, missing sources and unknown legacy thresholds", () => {
  const constant = relationshipResult({ matched_period_count: 24 })
  assert.match(constant, /Correlation unavailable/)
  assert.match(constant, /A score could not be calculated from these values/)
  assert.doesNotMatch(constant, /More history needed/)
  const unavailable = relationshipResult({ status: "unavailable", matched_period_count: 0 })
  assert.match(unavailable, /Analysis unavailable/)
  assert.match(unavailable, /Check the source data and saved filters/)
  assert.doesNotMatch(unavailable, /More history needed|0 of 24/)
  const legacy = relationshipResult({ minimum_observations: undefined })
  assert.match(legacy, /Correlation unavailable/)
  assert.doesNotMatch(legacy, /of 24|of 52|More history needed/)
})

test("valid positive, negative and zero correlation scores remain visible and explicitly labelled", () => {
  for (const correlation of [0.82, -0.82, 0]) {
    const html = relationshipResult({ status: "ready", correlation, matched_period_count: 52,
      relationship_strength: "strong", direction: correlation < 0 ? "negative" : correlation > 0 ? "positive" : "neutral",
      lag_credibility: "credible", lag_periods: 2, delay_description: "approximately 2 months later" })
    assert.match(html, /Correlation coefficient/)
    assert.ok(html.includes(correlation.toFixed(2)))
    assert.match(html, /2 months/)
    assert.doesNotMatch(html, /More history needed|Not established/)
  }
  for (const correlation of [null, undefined, NaN, Infinity]) {
    assert.match(relationshipResult({ status: "ready", correlation }), /More history needed/)
  }
})

test("limited automatic lag stays visible with its warning while manual lag stays explicit", () => {
  const limited = relationshipResult({ status: "ready", correlation: 0.6, lag_credibility: "limited_evidence", lag_periods: 2 })
  assert.match(limited, /0.60/)
  assert.match(limited, /2 months/)
  assert.match(limited, /Tentative lag; the timing evidence is not yet dependable/)
  const manual = relationshipResult({ status: "ready", correlation: 0.6, lag_mode: "manual", lag_periods: 2 })
  assert.match(manual, /Lag \(selected comparison\)/)
  assert.match(manual, /2 months/)
  assert.match(manual, /Selected comparison, not an estimated delay/)
  assert.doesNotMatch(manual, /Best observed delay|View timing evidence/)
})

test("saved results distinguish zero lag from missing evidence and name the metric order", () => {
  const ready = { status: "ready", correlation: 0.8, lag_credibility: "credible" }
  assert.match(relationshipResult(ready), /0 \(same period\)/)
  for (const patch of [{}, { lag_mode: "manual" }, { ...ready, lag_periods: undefined }]) {
    const html = relationshipResult(patch)
    assert.match(html, /Not established/)
    assert.doesNotMatch(html, /0 \(same period\)/)
  }
  for (const [period, unit] of [["daily", "day"], ["weekly", "week"], ["monthly", "month"], ["quarterly", "quarter"]]) {
    const html = relationshipResult({ ...ready, period, lag_periods: 1, lag_direction: "b_leads_a" })
    assert.match(html, new RegExp(`>1 ${unit}<`))
    assert.match(html, /shopify_daily_2025.csv · orders → meta_ads_daily_2025.csv · spend/)
  }
})

test("opening saved evidence adds no delete button and saved-list statuses are readable", () => {
  assert.doesNotMatch(relationshipResult(), /<button|Delete/)
  assert.equal((source.match(/<Trash2\b/g) || []).length, 1)
  assert.match(source, /t\(unavailableCorrelationLabel\(relationship\)\)/)
  const { unavailableCorrelationLabel } = functions(["unavailableCorrelationLabel"])
  assert.equal(unavailableCorrelationLabel(insufficientRelationship), "More history needed")
  assert.equal(unavailableCorrelationLabel({ ...insufficientRelationship, matched_period_count: 30 }), "Correlation unavailable")
  assert.equal(unavailableCorrelationLabel({ ...insufficientRelationship, status: "unavailable" }), "Analysis unavailable")
})

test("the remaining delete action still confirms removal and clears the opened relationship", async () => {
  for (const confirmed of [false, true]) {
    let records = [insufficientRelationship], result = insufficientRelationship, message = ""
    const calls = []
    const { handleDelete } = functions(["handleDelete"], { user: { id: "owner" }, activeWorkspaceId: "workspace", deletingRelationshipId: null,
      window: { confirm: () => confirmed }, t: value => value, result, setDeletingRelationshipId() {}, setError() {},
      setStatusMessage: value => { message = value }, deleteDatasetRelationship: async (...args) => { calls.push(args) },
      setRelationships: update => { records = update(records) }, setResult: value => { result = value } })
    await handleDelete(insufficientRelationship)
    assert.equal(calls.length, confirmed ? 1 : 0)
    assert.equal(records.length, confirmed ? 0 : 1)
    assert.equal(result, confirmed ? null : insufficientRelationship)
    if (confirmed) {
      assert.deepEqual(plain(calls[0]), [7, "owner", "workspace"])
      assert.equal(message, "Relationship removed.")
    }
  }
})
