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
  assert.match(source,/Email sent; awaiting sign-in/)
})
