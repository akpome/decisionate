import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {createRequire} from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../app/dashboard/settings/settings-client.tsx", import.meta.url), "utf8")
const tree = ts.createSourceFile("settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function declaration(name) {
  let found
  function visit(node) {if(ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit)}
  visit(tree)
  assert.ok(found)
  return found.getText(tree)
}
const compile = (code, context) => vm.runInNewContext(ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, context)
const pending = {id:7, email:"client@example.test",status:"pending"}
const created = { id: 8, name: "Client Shop", owner_user_id: "agency:client:new", role: "managed_client", invitation_email_status: "sent" }

function creationHarness(send = async () => created, overrides = {}) {
  const requests = []
  const context = {
    Error, console: { error() {} }, canCreateClientWorkspace: true, clientCreationPending: { current: false },
    clientWorkspaceName: " Client Shop ", clientWorkspaceEmail: " CLIENT@EXAMPLE.TEST ", userId: "agency",
    workspaces: [], error: "", notice: "", busy: false,
    setCreatingClientWorkspace: value => { context.busy = value },
    setClientWorkspaceError: value => { context.error = value },
    setClientWorkspaceNotice: value => { context.notice = value },
    setOrganizationWorkspaces: update => { context.workspaces = update(context.workspaces) },
    setSelectedClientWorkspaceId: value => { context.selected = value },
    setClientWorkspaceName: value => { context.clientWorkspaceName = value },
    setClientWorkspaceEmail: value => { context.clientWorkspaceEmail = value },
    createClientWorkspace: async (...args) => { requests.push(args); return send(...args) },
    addOrganizationInvite: () => assert.fail("Creation must not need a second invitation request"),
    sendOrganizationInvite: () => assert.fail("Creation must send the owner invitation automatically"),
    getSettingsErrorMessage: error => error.message,
    ...overrides,
  }
  const create = compile(`${declaration("cleanPendingClientInviteEmail")}\n${declaration("handleCreateClientWorkspace")}\nhandleCreateClientWorkspace`, context)
  return { context, requests, create }
}

test("one create action supplies the owner email and needs no separate invitation request", async () => {
  const h = creationHarness()
  await h.create()
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests)), [[{ name: "Client Shop", client_email: "client@example.test" }, "agency"]])
  assert.equal(h.context.workspaces[0], created)
  assert.equal(h.context.selected, created.owner_user_id)
  assert.equal(h.context.clientWorkspaceName, "")
  assert.equal(h.context.clientWorkspaceEmail, "")
  assert.match(h.context.notice, /Invitation email sent to client@example.test/)
  assert.equal(h.context.error, "")
  assert.equal(h.context.busy, false)
  assert.equal(h.context.clientCreationPending.current, false)
})

test("a double submission cannot create two client workspaces while the request is pending", async () => {
  let finish
  const h = creationHarness(() => new Promise(resolve => { finish = resolve }))
  const first = h.create()
  await h.create()
  assert.equal(h.requests.length, 1)
  assert.equal(h.context.busy, true)
  finish(created)
  await first
  assert.equal(h.context.workspaces.length, 1)
  assert.equal(h.context.clientCreationPending.current, false)
})

test("an unconfirmed automatic email keeps the created workspace and shows recovery without claiming delivery", async () => {
  for (const invitation_email_status of ["unknown", "failed"]) {
    const h = creationHarness(async () => ({ ...created, invitation_email_status }))
    await h.create()
    assert.equal(h.requests.length, 1)
    assert.equal(h.context.workspaces.length, 1)
    assert.match(h.context.notice, /Client Shop was created/)
    assert.doesNotMatch(h.context.notice, /Invitation email sent/)
    assert.match(h.context.error, /Check the recipient's inbox/)
    assert.equal(h.context.busy, false)
  }
})

test("invalid or unauthorized creation sends nothing, and request errors preserve entered values", async () => {
  for (const overrides of [{ canCreateClientWorkspace: false }, { clientWorkspaceEmail: "invalid" }]) {
    const h = creationHarness(undefined, overrides)
    await h.create()
    assert.equal(h.requests.length, 0)
  }
  const h = creationHarness(async () => { throw new Error("Workspace could not be created") })
  await h.create()
  assert.equal(h.context.workspaces.length, 0)
  assert.equal(h.context.clientWorkspaceName, " Client Shop ")
  assert.equal(h.context.clientWorkspaceEmail, " CLIENT@EXAMPLE.TEST ")
  assert.match(h.context.error, /Workspace could not be created/)
  assert.equal(h.context.clientCreationPending.current, false)
})
function harness(overrides={}) {
  const requests=[]
  const context={
    canManageClientWorkspaces:true,selectedClientWorkspaceOwnerId:"agency:client:one",clientAccessAction:null,userId:"agency",invites:[pending],
    setClientAccessAction:value=>{context.clientAccessAction=value},setClientWorkspaceAccessError:value=>{context.error=value},
    setClientWorkspaceError:value=>{context.createError=value},setClientWorkspaceNotice:value=>{context.notice=value},
    setClientWorkspaceInvites:update=>{context.invites=update(context.invites)},getSettingsErrorMessage:error=>error.message,
    sendOrganizationInvite:async(...args)=>{requests.push(args);return {...pending,email_status:"sent"}},...overrides,
  }
  return {context,requests,send:compile(`${declaration("handleSendClientInvitation")}\nhandleSendClientInvitation`,context)}
}

test("resend targets the selected workspace and reports success only after provider acceptance",async()=>{
  const h=harness();await h.send(pending)
  assert.deepEqual(h.requests,[[7,"agency","agency:client:one"]])
  assert.equal(h.context.invites[0].email_status,"sent")
  assert.match(h.context.notice,/Invitation email sent to client@example.test/)
  assert.equal(h.context.clientAccessAction,null)
})

test("uncertain email outcomes and rate limits keep the invitation and expose useful feedback",async()=>{
  const h=harness({sendOrganizationInvite:async()=>({...pending,email_status:"unknown",email_error:"Check the recipient's inbox before resending."})})
  await h.send(pending)
  assert.match(h.context.error,/Check the recipient/)
  assert.equal(h.context.notice,"")
  const failed=harness({sendOrganizationInvite:async()=>{throw new Error("Please wait a minute before sending this invitation again.")}})
  await failed.send(pending)
  assert.match(failed.context.error,/wait a minute/)
  assert.equal(failed.context.invites[0],pending)
})

test("pending sends cannot be repeated and unauthorized management cannot send",async()=>{
  for(const overrides of [{clientAccessAction:"invite"},{canManageClientWorkspaces:false},{selectedClientWorkspaceOwnerId:""}]) {
    const h=harness(overrides);await h.send(pending);assert.equal(h.requests.length,0)
  }
})

test("client creation distinguishes saved invitations from emails that were sent",()=>{
  const create=declaration("handleCreateClientWorkspace")
  assert.match(create,/invitation_email_status === "sent"/)
  assert.match(create,/invitation_email_status !== "sent"/)
  assert.match(source,/Send client invitation email/)
  assert.match(source,/Invitation pending/)
  assert.match(source,/Create and invite owner/)
  assert.match(source,/Workspace owner email/)
  assert.match(source,/aria-label="Create client workspace and invite owner"/)
  assert.match(source,/"Resend invitation" : "Send invitation"/)
})
