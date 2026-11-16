"use client"

import { useEffect, useState } from "react"
import { Pause, Play, RefreshCw, History } from "lucide-react"
import { hostedSubdomainRequest, whiteLabelAvailabilityRequest } from "@/lib/api"

type Offering = "hosted_subdomain" | "custom_domain"
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
  hosted_subdomain_portals?: { id: string; hostname: string; status: string; revision: number; last_error: string | null }[]
}
const offerings = [
  { key: "hosted_subdomain", name: "Decisionate-hosted white label", address: "agency.decisionate.app" },
  { key: "custom_domain", name: "Custom-domain white label", address: "analytics.agency.com" },
] as const

export function WhiteLabelAvailabilityPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<Availability | null>(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [events, setEvents] = useState<{ hostname: string; items: { action: string; actor: string; reason: string; created_at: string }[] } | null>(null)
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
      setData(await whiteLabelAvailabilityRequest<Availability>(userId, {
        method: "PUT", body: JSON.stringify({ offering, enabled, revision: data.revision, confirmation: "CHANGE AVAILABILITY" }),
      }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change availability") }
    finally { setPending(false) }
  }

  async function portalAction(portal: NonNullable<Availability["hosted_subdomain_portals"]>[number], action: "suspend" | "resume" | "events") {
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

  return <section className="mt-6 min-w-0">
    <header className="flex items-center justify-between gap-3 border-b border-gray-200 pb-4">
      <h2 className="text-lg font-semibold">White-label availability</h2>
      <button type="button" title="Refresh white-label availability" aria-label="Refresh white-label availability" disabled={pending}
        onClick={() => setRefresh(value => value + 1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 disabled:opacity-50"><RefreshCw size={16} /></button>
    </header>
    {error && <p role="alert" className="my-4 text-sm text-red-700">{error}</p>}
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
      <p className="mt-1 text-sm text-gray-500">{data.hosted_subdomain_active_count || 0} published; access also requires an active agency subscription.</p>
      {!data.hosted_subdomain_portals?.length ? <p className="mt-2 text-sm text-gray-500">No hosted portals.</p> : <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm"><thead><tr className="border-b border-gray-200"><th className="py-3 pr-4">Address</th><th className="px-4">Status</th><th className="pl-4">Actions</th></tr></thead>
          <tbody>{data.hosted_subdomain_portals.map(portal => <tr key={portal.id} className="border-b border-gray-200"><td className="py-3 pr-4">{portal.hostname}{portal.last_error && <p className="mt-1 text-xs text-amber-800">{portal.last_error}</p>}</td><td className="px-4">{portal.status}</td><td className="pl-4"><div className="flex gap-2">
            {["active", "suspended"].includes(portal.status) && <button type="button" disabled={pending} aria-label={`${portal.status === "active" ? "Suspend" : "Resume"} ${portal.hostname}`} title={portal.status === "active" ? "Suspend portal" : "Resume portal"} className="rounded-md border p-2" onClick={() => void portalAction(portal, portal.status === "active" ? "suspend" : "resume")}>{portal.status === "active" ? <Pause size={16} /> : <Play size={16} />}</button>}
            <button type="button" disabled={pending} title="View portal history" aria-label={`View ${portal.hostname} history`} className="rounded-md border p-2" onClick={() => void portalAction(portal, "events")}><History size={16} /></button>
          </div></td></tr>)}</tbody></table>
      </div>}
      {events && <details open className="mt-4 text-sm"><summary className="cursor-pointer font-medium">{events.hostname}: history</summary><ul className="mt-3 space-y-2">{events.items.map((item, index) => <li key={index} className="break-words">{new Date(item.created_at).toLocaleString()} / {item.action} / {item.actor}{item.reason && ` / ${item.reason}`}</li>)}</ul></details>}
      <h3 className="mt-7 font-semibold">Custom-domain portals ({data.custom_domain_portal_count})</h3>
      <p className="mt-1 text-sm text-gray-500">{data.custom_domain_live_count} live</p>
      {data.custom_domain_portal_count > data.custom_domain_portals.length && <p className="mt-1 text-sm text-gray-500">Showing the 200 most recently created portals.</p>}
      {!data.custom_domain_portals.length ? <p className="mt-2 text-sm text-gray-500">No custom-domain portals.</p> :
        <div className="mt-3 overflow-x-auto" role="region" aria-label="Custom-domain portals" tabIndex={0}>
          <table className="w-full text-left text-sm"><thead><tr className="border-b border-gray-200"><th className="py-3 pr-4">Domain</th><th className="px-4">Status</th><th className="pl-4">Agency workspace</th></tr></thead>
            <tbody>{data.custom_domain_portals.map(portal => <tr key={portal.id} className="border-b border-gray-200"><td className="py-3 pr-4">{portal.hostname}</td><td className="px-4">{portal.status}</td><td className="break-all pl-4 text-xs text-gray-600">{portal.owner_workspace_id}</td></tr>)}</tbody>
          </table>
        </div>}
    </>}
  </section>
}
