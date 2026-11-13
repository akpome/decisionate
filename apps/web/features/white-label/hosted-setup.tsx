"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy, ExternalLink, Globe, Loader2, Play, RefreshCw, Save } from "lucide-react"
import { hostedPortalRequest } from "@/lib/api"

type Configuration = {
  name: string; domain: string; logo_url: string; primary_color: string; support_email: string
  privacy_url: string; terms_url: string; currency: string; prices: Record<string, number>
}
type Portal = {
  id: string; configuration: Configuration; revision: number; status: string; stripe_connected: boolean
  step: string; checks: Record<string, boolean>; dns_records: { source: string; type: string; name: string; value: string; priority?: number | null }[]
  last_error: string; busy: boolean; url: string | null
}
type Listing = { portal: Portal | null; blockers: string[]; prices: { key: string; label: string }[] }
const field = "mt-1 h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm disabled:bg-gray-100"
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
const empty: Configuration = {
  name: "", domain: "", logo_url: "", primary_color: "#2563EB", support_email: "", privacy_url: "", terms_url: "", currency: "USD",
  prices: { PROFESSIONAL: 9900, PROFESSIONAL_ANNUAL: 99000, AGENCY: 19900, AGENCY_ANNUAL: 199000,
    CLIENT_WORKSPACE_ADDON: 1900, CLIENT_WORKSPACE_ADDON_ANNUAL: 19000, AI_CREDIT_PACK: 1000, AI_CREDIT_TOPUP: 1000 },
}
const stepNames: Record<string, string> = {
  stripe: "Connect Stripe", hosting: "Preparing hosting", sign_in: "Preparing sign-in", email: "Preparing email",
  prices: "Creating billing plans", webhook: "Connecting payment updates", deployment: "Deploying your portal",
  verification: "Checking domain and services", launch: "Ready to launch", live: "Live",
}
const checkNames: Record<string, string> = {
  domain: "Portal address", sign_in: "Sign-in", email: "Email", hosting: "Hosting", https: "Secure connection", billing: "Billing",
}

