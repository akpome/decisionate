import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const require = createRequire(import.meta.url), ts = require("typescript")
const modal = read("../features/sharing/share-email-modal.tsx")
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
  assert.match(modal, /Anyone with this link can view/)
  assert.match(modal, /A saved copy of this preview will be shared/)
  assert.match(modal, /if \(busy\) event.preventDefault\(\)/)
  assert.match(modal, /requestKey.current \|\|= crypto.randomUUID\(\)/)
  assert.match(modal, /if \(action.current \|\| result\) return/)
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
  const sending = source.slice(source.indexOf("async function emailDashboard("), source.indexOf("async function handleStopSharing("))
  assert.match(sending, /await saveDashboardViewPreference\(\)/)
  assert.match(sending, /"\/share-emails"/)
  assert.match(sending, /"Idempotency-Key": requestKey/)
  assert.match(sending, /kind: "dashboard"[\s\S]*recipients/)
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
  assert.match(source, /Previously emailed links will no longer work/)
  assert.match(source, /method: "DELETE"/)
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
