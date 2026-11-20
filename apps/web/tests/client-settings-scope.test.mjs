import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const web = path.resolve(import.meta.dirname, "..")
const linked = { id: 2, name: "Client Shop", owner_user_id: "agency:client:shop", role: "client_owner", is_managed_client: true, is_paused: false }
const unlinked = { ...linked, role: "owner", is_managed_client: false, agency_removed: true, is_paused: true }

function components(workspace, overrides = {}, settingsState = {}) {
  const modules = new Map()
  let renderedUserId
  const access = {
    activeWorkspace: workspace, activeWorkspaceId: workspace.owner_user_id, workspaceRole: workspace.role,
    isClientWorkspace: ["client", "client_owner", "client_user"].includes(workspace.role) || (workspace.role === "owner" && workspace.is_managed_client),
    canConfigureWorkspace: workspace.role === "owner" && !workspace.is_managed_client,
    loadingWorkspaceAccess: false, workspaceAccessReady: true, ...overrides,
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const loaded = { exports: {} }
    modules.set(file, loaded.exports)
    const source = readFileSync(file, "utf8")
    const stateNames = []
    if (file.endsWith("settings-client.tsx")) {
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsClient")
      for (const statement of component.body.statements) {
        if (!ts.isVariableStatement(statement)) continue
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isArrayBindingPattern(declaration.name) && ts.isCallExpression(declaration.initializer)
            && declaration.initializer.expression.getText(ast) === "useState") stateNames.push(declaration.name.elements[0].name.text)
        }
      }
    }
    const state = { billingStatus: { plan: "professional", billing_model: "direct" }, ...settingsState }
    let stateIndex = 0
    vm.runInNewContext(ts.transpileModule(source, {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, {
      module: loaded, exports: loaded.exports, process: { env: {} },
      require: name => {
        if (name === "react" && stateNames.length) return { ...React, useState: initial => {
          const key = stateNames[stateIndex++]
          if (key === "loadedOrganizationKey" && !Object.hasOwn(state, key)) {
            return [JSON.stringify([renderedUserId, access.activeWorkspaceId, 0]), () => {}]
          }
          return [Object.hasOwn(state, key) ? state[key] : initial, () => {}]
        } }
        if (name === "@/lib/api") return {}
        if (name === "@/features/hosted-subdomains/setup") return { HostedSubdomainSetup: ({ embedded }) => React.createElement("section", { "data-hosted-settings": embedded }, "Hosted portal settings") }
        if (name === "@clerk/nextjs") return { useClerk: () => ({ signOut: async () => {} }) }
        if (name === "@/lib/use-workspace-access") return { useWorkspaceAccess: () => access }
        if (name === "@/app/use-decisionate-language") return { useDecisionateText: () => ({ t: text => text, language: "en" }) }
        if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) }
        if (name.startsWith("@/") || name.startsWith(".")) {
          const base = name.startsWith("@/") ? path.join(web, name.slice(2)) : path.resolve(path.dirname(file), name)
          return load([base, `${base}.tsx`, `${base}.ts`].find(existsSync))
        }
        return require(name)
      },
    })
    return loaded.exports
  }
  const SettingsClient = load(path.join(web, "app/dashboard/settings/settings-client.tsx")).SettingsClient
  return {
    Settings: props => {
      renderedUserId = props.userId
      return React.createElement(SettingsClient, props)
    },
    Ownership: load(path.join(web, "features/settings/client-workspace-ownership.tsx")).ClientWorkspaceOwnership,
  }
}

const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
const settingsMarkup = (workspace, overrides) => render(components(workspace, overrides).Settings, { userId: "client", fullName: "Client Owner", emailAddress: "client@example.test" })
const noFullSettings = /Workspace Name|Logo link or upload|Email preferences|Shared Workspaces|Team Members|Create and invite owner|Start free trial|Agency invitations/

test("active linked client owners can share, delete or unlink without seeing agency settings", () => {
  for (const role of ["client", "client_owner", "owner"]) {
    const html = settingsMarkup({ ...linked, role })
    assert.match(html, />Unlink agency<\/button>/)
    assert.match(html, /Delete workspace/)
    assert.equal((html.match(/>Share workspace</g) ?? []).length, 1)
    assert.match(html, /Allow agency access/)
    assert.doesNotMatch(html, noFullSettings)
  }
})

