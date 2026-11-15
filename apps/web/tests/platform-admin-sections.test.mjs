import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const source = readFileSync(new URL("../features/platform-admin/sections.ts", import.meta.url), "utf8")
const page = readFileSync(new URL("../app/platform-admin/page.tsx", import.meta.url), "utf8")
const availability = readFileSync(new URL("../features/white-label/availability.tsx", import.meta.url), "utf8")
const mod = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { module: mod, exports: mod.exports })
const { adminSections, visibleAdminSections, sectionNeedsPermission } = mod.exports

test("admin navigation follows granted permissions without exposing operator tools", () => {
  assert.equal(visibleAdminSections(null).length, 0)
  assert.equal(visibleAdminSections({ allowed: false, full_access: true }).length, 0)
  const ids = visibleAdminSections({ allowed: true, full_access: false, permissions: ["alerts", "audit"] }).map(section => section.id)
  assert.equal(JSON.stringify(ids), JSON.stringify(["email", "operations"]))
  assert.equal(visibleAdminSections({ allowed: true, full_access: true, permissions: [] }).length, adminSections.length)
})

test("overview does not load billing, email, customer tables or audits", () => {
  assert.equal(sectionNeedsPermission("overview", "overview"), true)
  for (const permission of ["credit_settings", "email_settings", "workspaces", "users", "audit", "maintenance", "alerts"]) {
    assert.equal(sectionNeedsPermission("overview", permission), false)
  }
  assert.equal(sectionNeedsPermission("email", "email_settings"), true)
  assert.equal(sectionNeedsPermission("email", "alerts"), true)
  assert.equal(sectionNeedsPermission("operations", "maintenance"), true)
  assert.equal(sectionNeedsPermission("operations", "audit"), true)
})

test("inactive admin panels are unmounted, not hidden with CSS", () => {
  assert.doesNotMatch(page, /className=\{canView\(/)
  assert.match(page, /sectionNeedsPermission\(section, permission\)/)
  assert.match(page, /activeSection === "white_label"/)
  assert.match(page, /operatorSetupOpen && <WhiteLabelSetup/)
  assert.match(page, /activeSection === "marketing" && <MarketingAdmin/)
  assert.match(page, /activeSection !== "analytics"/)
  assert.match(page, /loadedSections\.current\.has\(loadKey\)/)
  assert.match(page, /setError\(loadedSections\.current\.get\(loadKey\) \|\| ""\)/)
  assert.match(page, /loadedSections\.current\.set\(loadKey, sectionError\)/)
  assert.match(page, /aria-label="Platform administration"/)
  assert.match(page, /aria-label="Customer management"/)
})

test("changing commercial availability needs confirmation and a revision", () => {
  assert.match(availability, /window\.confirm\(/)
  assert.match(availability, /confirmation: "CHANGE AVAILABILITY"/)
  assert.match(availability, /revision: data\.revision/)
  assert.match(availability, /type="checkbox" role="switch" checked=\{enabled\}/)
  assert.match(availability, /Existing live portals will not be suspended or deleted/)
})

test("unsaved child editors require confirmation and busy editors cannot be left", () => {
  const tree = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration = ""
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "canLeaveEditor") declaration = node.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const changes = []
  let confirms = 0
  let accepted = false
  const context = {
    activeSection: "white_label",
    operatorNavigation: { dirty: true, busy: false },
    marketingNavigation: { dirty: false, busy: false },
    setOperatorNavigation: value => changes.push(value),
    setMarketingNavigation: value => changes.push(value),
    window: { confirm: () => { confirms++; return accepted } },
  }
  vm.createContext(context)
  vm.runInContext(ts.transpileModule(declaration, {}).outputText, context)
  assert.equal(context.canLeaveEditor(), false)
  assert.equal(changes.length, 0)
  accepted = true
  assert.equal(context.canLeaveEditor(), true)
  assert.equal(changes.length, 2)
  context.activeSection = "marketing"
  context.marketingNavigation = { dirty: false, busy: true }
  assert.equal(context.canLeaveEditor(), false)
  assert.equal(confirms, 2)
})
