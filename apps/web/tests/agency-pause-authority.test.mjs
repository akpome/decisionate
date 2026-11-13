import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server")
const shell = readFileSync(new URL("../app/dashboard/dashboard-shell.tsx", import.meta.url), "utf8")
const settings = readFileSync(new URL("../app/dashboard/settings/settings-client.tsx", import.meta.url), "utf8")
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")

test("paused clients are directed to their agency without any self-resume command", () => {
  assert.match(shell, /Contact your agency to resume access/)
  assert.doesNotMatch(shell, /resumeOwnedWorkspace|handleResumeWorkspace|canResumeWorkspace|Resume workspace/)
  assert.doesNotMatch(api, /resumeOwnedWorkspace|resume-workspace/)
})

test("agency pause and resume controls are available after client ownership is accepted", () => {
  const tree = ts.createSourceFile("settings.tsx", settings, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let button
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "button" && node.getText(tree).includes("handleToggleClientWorkspaceStatus")) button = node
    ts.forEachChild(node, visit)
  }
  visit(tree); assert.ok(button)
  assert.match(button.getText(tree), /"Resume account" : "Pause account"/)
  assert.doesNotMatch(settings, /!selectedClientWorkspace\.client_owner_accepted && <button/)
  assert.match(settings, /selectedClientWorkspace\.client_owner_accepted \? "Remove from agency"/)
})

test("paused managed clients cannot use independent-trial recovery controls", () => {
  assert.match(shell, /activeWorkspaceRecord\.agency_removed && \["\/dashboard\/settings"/)
  assert.match(shell, /activeWorkspaceRecord\.agency_removed && pathname !== "\/dashboard\/settings" && <Link/)
  assert.match(shell, /!activeWorkspaceRecord\.agency_removed && canManageClientOwnership && user\?\.id && <ClientWorkspaceOwnership/)
  assert.match(shell, /\["client", "client_owner", "owner"\]\.includes\(activeWorkspaceRole\)/)
  assert.match(shell, /"Client account unlinked" : "Client account paused"/)
  assert.match(shell, /Your data is preserved\. Contact your agency to resume access\./)
})

function pausedMarkup(overrides = {}) {
  const parsed = ts.createSourceFile("shell.tsx", shell, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let branch
  function visit(node) {
    if (ts.isConditionalExpression(node) && node.condition.getText(parsed).includes("activeWorkspaceRecord?.is_paused")) branch = node.whenTrue
    ts.forEachChild(node, visit)
  }
  visit(parsed); assert.ok(branch)
  const code = ts.transpileModule(`(${branch.getText(parsed)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return renderToStaticMarkup(vm.runInNewContext(code, {
    React, pathname: "/dashboard", user: { id: "client" }, canManageClientOwnership: true,
    activeWorkspaceRecord: { owner_user_id: "agency:client:one", agency_removed: true },
    Link: ({ children, ...props }) => React.createElement("a", props, children),
    ClientWorkspaceOwnership: () => React.createElement("button", null, "Ownership choices"),
    ...overrides,
  }))
}

test("unlinked dashboards show the requested status and only a Settings link", () => {
  for (const pathname of ["/dashboard", "/dashboard/reports", "/dashboard/forecasts"]) {
    const html = pausedMarkup({ pathname })
    assert.match(html, /Client account unlinked/)
    assert.match(html, /Your data is preserved\. Contact your agency to resume access\./)
    assert.match(html, /href="\/dashboard\/settings"/)
    assert.doesNotMatch(html, /Ownership choices|Start free trial|Subscribe directly|Delete workspace/)
  }
})

test("linked paused owners retain unlink controls while other users see only the pause notice", () => {
  const activeWorkspaceRecord = { owner_user_id: "agency:client:one", agency_removed: false }
  assert.match(pausedMarkup({ activeWorkspaceRecord }), /Ownership choices/)
  const html = pausedMarkup({ activeWorkspaceRecord, canManageClientOwnership: false })
  assert.match(html, /Client account paused/)
  assert.doesNotMatch(html, /Ownership choices|Open Settings/)
})