test("client Settings resets as a unit without giving sharing and ownership the same sibling key", () => {
  const file = path.join(web, "app/dashboard/settings/settings-client.tsx")
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsClient")
  const branch = component.body.statements.find(node => ts.isIfStatement(node) && node.expression.getText(source) === "clientSettingsOnly")
  assert.ok(branch)
  const markup = branch.getText(source)
  assert.match(markup, /<div key=\{activeWorkspace\?\.owner_user_id\}/)
  const sharing = markup.match(/<ClientWorkspaceSharing\b[^>]+>/)?.[0]
  assert.ok(sharing)
  assert.doesNotMatch(sharing, /\bkey=/)
  assert.match(markup, /\{ownershipPanel \?\?/)
})

test("paused linked client Settings still offer only unlinking", () => {
  const html = settingsMarkup({ ...linked, is_paused: true })
  assert.match(html, />Unlink agency<\/button>/)
  assert.doesNotMatch(html, /Delete workspace|Share workspace|Allow agency access/)
  assert.doesNotMatch(html, noFullSettings)
})

test("the agency sees the accepted owner separately from linking a new workspace", () => {
  const agency = { id: 1, name: "Agency", owner_user_id: "agency", role: "owner" }
  const Settings = components(agency, {}, {
    billingStatus: { plan: "agency_subdomain", billing_model: "agency" },
    organizationWorkspaces: [{ ...linked, client_owner_accepted: true, role: "managed_client", client_owner_contact_email: "owner@example.test" }],
  }).Settings
  const html = render(Settings, { userId: "agency", fullName: "Agency Owner", emailAddress: "agency@example.test" })
  assert.match(html, /Manage client workspaces[\s\S]*Client Shop[\s\S]*Workspace owner:<\/strong> owner@example.test[\s\S]*Link an existing workspace/)
  assert.match(html, /Remove from agency/)
  assert.doesNotMatch(html, /Share workspace|Allow agency access/)
})

test("unlinked owners stay on deletion-only Settings until independent access is active", () => {
  for (const is_paused of [true, undefined]) {
    const html = settingsMarkup({ ...unlinked, is_paused })
    assert.match(html, />Delete workspace<\/button>/)
    assert.doesNotMatch(html, /Unlink agency<\/button>|Subscribe directly|Allow agency access/)
    assert.doesNotMatch(html, noFullSettings)
  }
})

test("other client users and visiting agency owners cannot use ownership controls", () => {
  for (const role of ["client_user", "managed_client"]) {
    const html = settingsMarkup({ ...linked, role })
    assert.match(html, /Only the client workspace owner/)
    assert.doesNotMatch(html, /<button|<input|<select/)
    assert.doesNotMatch(html, noFullSettings)
  }
})

test("Agency, Professional and converted Professional owners retain full Settings", () => {
  for (const workspace of [
    { ...linked, role: "owner", owner_user_id: "agency", is_managed_client: false },
    { ...linked, role: "owner", owner_user_id: "professional", is_managed_client: false },
    { ...unlinked, is_paused: false, independent_trial_started: true },
  ]) {
    const html = settingsMarkup(workspace)
    assert.match(html, /Workspace Name/)
    assert.match(html, /Logo link or upload/)
    assert.match(html, /Email preferences/)
  }
})

test("current and legacy Agency owners get inline portal settings instead of workspace branding", () => {
  const workspace = { id: 1, name: "Agency", owner_user_id: "agency", role: "owner", is_managed_client: false }
  for (const plan of ["agency", "agency_subdomain"]) {
    const Settings = components(workspace, {}, { billingStatus: { plan, billing_model: "agency" } }).Settings
    const html = render(Settings, { userId: "agency", fullName: "Agency Owner", emailAddress: "owner@example.test" })
    assert.match(html, /data-hosted-settings="true"/)
    assert.match(html, /Hosted portal settings/)
    assert.doesNotMatch(html, /Workspace Name|Logo link or upload|Report Display Name|Reset Branding|href="\/hosted-portal"/)
    assert.match(html, /Client Workspaces/)
    assert.match(html, /Workspace Members/)
    assert.match(html, /workspace-deletion-title/)
  }
})

test("only Professional owners have the default application's workspace branding controls", () => {
  const workspace = { id: 1, name: "Owner workspace", owner_user_id: "owner", role: "owner", is_managed_client: false }
  for (const plan of ["professional"]) {
    const Settings = components(workspace, {}, { billingStatus: { plan, billing_model: plan === "professional" ? "direct" : "agency" } }).Settings
    const html = render(Settings, { userId: "owner", fullName: "Owner", emailAddress: "owner@example.test" })
    assert.match(html, /Workspace Name/)
    assert.match(html, /Logo link or upload/)
    assert.doesNotMatch(html, /data-hosted-settings/)
  }
})

test("custom-domain, free and unrecognized plans never fall back to workspace branding", () => {
  const workspace = { id: 1, name: "Owner workspace", owner_user_id: "owner", role: "owner", is_managed_client: false }
  for (const plan of ["agency_custom_domain", "free", "", "unknown-plan"]) {
    const Settings = components(workspace, {}, { billingStatus: { plan, billing_model: plan === "agency_custom_domain" ? "agency" : "direct" } }).Settings
    const html = render(Settings, { userId: "owner", fullName: "Owner", emailAddress: "owner@example.test" })
    assert.doesNotMatch(html, /Workspace Name|Logo link or upload|Report Display Name|Reset Branding|data-hosted-settings/)
    assert.match(html, /Workspace Members/)
    assert.match(html, /workspace-deletion-title/)
  }
})

test("non-owner and client roles do not gain branding controls from an eligible plan", () => {
  for (const plan of ["professional", "agency"]) {
    for (const role of ["member", "client_owner", "client_user", "managed_client"]) {
      const workspace = { ...linked, role }
      const Settings = components(workspace, {}, { billingStatus: { plan, billing_model: plan === "agency" ? "agency" : "direct" } }).Settings
      const html = render(Settings, { userId: "client", fullName: "User", emailAddress: "user@example.test" })
      assert.doesNotMatch(html, /Workspace Name|Logo link or upload|Report Display Name|Reset Branding|data-hosted-settings/)
    }
  }
})

test("branding actions are guarded when the plan is not eligible or its settings are reloading", async () => {
  const file = path.join(web, "app/dashboard/settings/settings-client.tsx")
  const source = readFileSync(file, "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsClient")
  for (const name of ["handleSaveOrganization", "handleResetBranding", "handleLogoUpload"]) {
    const action = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    for (const state of [{ canEditWorkspaceBranding: false }, { canEditWorkspaceBranding: true, loadingOrganization: true }]) {
      const run = vm.runInNewContext(ts.transpileModule(`${action.getText(ast)}\n${name}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText, state)
      await run()
    }
  }
})

test("first owner render shows loading until the plan request settles", () => {
  const workspace = { id: 1, name: "Agency", owner_user_id: "agency", role: "owner", is_managed_client: false }
  for (const loading of [true, false]) {
    const Settings = components(workspace, {}, { ...(loading && { loadedOrganizationKey: "" }), billingStatus: null }).Settings
    const html = render(Settings, { userId: "agency", fullName: "Owner", emailAddress: "owner@example.test" })
    assert.doesNotMatch(html, /Workspace Name|Logo link or upload|data-hosted-settings/)
    assert.match(html, loading ? /Loading workspace settings/ : /Unable to check your workspace plan/)
    assert.equal(html.includes("Retry workspace load"), !loading)
    assert.equal(html.includes('role="alert"'), !loading)
  }
})

test("switching workspaces or retrying hides stale alerts and controls before effects run", () => {
  const workspace = { id: 1, name: "Agency", owner_user_id: "agency", role: "owner", is_managed_client: false }
  for (const state of [
    { loadedOrganizationKey: JSON.stringify(["client", "previous-workspace", 0]) },
    { organizationLoadRetryKey: 1 },
  ]) {
    const Settings = components(workspace, {}, {
      organizationLoadError: "Old plan error", saveError: "Old save error", memberError: "Old member error",
      billingStatus: { plan: "agency_subdomain", billing_model: "agency" }, ...state,
    }).Settings
    const html = render(Settings, { userId: "client", fullName: "Owner", emailAddress: "owner@example.test" })
    assert.match(html, /Loading workspace settings/)
    assert.doesNotMatch(html, /Old .* error|role="alert"|Retry workspace load|Hosted portal settings|Client Workspaces|Workspace Members|Delete workspace/)
  }
})

test("primary Professional and Agency owners have a dedicated deletion section, not visiting owners or members", () => {
  for (const owner of ["professional", "agency"]) {
    const workspace = { id: 1, name: "My workspace", owner_user_id: owner, role: "owner", is_managed_client: false }
    const html = render(components(workspace).Settings, { userId: owner, fullName: "Owner", emailAddress: "owner@example.test" })
    assert.match(html, /workspace-deletion-title/)
    assert.match(html, />Delete workspace<\/button>/)
    assert.match(html, /This cannot be undone/)
    assert.doesNotMatch(html, /<dialog/)
    const visiting = render(components(workspace).Settings, { userId: "someone-else", fullName: "Other owner", emailAddress: "other@example.test" })
    assert.doesNotMatch(visiting, /workspace-deletion-title/)
    const member = { ...workspace, role: "member" }
    assert.doesNotMatch(render(components(member).Settings, { userId: owner, fullName: "Member", emailAddress: "member@example.test" }), /workspace-deletion-title/)
  }
})

test("loading access never flashes client settings or configuration forms", () => {
  for (const pending of [{ loadingWorkspaceAccess: true }, { workspaceAccessReady: false, canConfigureWorkspace: false }]) {
    const html = settingsMarkup(unlinked, { ...pending, workspaceAccessError: "Previous access error" })
    assert.match(html, /Checking workspace access/)
    assert.doesNotMatch(html, /Delete workspace|Unlink agency<\/button>|Previous access error|Only the business owner|role="alert"/)
    assert.doesNotMatch(html, noFullSettings)
  }
})

test("settled workspace access failures offer retry instead of an owner-only notice", () => {
  const html = settingsMarkup(unlinked, { canConfigureWorkspace: false, workspaceAccessError: "Unable to check workspace access." })
  assert.match(html, /role="alert".*Unable to check workspace access/)
  assert.match(html, /Retry workspace access/)
  assert.doesNotMatch(html, /Only the business owner|Checking workspace access/)
})

test("trial and agency recovery are separate from ownership settings", () => {
  const { Ownership } = components(unlinked)
  const recovery = render(Ownership, { userId: "client", workspace: unlinked, view: "recovery" })
  assert.match(recovery, /Start free trial/)
  assert.match(recovery, /Agency invitations/)
  assert.doesNotMatch(recovery, /Delete workspace|Unlink agency<\/button>|Subscribe directly/)
  const active = render(Ownership, { userId: "client", workspace: { ...unlinked, is_paused: false }, view: "recovery" })
  assert.doesNotMatch(active, /Start free trial/)
  const billing = readFileSync(path.join(web, "app/dashboard/billing/page.tsx"), "utf8")
  assert.match(billing, /access\.activeWorkspace\?\.agency_removed/)
  assert.match(billing, /workspace=\{access\.activeWorkspace\} view="recovery"/)
})

test("limited Settings do not fetch branding, members or billing administration", async () => {
  const source = readFileSync(path.join(web, "app/dashboard/settings/settings-client.tsx"), "utf8")
  const parsed = ts.createSourceFile("settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let loader
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "loadOrganization") loader = node.getText(parsed)
    ts.forEachChild(node, visit)
  }
  visit(parsed); assert.ok(loader)
  const calls = []
  const load = vm.runInNewContext(ts.transpileModule(`${loader}\nloadOrganization`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    canConfigureWorkspace: false,
    setLoadedOrganizationKey: () => assert.fail("Skipped requests must not mark settings as loaded"),
    getMyOrganization: () => calls.push("organization"), getOrganizationMembers: () => calls.push("members"),
    getOrganizationInvites: () => calls.push("invites"), getBillingStatus: () => calls.push("billing"),
  })
  await load()
  assert.deepEqual(calls, [])
})
