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

function components(workspace, overrides = {}) {
  const modules = new Map()
  const access = {
    activeWorkspace: workspace, activeWorkspaceId: workspace.owner_user_id, workspaceRole: workspace.role,
    isClientWorkspace: ["client", "client_owner", "client_user"].includes(workspace.role) || (workspace.role === "owner" && workspace.is_managed_client),
    canConfigureWorkspace: workspace.role === "owner" && !workspace.is_managed_client,
    loadingWorkspaceAccess: false, ...overrides,
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const loaded = { exports: {} }
    modules.set(file, loaded.exports)
    vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, {
      module: loaded, exports: loaded.exports,
      require: name => {
        if (name === "@/lib/api") return {}
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
  return {
    Settings: load(path.join(web, "app/dashboard/settings/settings-client.tsx")).SettingsClient,
    Ownership: load(path.join(web, "features/settings/client-workspace-ownership.tsx")).ClientWorkspaceOwnership,
  }
}

const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
const settingsMarkup = (workspace, overrides) => render(components(workspace, overrides).Settings, { userId: "client", fullName: "Client Owner", emailAddress: "client@example.test" })
const noFullSettings = /Workspace Name|Logo link or upload|Email preferences|Agency workspace access|Allow agency access|Shared Workspaces|Team Members|Create Workspace|Start free trial|Agency invitations/

test("linked client Settings contain only agency unlinking, including legacy owner roles", () => {
  for (const role of ["client", "client_owner", "owner"]) {
    const html = settingsMarkup({ ...linked, role })
    assert.match(html, />Unlink agency<\/button>/)
    assert.doesNotMatch(html, /Delete workspace/)
    assert.doesNotMatch(html, noFullSettings)
  }
})

test("unlinked owners stay on deletion-only Settings until independent access is active", () => {
  for (const is_paused of [true, undefined]) {
    const html = settingsMarkup({ ...unlinked, is_paused })
    assert.match(html, />Delete workspace<\/button>/)
    assert.doesNotMatch(html, /Unlink agency<\/button>|Subscribe directly/)
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

test("loading access never flashes client settings or configuration forms", () => {
  const html = settingsMarkup(unlinked, { loadingWorkspaceAccess: true })
  assert.match(html, /Checking workspace access/)
  assert.doesNotMatch(html, /Delete workspace|Unlink agency<\/button>/)
  assert.doesNotMatch(html, noFullSettings)
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
    setBillingStatus: () => {}, setLoadingOrganization: () => {},
    getMyOrganization: () => calls.push("organization"), getOrganizationMembers: () => calls.push("members"),
    getOrganizationInvites: () => calls.push("invites"), getBillingStatus: () => calls.push("billing"),
  })
  await load()
  assert.deepEqual(calls, [])
})
