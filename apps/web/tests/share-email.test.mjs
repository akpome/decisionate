import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const require = createRequire(import.meta.url), ts = require("typescript")
const modal = read("../features/sharing/share-email-modal.tsx")
const links = read("../features/sharing/shared-links.tsx")
const compiled = ts.transpileModule(modal, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
const compiledModule = { exports: {} }
vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, require: () => ({}) })
const { shareRecipients } = compiledModule.exports

test("sharing recipients support pasted lists, normalization and deduplication", () => {
  assert.equal(JSON.stringify(shareRecipients(" A@Example.com, b@example.com\na@example.com; c@example.com ")), JSON.stringify(["a@example.com", "b@example.com", "c@example.com"]))
  assert.equal(JSON.stringify(shareRecipients(" , \n ; ")), "[]")
})

test("the recipient modal uses a real focus-trapping dialog and shows access and delivery outcomes", () => {
  assert.match(modal, /\.showModal\(\)/)
  assert.match(modal, /opener\?\.focus\(\)/)
  assert.match(modal, /Each recipient gets a separate link/)
  assert.match(modal, /A saved copy of this preview will be shared/)
  assert.match(modal, /if \(busy \|\| linksBusy\) event.preventDefault\(\)/)
  assert.match(modal, /requestKey.current \|\|= crypto.randomUUID\(\)/)
  assert.match(modal, /if \(action.current \|\| result \|\| linksBusy\) return/)
  assert.match(modal, /recipients.length > 10/)
  assert.match(modal, /role="alert"/)
  assert.match(modal, /role="status"/)
  assert.match(modal, /Sending\.\.\./)
  assert.doesNotMatch(modal, /window\.open|mailto:|navigator\.clipboard|setTimeout/)
})

test("dashboard sharing opens the modal before saving a view or sending any email", () => {
  const source = read("../app/dashboard/page.tsx")
  const open = source.slice(source.indexOf("function handleShareDashboard()"), source.indexOf("async function emailDashboard("))
  assert.match(open, /setShareModalTarget\(currentShareTarget\)/)
  assert.doesNotMatch(open, /await|correlationRequest|saveDashboard|joinDatasets/)
  assert.match(source, /ShareEmailModal[\s\S]*kind="dashboard" onSend=\{emailDashboard\}/)
  const sending = source.slice(source.indexOf("async function emailDashboard("), source.indexOf("function handleManageSharing("))
  assert.match(sending, /await saveDashboardViewPreference\(\)/)
  assert.match(sending, /"\/share-emails"/)
  assert.match(sending, /"Idempotency-Key": requestKey/)
  assert.match(sending, /kind: "dashboard"[\s\S]*recipients/)
  assert.match(sending, /setTemporaryShareStatus\(""\)/, "Re-sharing clears stale revoked status")
  assert.doesNotMatch(sending, /share_token|clipboard|shareUrl|buildDashboardShareUrl/)
  assert.equal((source.match(/\{shareEmailModal\}/g) || []).length, 2, "both dashboard render paths include the modal")
})

test("single and multi dataset previews share one modal and preserve explicit snapshot saving", () => {
  const source = read("../features/reports/report-workspace.tsx")
  assert.match(source, /!weekly && !impactPage && canManage && canSave && <button[^\n]+setSharingContext\(shareContext\)/)
  assert.match(source, /kind="report" unsaved=\{!report.report_id\}/)
  const sending = source.slice(source.indexOf("onSend={async (recipients, requestKey)"))
  assert.match(sending, /await saveSnapshot\(\)/)
  assert.match(sending, /"\/share-emails"/)
  assert.match(sending, /report_id: snapshot.report_id, recipients/)
  assert.match(sending, /setMessage\(""\)/, "Re-sharing clears stale revoked status")
  assert.match(source, /Manage shared links/)
  assert.doesNotMatch(source, /revokeReportShare|Previously emailed links will no longer work/)
})

