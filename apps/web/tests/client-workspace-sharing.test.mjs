import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const React = require("react"), ts = require("typescript")
const { renderToStaticMarkup } = require("react-dom/server")
const source = readFileSync(new URL("../features/settings/client-workspace-sharing.tsx", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source + "\nexport { groupSharingEntries }", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
})
const props = { userId: "owner", workspaceId: "agency:client:shop" }

function sharing(members, invites) {
  const testModule = { exports: {} }
  let stateIndex = 0
  let access
  vm.runInNewContext(outputText, { module: testModule, exports: testModule.exports, require: name => {
    if (name === "@/lib/api") return {}
    if (name === "react") return { ...React, useState: initial => React.useState(stateIndex++ === 2 ? access : initial) }
    return require(name)
  } })
  const { groupSharingEntries, ClientWorkspaceSharing } = testModule.exports
  const entries = groupSharingEntries(members, invites)
  access = { key: JSON.stringify([props.userId, props.workspaceId, 0]), entries }
  return { entries, html: renderToStaticMarkup(React.createElement(ClientWorkspaceSharing, props)) }
}

const member = { id: 1, clerk_user_id: "team", role: "client_user", email: "team@example.test" }
const invite = { id: 10, email: "team@example.test", role: "client_user", status: "pending", email_status: "sent" }

test("duplicate member and invitation rows for one address render one collaborator entry", () => {
  const { entries, html } = sharing([member, member, { ...member, id: 2, email: " Team@EXAMPLE.test " }],
    [invite, { ...invite, id: 11, email: "TEAM@example.test" }])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].members.length, 2, "Removal must cover both distinct member IDs")
  assert.equal(entries[0].invites.length, 2, "Removal must revoke overlapping pending invitations")
  assert.equal((html.match(/>Share workspace</g) ?? []).length, 1)
  assert.equal((html.match(/team@example\.test/gi) ?? []).length, 1)
  assert.match(html, /Remove access/)
  assert.doesNotMatch(html, /Invite collaborator|Resend invitation|Revoke invitation/)
})

test("a pending email occupies the slot, but accepted invite history and owner rows do not", () => {
  const pending = sharing([], [invite])
  assert.equal(pending.entries.length, 1)
  assert.match(pending.html, /Revoke invitation|Resend invitation/)
  assert.doesNotMatch(pending.html, /Invite collaborator/)
  const empty = sharing([{ ...member, role: "client_owner" }], [{ ...invite, status: "accepted" }, { ...invite, role: "client_owner" }])
  assert.equal(empty.entries.length, 0)
  assert.match(empty.html, /Invite collaborator/)
})

test("different historical recipients remain visible to revoke without offering another invitation", () => {
  const { entries, html } = sharing([member], [{ ...invite, email: "legacy@example.test" }])
  assert.equal(entries.length, 2)
  assert.match(html, /Only one collaborator is allowed/)
  assert.match(html, /team@example\.test/)
  assert.match(html, /legacy@example\.test/)
  assert.match(html, /Remove access/)
  assert.match(html, /Revoke invitation/)
  assert.doesNotMatch(html, /Resend invitation|Invite collaborator/)
})
