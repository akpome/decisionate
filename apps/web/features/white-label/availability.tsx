"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { Pause, Pencil, Play, RefreshCw, History, X } from "lucide-react"
import { hostedSubdomainRequest, whiteLabelAvailabilityRequest } from "@/lib/api"

type Offering = "hosted_subdomain" | "custom_domain"
type HostedPortalRow = { id: string; hostname: string; status: string; revision: number; last_error: string | null; agency_name?: string }
type Availability = {
  hosted_subdomain_enabled: boolean
  custom_domain_enabled: boolean
  revision: number
  hosted_subdomain_blockers: string[]
  custom_domain_blockers: string[]
  custom_domain_portal_count: number
  custom_domain_live_count: number
  custom_domain_portals: { id: string; hostname: string; status: string; owner_workspace_id: string }[]
  hosted_subdomain_portal_count?: number
  hosted_subdomain_active_count?: number
  hosted_subdomain_portals?: HostedPortalRow[]
}
const offerings = [
  { key: "hosted_subdomain", name: "Agency hosted portals", address: "agency.decisionate.app" },
  { key: "custom_domain", name: "Custom-domain white label", address: "analytics.agency.com" },
] as const

export function WhiteLabelAvailabilityPanel({ userId, onCustomDomainChange }: { userId: string; onCustomDomainChange?: (enabled: boolean) => void }) {
  const [data, setData] = useState<Availability | null>(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [events, setEvents] = useState<{ hostname: string; items: { action: string; actor: string; reason: string; created_at: string }[] } | null>(null)
  const [editingPortal, setEditingPortal] = useState<HostedPortalRow | null>(null)
  const [subdomain, setSubdomain] = useState("")
  const [renameReason, setRenameReason] = useState("")
  const [renameError, setRenameError] = useState("")
  const [notice, setNotice] = useState("")
  const addressDialog = useRef<HTMLDialogElement>(null)
  const cleanSubdomain = subdomain.trim().toLowerCase()
  const validSubdomain = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(cleanSubdomain) && !cleanSubdomain.includes("--")
  const newHostname = `${cleanSubdomain}.decisionate.app`
  useEffect(() => {
    const controller = new AbortController()
    void whiteLabelAvailabilityRequest<Availability>(userId, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setData(value); setError("") } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load availability") })
    return () => controller.abort()
  }, [userId, refresh])

  async function change(offering: Offering, enabled: boolean) {
    if (!data || pending) return
    const name = offerings.find(item => item.key === offering)?.name
    if (!window.confirm(`${enabled ? "Open" : "Close"} ${name} for new subscriptions and setup? Existing live portals will not be suspended or deleted.`)) return
    setPending(true); setError("")
    try {
      const next = await whiteLabelAvailabilityRequest<Availability>(userId, {
        method: "PUT", body: JSON.stringify({ offering, enabled, revision: data.revision, confirmation: "CHANGE AVAILABILITY" }),
      })
      setData(next)
      if (offering === "custom_domain") onCustomDomainChange?.(next.custom_domain_enabled)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change availability") }
    finally { setPending(false) }
  }

  async function portalAction(portal: HostedPortalRow, action: "suspend" | "resume" | "events") {
    const reason = action === "events" ? "" : window.prompt(`${action === "suspend" ? "Suspend access to" : "Resume"} ${portal.hostname}? Enter a reason.`)
    if (reason === null || (action !== "events" && !reason.trim())) return
    setPending(true); setError("")
    try {
      if (action === "events") {
        const items = await hostedSubdomainRequest<NonNullable<typeof events>["items"]>(userId, `/${portal.id}/events`, {}, true)
        setEvents({ hostname: portal.hostname, items })
      } else {
        await hostedSubdomainRequest(userId, `/${portal.id}/status`, { method: "POST", body: JSON.stringify({ action, reason, revision: portal.revision, confirmation: "CHANGE PORTAL STATUS" }) }, true)
        setRefresh(value => value + 1)
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update portal") }
    finally { setPending(false) }
  }

  function openAddressEditor(portal: HostedPortalRow) {
    setEditingPortal(portal)
    setSubdomain(portal.hostname.replace(/\.decisionate\.app$/, ""))
    setRenameReason("")
    setRenameError("")
    setNotice("")
    addressDialog.current?.showModal()
  }

  async function changeAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingPortal || pending || !validSubdomain || newHostname === editingPortal.hostname || !renameReason.trim()) return
    setPending(true)
    setRenameError("")
    try {
      const updated = await hostedSubdomainRequest<HostedPortalRow>(userId, `/${encodeURIComponent(editingPortal.id)}/address`, {
        method: "POST",
        body: JSON.stringify({ slug: cleanSubdomain, reason: renameReason.trim(), revision: editingPortal.revision }),
      }, true)
      setData(current => current ? { ...current, hosted_subdomain_portals: current.hosted_subdomain_portals?.map(portal =>
        portal.id === updated.id ? { ...portal, ...updated } : portal) } : current)
      setEvents(null)
      setNotice(`Portal address changed to ${updated.hostname}.`)
      addressDialog.current?.close()
    } catch (failure) {
      setRenameError(failure instanceof Error ? failure.message : "The address could not be changed.")
      setRefresh(value => value + 1)
    } finally { setPending(false) }
  }

  return <section className="mt-6 min-w-0">
    <header className="flex items-center justify-between gap-3 border-b border-gray-200 pb-4">
      <h2 className="text-lg font-semibold">White-label availability</h2>
      <button type="button" title="Refresh white-label availability" aria-label="Refresh white-label availability" disabled={pending}
        onClick={() => setRefresh(value => value + 1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 disabled:opacity-50"><RefreshCw size={16} /></button>
    </header>
    {error && <p role="alert" className="my-4 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="my-4 break-words text-sm text-emerald-700">{notice}</p>}
    {!data && !error && <p role="status" className="py-6 text-sm text-gray-600">Loading availability...</p>}
    {data && <>
      <div className="grid gap-x-8 md:grid-cols-2">
        {offerings.map(offering => {
          const enabled = data[`${offering.key}_enabled`]
          const blockers = data[`${offering.key}_blockers`]
          return <div key={offering.key} className="min-w-0 border-b border-gray-200 py-5">
            <h3 className="font-semibold">{offering.name}</h3>
            <p className="mt-1 break-all text-sm text-gray-500">{offering.address}</p>
            <label className="mt-5 flex items-center gap-3 text-sm">
              <input type="checkbox" role="switch" checked={enabled} disabled={pending || (!enabled && offering.key === "hosted_subdomain" && blockers.length > 0)}
                aria-label={`${offering.name}: accept new customers`}
                onChange={event => void change(offering.key, event.target.checked)} className="h-4 w-4" />
              Accept new customers: <strong>{enabled ? "On" : "Off"}</strong>
            </label>
            <p className={`mt-3 text-sm ${blockers.length ? "text-amber-800" : "text-emerald-700"}`}>
              Technical readiness: {blockers.length ? "Setup required" : "Configured"}
            </p>
            {blockers.length > 0 && <details className="mt-2 text-sm text-gray-600">
              <summary className="cursor-pointer">Requirements ({blockers.length})</summary>
              <ul className="mt-2 list-disc space-y-2 pl-5">{blockers.map(item => <li key={item}>{item}</li>)}</ul>
            </details>}
          </div>
        })}
      </div>
      <h3 className="mt-7 font-semibold">Hosted portals ({data.hosted_subdomain_portal_count || 0})</h3>
      <p className="mt-1 text-sm text-gray-500">{data.hosted_subdomain_active_count || 0} published; included with an active Agency subscription.</p>
      {!data.hosted_subdomain_portals?.length ? <p className="mt-2 text-sm text-gray-500">No hosted portals.</p> : <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm"><thead><tr className="border-b border-gray-200"><th className="py-3 pr-4">Address</th><th className="px-4">Status</th><th className="pl-4">Actions</th></tr></thead>
          <tbody>{data.hosted_subdomain_portals.map(portal => <tr key={portal.id} className="border-b border-gray-200"><td className="py-3 pr-4">
            {portal.hostname}{portal.agency_name && <p className="mt-1 text-xs text-gray-600">{portal.agency_name}</p>}
            {portal.last_error && <p className="mt-1 text-xs text-amber-800">{portal.last_error}</p>}</td><td className="px-4">{portal.status}</td><td className="pl-4"><div className="flex gap-2">
            {portal.status !== "retired" && <button type="button" disabled={pending} title="Edit portal address" aria-label={`Edit address for ${portal.hostname}`}
              className="rounded-md border p-2" onClick={() => openAddressEditor(portal)}><Pencil size={16} aria-hidden="true" /></button>}
            {["active", "suspended"].includes(portal.status) && <button type="button" disabled={pending} aria-label={`${portal.status === "active" ? "Suspend" : "Resume"} ${portal.hostname}`} title={portal.status === "active" ? "Suspend portal" : "Resume portal"} className="rounded-md border p-2" onClick={() => void portalAction(portal, portal.status === "active" ? "suspend" : "resume")}>{portal.status === "active" ? <Pause size={16} /> : <Play size={16} />}</button>}
            <button type="button" disabled={pending} title="View portal history" aria-label={`View ${portal.hostname} history`} className="rounded-md border p-2" onClick={() => void portalAction(portal, "events")}><History size={16} /></button>
          </div></td></tr>)}</tbody></table>
      </div>}
      {events && <details open className="mt-4 text-sm"><summary className="cursor-pointer font-medium">{events.hostname}: history</summary><ul className="mt-3 space-y-2">{events.items.map((item, index) => <li key={index} className="break-words">{new Date(item.created_at).toLocaleString()} / {item.action} / {item.actor}{item.reason && ` / ${item.reason}`}</li>)}</ul></details>}
      {data.custom_domain_enabled && <><h3 className="mt-7 font-semibold">Custom-domain portals ({data.custom_domain_portal_count})</h3>
      <p className="mt-1 text-sm text-gray-500">{data.custom_domain_live_count} live</p>
      {data.custom_domain_portal_count > data.custom_domain_portals.length && <p className="mt-1 text-sm text-gray-500">Showing the 200 most recently created portals.</p>}
      {!data.custom_domain_portals.length ? <p className="mt-2 text-sm text-gray-500">No custom-domain portals.</p> :
        <div className="mt-3 overflow-x-auto" role="region" aria-label="Custom-domain portals" tabIndex={0}>
          <table className="w-full text-left text-sm"><thead><tr className="border-b border-gray-200"><th className="py-3 pr-4">Domain</th><th className="px-4">Status</th><th className="pl-4">Agency workspace</th></tr></thead>
            <tbody>{data.custom_domain_portals.map(portal => <tr key={portal.id} className="border-b border-gray-200"><td className="py-3 pr-4">{portal.hostname}</td><td className="px-4">{portal.status}</td><td className="break-all pl-4 text-xs text-gray-600">{portal.owner_workspace_id}</td></tr>)}</tbody>
          </table>
        </div>}</>}
    </>}
    <dialog ref={addressDialog} aria-labelledby="hosted-address-title" onClose={() => setEditingPortal(null)}
      onCancel={event => { if (pending) event.preventDefault() }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 text-gray-950 shadow-lg backdrop:bg-gray-950/40">
      {editingPortal && <form onSubmit={changeAddress} className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="hosted-address-title" className="text-lg font-semibold">Edit portal address</h2>
            <p className="mt-1 text-sm [overflow-wrap:anywhere]">{editingPortal.hostname}</p>
            {editingPortal.agency_name && <p className="text-xs text-gray-600 [overflow-wrap:anywhere]">{editingPortal.agency_name}</p>}
          </div>
          <button type="button" title="Close" aria-label="Close" disabled={pending} onClick={() => addressDialog.current?.close()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border"><X size={16} aria-hidden="true" /></button>
        </div>
        <p className="text-sm text-gray-600">The agency and its client workspaces will stay unchanged. Published addresses forward to the new address.</p>
        <label className="block space-y-1 text-sm font-medium">
          <span>New subdomain</span>
          <span className="flex min-w-0 items-center gap-2 rounded-md border border-gray-300 bg-white px-3">
            <input value={subdomain} onChange={event => setSubdomain(event.target.value)} autoFocus
              autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={40} required disabled={pending}
              className="h-10 min-w-0 flex-1 bg-transparent" />
            <span aria-hidden="true" className="shrink-0 text-xs text-gray-500">.decisionate.app</span>
          </span>
        </label>
        {subdomain && !validSubdomain && <p className="text-xs text-amber-800">Use 3 to 40 letters, numbers, or single hyphens. Start and end with a letter or number.</p>}
        <label className="block space-y-1 text-sm font-medium">
          <span>Reason for change</span>
          <input value={renameReason} onChange={event => setRenameReason(event.target.value)} maxLength={350} required disabled={pending}
            className="block h-10 w-full rounded-md border border-gray-300 bg-white px-3" />
        </label>
        {renameError && <p role="alert" className="break-words text-sm text-red-700">{renameError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={pending} onClick={() => addressDialog.current?.close()} className="min-h-10 rounded-md border px-3 text-sm">Cancel</button>
          <button type="submit" disabled={pending || !validSubdomain || newHostname === editingPortal.hostname || !renameReason.trim()}
            aria-busy={pending} className="min-h-10 rounded-md bg-blue-700 px-3 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "Changing address..." : "Change address"}
          </button>
        </div>
      </form>}
    </dialog>
  </section>
}
