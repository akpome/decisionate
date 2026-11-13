import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(read("../features/alerts/weekly-email-state.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module, exports: module.exports })
const { recipientEmails, deliveryValidation, deliveryChanges, deliveryStatus } = module.exports
const preference = () => ({ enabled: false, cadence: "weekly", delivery_day: "monday", recipient_emails: ["owner@example.com"],
  metric_focus: ["1:revenue"], metric_targets: { "1:revenue": 100 }, relationship_focus: [2], weekly_settings_configured: true,
  include_recommendations: true, subject_prefix: "Team" })

test("recipients normalize only at validation/save and support newlines, commas and duplicates", () => {
  assert.equal(JSON.stringify(recipientEmails(" Owner@Example.com,\nowner@example.com; next@example.com \n")), JSON.stringify(["owner@example.com", "next@example.com"]))
  assert.equal(deliveryValidation(preference(), "bad-address"), "Enter a complete email address for each recipient.")
  assert.equal(deliveryValidation(preference(), "one@example.com, two@example.com\n"), "")
})

test("new schedules require saved content and recipients while pausing and existing legacy schedules still work", () => {
  const empty = { ...preference(), weekly_settings_configured: false, metric_focus: [], relationship_focus: [], enabled: true }
  assert.match(deliveryValidation(empty, ""), /recipient/)
  assert.match(deliveryValidation(empty, "owner@example.com"), /Preview and save/)
  assert.equal(deliveryValidation({ ...empty, enabled: false }, ""), "")
  assert.equal(deliveryValidation({ ...empty, metric_focus: ["1:sales"] }, "owner@example.com"), "")
  assert.equal(deliveryValidation({ ...empty, relationship_focus: [1] }, "owner@example.com"), "")
  assert.equal(deliveryValidation({ ...empty, weekly_settings_configured: true }, "owner@example.com"), "")
})

test("dirty state covers all editable delivery values, without changing analysis selections", () => {
  const saved = preference(), before = JSON.stringify(saved)
  assert.equal(deliveryChanges(saved, saved, " Owner@example.com\n"), false)
  assert.equal(deliveryChanges(saved, saved, "client@example.com"), true)
  for (const patch of [{ enabled: true }, { delivery_day: "sunday" }, { subject_prefix: "Client" }, { include_recommendations: false }, { metric_targets: {} }]) {
    assert.equal(deliveryChanges(saved, { ...saved, ...patch }, "owner@example.com"), true)
  }
  assert.equal(JSON.stringify(saved), before)
})

test("delivery history distinguishes real reports, tests and failures without inventing success", () => {
  assert.equal(deliveryStatus("sent"), "Report sent")
  assert.equal(deliveryStatus("test_sent"), "Test email sent")
  assert.equal(deliveryStatus("test_failed"), "Test email failed")
  assert.equal(deliveryStatus("failed"), "Report failed")
  assert.equal(deliveryStatus("skipped"), "Not sent")
  assert.equal(deliveryStatus("unknown"), "Status unavailable")
})

test("email settings do not run analysis, reconcile away saved metrics or silently send/save edits", () => {
  const source = read("../features/alerts/weekly-email-settings.tsx")
  assert.doesNotMatch(source, /getWeeklyReportDigest|weekly-jobs|reconcileMetricFocus|removeDigestMetric|ReportAnomalies/)
  assert.match(source, /updateWeeklyReportPreference\(\{ \.\.\.draft, recipient_emails: recipientEmails\(recipients\) \}/)
  assert.match(source, /config\?\.email_delivery_configured && !dirty && !busy/)
  assert.match(source, /if \(!canTest \|\| action.current\) return/)
  assert.match(source, /setRecipients\(event.target.value\)/)
  assert.match(source, /without report results/)
  assert.match(source, /getWeeklyReportDeliveryHistory\(userId, workspaceId\)/)
  assert.match(source, /id="delivery-history"/)
  assert.match(source, /setTimeout\(\(\) => setNotice\(""\), 5000\)/)
  const page = read("../app/dashboard/alerts/page.tsx")
  assert.match(page, /!canManageAlerts \?/)
  assert.match(page, /key=\{`\$\{user.id\}:\$\{activeWorkspaceId\}:\$\{workspaceVersion\}`\}/)
})

test("report save/send controls belong to preview while scheduled email has its own destination", () => {
  const source = read("../features/reports/report-workspace.tsx")
  assert.match(source, /report && view === "report" && <>/)
  assert.match(source, /view === "explore" && <button[^\n]+Refresh available datasets/)
  assert.match(source, /Email workspace owner/)
  assert.match(source, /href="\/dashboard\/alerts#weekly-delivery"[^\n]+Scheduled email/)
  assert.match(source, /href="\/dashboard\/alerts#delivery-history"/)
})