export function HostedPortalSetup({ userId }: { userId: string }) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [portal, setPortal] = useState<Portal | null>(null)
  const [form, setForm] = useState<Configuration>(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const working = useRef(false)
  const mounted = useRef(true)
  const locked = Boolean(portal && (portal.status !== "draft" || portal.stripe_connected || portal.busy))
  const dirty = JSON.stringify(form) !== JSON.stringify(portal?.configuration ?? empty)
  const blocked = !listing || listing.blockers.length > 0

  function accept(value: Portal) { setPortal(value); setForm(value.configuration) }
  async function refresh() {
    const result = await hostedPortalRequest<Listing>(userId)
    if (!mounted.current) return
    setListing(result); setPortal(result.portal); if (result.portal) setForm(result.portal.configuration)
  }
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void hostedPortalRequest<Listing>(userId, "", { signal: controller.signal }).then(result => {
      if (!mounted.current) return
      setListing(result); setPortal(result.portal); if (result.portal) setForm(result.portal.configuration)
      const outcome = new URLSearchParams(window.location.search).get("stripe")
      if (outcome === "failed") setError("Stripe could not be connected. Use a separate live Stripe account and try again.")
      if (outcome === "cancelled") setMessage("Stripe connection cancelled. Your setup is saved.")
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Setup could not be loaded") })
    return () => { mounted.current = false; controller.abort() }
  }, [userId])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(""), 5000)
    return () => window.clearTimeout(timer)
  }, [message])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  async function run(action: () => Promise<void>) {
    if (working.current) return
    working.current = true; setBusy(true); setError(""); setMessage("")
    try { await action() } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Setup could not be completed") }
    finally { working.current = false; if (mounted.current) setBusy(false) }
  }
  async function prepare() {
    for (let attempt = 0; attempt < 20 && mounted.current; attempt++) {
      const result = await hostedPortalRequest<Portal>(userId, "/prepare", { method: "POST" })
      if (!mounted.current) return
      accept(result)
      if (["waiting", "ready", "live"].includes(result.status)) return
    }
  }
  async function launch() {
    try {
      const result = await hostedPortalRequest<Portal>(userId, "/launch", { method: "POST" })
      if (mounted.current) accept(result)
    } catch (reason) {
      // A failed live check can move the saved setup back to verification.
      try { await refresh() } catch { /* Keep the original launch error. */ }
      throw reason
    }
  }
  function change(key: keyof Configuration, value: string) { setForm(current => ({ ...current, [key]: value })) }

  return <main className="mx-auto w-full max-w-5xl space-y-6 pb-8">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-5">
      <h1 className="flex items-center gap-2 text-2xl font-semibold"><Globe size={24} />Your branded portal</h1>
      <button className={button} disabled={busy || dirty} onClick={() => void run(refresh)} title="Refresh setup"><RefreshCw size={16} /><span>Refresh</span></button>
    </header>
    {(error || portal?.last_error) && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error || portal?.last_error}</p>}
    {message && <p role="status" className="text-sm text-green-800">{message}</p>}
    {listing?.blockers.length ? <section className="border-l-2 border-amber-400 pl-4 text-sm text-amber-900">
      <h2 className="font-semibold">Hosting setup is not available yet</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">{listing.blockers.map(item => <li key={item}>{item}</li>)}</ul>
    </section> : null}
    {!listing && !error && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={16} />Loading setup</p>}
    {listing && <>
      <details open={!locked} className="min-w-0">
      <summary className="cursor-pointer text-base font-semibold">1. Your brand and prices{locked ? `: ${form.name}` : ""}</summary>
      <form onSubmit={event => { event.preventDefault(); void run(async () => {
        accept(await hostedPortalRequest<Portal>(userId, "", { method: "PUT", body: JSON.stringify({ configuration: form, revision: portal?.revision ?? 0 }) }))
        setMessage("Portal details saved.")
      }) }} className="mt-4 space-y-5">
        <fieldset disabled={locked || busy} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm">Brand name<input required maxLength={100} className={field} value={form.name} onChange={e => change("name", e.target.value)} /></label>
          <label className="min-w-0 text-sm">Portal domain<input required placeholder="portal.example.com" className={field} value={form.domain} onChange={e => change("domain", e.target.value)} /></label>
          <label className="min-w-0 text-sm">Logo URL<input type="url" placeholder="https://" className={field} value={form.logo_url} onChange={e => change("logo_url", e.target.value)} /></label>
          <label className="text-sm">Brand color<input type="color" className="mt-1 block h-10 w-16 rounded border p-1" value={form.primary_color} onChange={e => change("primary_color", e.target.value)} /></label>
          <label className="min-w-0 text-sm">Support email<input required type="email" className={field} value={form.support_email} onChange={e => change("support_email", e.target.value)} /></label>
          <label className="min-w-0 text-sm">Billing currency<select className={field} value={form.currency} onChange={e => change("currency", e.target.value)}>{["USD", "CAD", "EUR", "GBP", "AUD", "NZD"].map(code => <option key={code}>{code}</option>)}</select></label>
          <label className="min-w-0 text-sm">Privacy policy URL<input required type="url" className={field} value={form.privacy_url} onChange={e => change("privacy_url", e.target.value)} /></label>
          <label className="min-w-0 text-sm">Terms URL<input required type="url" className={field} value={form.terms_url} onChange={e => change("terms_url", e.target.value)} /></label>
          {listing.prices.map(price => <label key={price.key} className="min-w-0 text-sm">{price.label} ({form.currency})<input required type="number" min="0.50" max="100000" step="0.01" className={field}
            value={form.prices[price.key] / 100} onChange={e => setForm(current => ({ ...current, prices: { ...current.prices, [price.key]: Math.round(Number(e.target.value) * 100) } }))} /></label>)}
        </fieldset>
        {!locked && <button type="submit" disabled={busy} className={button}><Save size={16} />Save details</button>}
      </form>
      </details>
      <section className="space-y-3 border-t border-gray-200 pt-5">
        <h2 className="text-base font-semibold">2. Connect your Stripe account</h2>
        {portal?.stripe_connected ? <p className="flex items-center gap-2 text-sm text-green-800"><Check size={16} />Stripe connected</p>
          : <button className={button} disabled={blocked || busy || !portal || dirty} onClick={() => void run(async () => {
            const result = await hostedPortalRequest<{ url: string }>(userId, "/stripe", { method: "POST" })
            const url = new URL(result.url)
            if (url.origin !== "https://connect.stripe.com") throw new Error("Unexpected Stripe authorization address")
            window.location.assign(url.href)
          })}><ExternalLink size={16} />Connect Stripe</button>}
      </section>
      <section className="space-y-4 border-t border-gray-200 pt-5">
        <h2 className="text-base font-semibold">3. Prepare and verify your portal</h2>
        {portal && <p role="status" className="flex items-center gap-2 text-sm">{busy && <Loader2 size={16} className="animate-spin" />}{stepNames[portal.step] || portal.step}</p>}
        {!!portal?.dns_records.length && <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Domain DNS records"><table className="w-full min-w-[700px] table-fixed text-left text-sm">
          <caption className="pb-3 text-left font-medium">DNS records for your domain</caption>
          <colgroup><col className="w-24" /><col className="w-24" /><col className="w-56" /><col /></colgroup>
          <thead><tr className="border-b"><th className="p-2">Service</th><th className="p-2">Type</th><th className="p-2">Name</th><th className="p-2">Value</th></tr></thead>
          <tbody>{portal.dns_records.map((record, index) => <tr key={index} className="border-b">
            <td className="p-2">{record.source}</td><td className="p-2">{record.type}{record.priority != null && <span className="block text-xs">Priority {record.priority}</span>}</td><td className="break-all p-2">{record.name}</td><td className="p-2"><div className="flex items-start gap-2"><span className="min-w-0 break-all">{record.value}</span><button className="shrink-0 p-1" title="Copy DNS value" aria-label={`Copy ${record.name} value`} onClick={() => void run(async () => { await navigator.clipboard.writeText(record.value); setMessage("DNS value copied.") })}><Copy size={14} /></button></div></td>
          </tr>)}</tbody></table></div>}
        {!!portal && Object.keys(portal.checks).length > 0 && <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">{Object.entries(portal.checks).map(([key, ready]) => <li key={key} className={ready ? "text-green-800" : "text-amber-800"}>{checkNames[key] || key}: {ready ? "Ready" : "Waiting"}</li>)}</ul>}
        {portal?.busy && <p role="status" className="text-sm text-gray-600">Setup is running. Refresh shortly for its latest status.</p>}
        {portal?.status !== "live" && portal?.step !== "launch" && <button className={button} disabled={busy || portal?.busy || blocked || !portal?.stripe_connected || dirty} onClick={() => void run(prepare)}><RefreshCw size={16} />{portal?.status === "waiting" ? "Check setup again" : "Prepare portal"}</button>}
        {portal?.step === "launch" && <button className={`${button} bg-blue-600 text-white`} disabled={busy || portal.busy || blocked} onClick={() => void run(launch)}><Play size={16} />Launch portal</button>}
        {portal?.url && <a href={portal.url} target="_blank" rel="noreferrer" className={button}><ExternalLink size={16} />Open {portal.configuration.name}</a>}
      </section>
    </>}
  </main>
}
