"use client"

import Link from "next/link"
import { useClerk } from "@clerk/nextjs"
import { useEffect, useRef, useState } from "react"
import { LoaderCircle, Trash2, X } from "lucide-react"
import { deleteOwnedWorkspace, type OrganizationWorkspaceRecord } from "@/lib/api"
import { clearActiveWorkspaceId } from "@/lib/workspace-context"
import { isAgencyManagedWorkspace } from "@/lib/workspace-ownership"

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"

export function WorkspaceDeletion({ userId, workspace, agency = false }: {
  userId: string; workspace: OrganizationWorkspaceRecord; agency?: boolean
}) {
  const { signOut } = useClerk()
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = useRef(false)
  const mounted = useRef(true)
  const [confirming, setConfirming] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!confirming) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => { opener?.focus() }
  }, [confirming])

  async function finishSignOut() {
    try { await signOut({ redirectUrl: "/sign-in" }) }
    catch { if (mounted.current) setError("Your workspace was deleted, but sign-out did not finish. Please sign out again.") }
  }

  async function removeWorkspace() {
    if (pending.current || deleted || confirmation.trim() !== workspace.name) return
    pending.current = true; setBusy(true); setError("")
    try {
      await deleteOwnedWorkspace(confirmation.trim(), userId, workspace.owner_user_id)
      if (!mounted.current) return
      setDeleted(true); setConfirming(false)
      clearActiveWorkspaceId(userId)
      await finishSignOut()
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "The workspace could not be deleted. Please try again.")
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }

  if (workspace.role !== "owner" || workspace.owner_user_id !== userId || isAgencyManagedWorkspace(workspace)) return null

  if (deleted) return <section role="status" className="border-t border-gray-200 py-5">
    <h2 className="text-lg font-semibold">Workspace deleted</h2>
    <p className="mt-2 text-sm text-gray-600">Other workspaces and your sign-in provider account are unchanged.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void finishSignOut()} className={`${button} mt-4 border-gray-300`}>Sign out</button>
  </section>

  return <section id="delete-workspace" aria-labelledby="workspace-deletion-title" className="border-t border-red-200 py-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <h2 id="workspace-deletion-title" className="text-lg font-semibold">Delete workspace</h2>
        <p className="mt-2 break-words text-sm text-gray-600">Permanently delete <strong>{workspace.name}</strong> and its datasets, dashboards, connections, reports and decisions. This cannot be undone.</p>
        <p className="mt-2 text-sm text-gray-600">Any active workspace subscription must be cancelled in <Link href="/billing" className="text-blue-700 underline">Billing</Link> first. If cancellation is scheduled for later, delete after it takes effect.</p>
        {agency && <p className="mt-2 text-sm text-gray-600">Remove or unlink client workspaces from your agency first. Accepted clients keep their workspaces and data.</p>}
      </div>
      <button type="button" onClick={() => { setConfirmation(""); setError(""); setConfirming(true) }} className={`${button} shrink-0 border-red-200 text-red-700 hover:bg-red-50`}><Trash2 size={16} />Delete workspace</button>
    </div>
    {confirming && <dialog ref={dialog} aria-labelledby="confirm-workspace-deletion" aria-describedby="workspace-deletion-warning"
      onCancel={event => { if (busy) event.preventDefault(); else setConfirming(false) }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 text-gray-950 shadow-xl backdrop:bg-black/40">
      <form onSubmit={event => { event.preventDefault(); void removeWorkspace() }}>
        <div className="flex items-start justify-between gap-3"><h2 id="confirm-workspace-deletion" className="text-lg font-semibold">Delete this workspace permanently?</h2>
          <button type="button" title="Close deletion confirmation" aria-label="Close deletion confirmation" disabled={busy} onClick={() => setConfirming(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 disabled:opacity-50"><X size={18} /></button>
        </div>
        <p id="workspace-deletion-warning" className="mt-3 break-words text-sm text-gray-600">All data in <strong>{workspace.name}</strong> will be permanently deleted, and its shared links will stop working. Other workspaces are not deleted.</p>
        <p className="mt-2 text-sm text-gray-600">You will be signed out. Your app account is removed if it has no other workspaces; your sign-in provider account is not deleted.</p>
        <label className="mt-4 block break-words text-sm" htmlFor="owned-workspace-name">Type <strong>{workspace.name}</strong> to confirm</label>
        <input id="owned-workspace-name" autoFocus autoComplete="off" spellCheck={false} value={confirmation} disabled={busy} onChange={event => { setConfirmation(event.target.value); setError("") }} className="mt-2 h-10 w-full min-w-0 rounded-md border border-gray-300 px-3 text-base sm:text-sm" />
        {error && <p role="alert" className="mt-3 break-words text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={`${button} border-gray-300`}>Cancel</button>
          <button type="submit" disabled={busy || confirmation.trim() !== workspace.name} className={`${button} border-red-700 bg-red-700 text-white`}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}{busy ? "Deleting..." : "Permanently delete"}</button>
        </div>
      </form>
    </dialog>}
  </section>
}
