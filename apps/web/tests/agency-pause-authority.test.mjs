import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
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
  assert.match(shell, /activeWorkspaceRecord\.agency_removed && <Link href="\/dashboard\/settings"/)
  assert.match(shell, /Start a trial or accept an agency invitation in Settings/)
})
