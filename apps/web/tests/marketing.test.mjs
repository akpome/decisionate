import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")

function harness({ unavailable = false, failRequest = false } = {}) {
  const values = new Map(), calls = []
  const { outputText } = ts.transpileModule(read("../features/auth/lib/marketing-consent.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports, Date, JSON,
    sessionStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (unavailable) throw Error("Storage denied"); values.set(key, value) }, removeItem: key => values.delete(key) },
    require: () => ({ marketingRequest: async (...args) => { calls.push(args); if (failRequest) throw Error("Offline") } }),
  })
  return { ...loaded.exports, calls, values }
}

test("signup marketing checkbox is optional, unchecked and separate from legal consent", () => {
  const ui = read("../features/marketing/email-preferences.tsx")
  const auth = read("../app/clerk-auth-card.tsx")
  assert.match(ui, /const \[checked, setChecked\] = useState\(false\)/)
  assert.match(auth, /const canContinue = termsAccepted && privacyAccepted/)
  assert.match(auth, /<SignupMarketingOptIn \/>/)
  assert.match(ui, /if \(!config\?\.available\) return null/)
  assert.match(ui, /config\.sender_identity/)
  assert.match(ui, /config\.mailing_address/)
})

test("declined consent never becomes an authenticated subscription", async () => {
  const state = harness()
  state.storeMarketingChoice(false, "v1")
  await state.completeSignupMarketing("new-user", Date.now())
  assert.equal(state.calls.length, 0)
  assert.equal(state.values.size, 0)
})

test("express signup choice preserves consent version and language", async () => {
  const state = harness()
  state.storeMarketingChoice(true, "v1-fr", "fr")
  await state.completeSignupMarketing("new-user", Date.now())
  assert.equal(state.calls.length, 1)
  const [user, path, request] = state.calls[0]
  assert.equal(user, "new-user")
  assert.equal(path, "/preferences")
  assert.deepEqual(JSON.parse(request.body), { subscribed: true, consent_version: "v1-fr", language: "fr", source: "signup" })
})

test("an old account signing in through signup cannot inherit a pending choice", async () => {
  const state = harness()
  state.storeMarketingChoice(true, "v1")
  await state.completeSignupMarketing("existing-user", Date.now() - 86400000)
  assert.equal(state.calls.length, 0)
})

test("restricted browser storage and failed preference writes do not block signup", async () => {
  const denied = harness({ unavailable: true })
  assert.doesNotThrow(() => denied.storeMarketingChoice(true, "v1"))
  const offline = harness({ failRequest: true })
  offline.storeMarketingChoice(true, "v1")
  await assert.doesNotReject(() => offline.completeSignupMarketing("new-user", Date.now()))
  assert.equal(offline.values.size, 1)
})

test("preferences are available to client users; global contacts remain full-admin-only", () => {
  const settings = read("../app/dashboard/settings/settings-client.tsx")
  assert.match(settings, /if \(!canConfigureWorkspace\)[\s\S]*?<EmailPreferences userId=\{userId\} \/>/)
  assert.match(read("../app/platform-admin/page.tsx"), /adminAccess\.full_access && <MarketingAdmin/)
  assert.doesNotMatch(read("../features/marketing/marketing-admin.tsx"), /force.?subscribe/i)
})

test("email links can select only an authorized workspace", () => {
  const shell = read("../app/dashboard/dashboard-shell.tsx")
  assert.match(shell, /selectableWorkspaces\.find\(workspace => workspace\.owner_user_id === requestedWorkspaceId\)/)
  assert.match(shell, /const nextWorkspaceId = linkedWorkspaceId \?\?/)
})

test("internal delivery test controls use server eligibility and respect sending gates", () => {
  const admin = read("../features/marketing/marketing-admin.tsx")
  assert.match(admin, /Queue internal delivery test/)
  assert.doesNotMatch(admin, /Queue internal test welcome/)
  assert.match(admin, /disabled=\{busy \|\| !contact\.test_eligible \|\| !data\.configuration\.enabled \|\| !data\.configuration\.sending\}/)
})

test("contact sync status distinguishes a pending revision from a completed sync", () => {
  const admin = read("../features/marketing/marketing-admin.tsx")
  const api = read("../lib/api.ts")
  assert.match(admin, /!contact\.last_successful_sync_at \? "Pending" : contact\.synced_revision < contact\.revision \? "Updating" : "Synced"/)
  assert.match(api, /synced_revision: number/)
  assert.match(api, /revision: number/)
})

test("meaningful activity excludes background syncing and hidden views", () => {
  const tracker = read("../features/marketing/activity-tracker.tsx")
  assert.match(tracker, /document\.visibilityState === "visible"/)
  assert.match(tracker, /dashboards\|insights\|decisions/)
  assert.doesNotMatch(tracker, /setInterval|connections|sync-due|email\.opened/)
})