test("the public report view shows saved evidence without workspace links, edits or new analysis requests", () => {
  const page = read("../app/share/report/page.tsx")
  assert.match(page, /\/public\/reports\//)
  assert.match(page, /referrerPolicy: "no-referrer"/)
  assert.match(page, /Read-only saved results/)
  assert.match(page, /ReportRelationshipFindings report=\{report\} \/>/)
  assert.match(page, /MetricTrends report=\{report\}/)
  assert.match(page, /ReportAnomalies analysis=\{report.anomaly_analysis\}/)
  assert.doesNotMatch(page, /ReportDecisions|onDirectionChange|useUser|workspace_id|business-reports\/jobs|href="\/decisions/)
  const metadata = read("../app/share/report/layout.tsx")
  assert.match(metadata, /index: false, follow: false/)
  assert.match(metadata, /referrer: "no-referrer"/)
})

function stopHarness(send, options = {}) {
  const state = { busy: false, items: [{ id: "one" }, { id: "two" }], confirming: "one", error: "", calls: [], loads: 0, message: "" }
  const ast = ts.createSourceFile("shared-links.tsx", links, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SharedLinks")
  const handler = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "stopLink")
  const context = { Error, encodeURIComponent, action: { current: false }, alive: { current: true }, disabled: false,
    userId: "owner", workspaceId: "workspace", callbacks: { current: { onBusyChange: value => { state.busy = value } } },
    correlationRequest: async (...args) => { state.calls.push(args); return send(...args) },
    setStoppingId: value => { state.stoppingId = value }, setError: value => { state.error = value }, setMessage: value => { state.message = value },
    setItems: updater => { state.items = updater(state.items) }, setConfirmId: value => { state.confirming = value },
    load: async () => { state.loads++ }, window: { dispatchEvent: () => {} }, Event: class {}, ...options }
  vm.runInNewContext(ts.transpileModule(handler.getText(ast) + "; globalThis.stopLink=stopLink;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { state, stop: item => context.stopLink(item || { id: "one", recipient: "reader@example.test" }), alive: context.alive }
}

test("stopping requires server confirmation, prevents duplicate requests and preserves active sharing on failure", async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const success = stopHarness(() => gate)
  const first = success.stop()
  await success.stop()
  assert.equal(success.state.calls.length, 1)
  assert.equal(success.state.busy, true)
  assert.equal(success.state.items.length, 2)
  release(); await first
  assert.deepEqual(success.state.items, [{ id: "two" }])
  assert.equal(success.state.calls[0][1], "/share-emails/links/one")
  assert.equal(success.state.calls[0][2].method, "DELETE")
  assert.equal(success.state.busy, false)
  assert.equal(success.state.confirming, "")
  const failed = stopHarness(() => { throw new Error("Please retry") })
  await failed.stop()
  assert.equal(failed.state.items.length, 2)
  assert.equal(failed.state.confirming, "one")
  assert.equal(failed.state.error, "Please retry")
  assert.equal(failed.state.busy, false)
})

test("individual link management replaces bulk stopping in dashboards and both report scopes", () => {
  assert.match(modal, /<SharedLinks/)
  assert.match(links, /Stop this link\? Other links stay active/)
  assert.match(links, /item.legacy/)
  assert.match(links, /Earlier emails may use this same link/)
  assert.doesNotMatch(modal, /onStopSharing|All previously emailed links/)
  const dashboard = read("../app/dashboard/page.tsx")
  assert.match(dashboard, /target=\{\{ kind: "dashboard", dataset_id: selectedDatasetId, dashboard: selectedDashboard \}\}/)
  assert.match(dashboard, /ariaLabel="Manage shared dashboard links"/)
  const disabled = dashboard.slice(dashboard.indexOf("const stopSharingDisabled ="), dashboard.indexOf("const isCustomSelectedDashboard ="))
  assert.doesNotMatch(disabled, /dimensionBlocked|\bloading\b|shareControlsDisabled/)
  assert.match(dashboard, /sequence === sharingStatusRequest.current/)
  const report = read("../features/reports/report-workspace.tsx")
  assert.match(report, /target=\{\{ kind: "report", report_id: report.report_id \|\| undefined \}\}/)
  assert.doesNotMatch(report, /revokeReportShare/)
  const dashboards = read("../app/dashboard/dashboards/page.tsx")
  assert.match(dashboards, /<SharedLinksDialog/)
  assert.doesNotMatch(dashboards, /Stop all sharing|stopAllDatasetSharing|handleStopAllSharing/)
})

test("closing a context while revocation is pending cannot update its replacement list", async () => {
  let finish
  const h = stopHarness(() => new Promise(resolve => { finish = resolve }))
  const running = h.stop()
  h.alive.current = false
  finish(); await running
  assert.equal(h.state.items.length, 2)
  assert.equal(h.state.loads, 0)
})
