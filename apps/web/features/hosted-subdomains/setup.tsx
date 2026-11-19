"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Check, Copy, ExternalLink, Eye, Monitor, RefreshCw, Save, Smartphone, X } from "lucide-react"
import { hostedSubdomainRequest } from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { getBrandSurfaceTextColor } from "@/lib/workspace-brand"
import { type HostedBrand } from "./types"

type PortalRecord = { id: string; slug: string; hostname: string; revision: number; status: string; configuration: HostedBrand; url: string; published: boolean; last_error: string | null }
type Setup = { portal: PortalRecord | null; entitled: boolean; commercially_available: boolean; blockers: string[]; defaults: Partial<HostedBrand> }
const emptyBrand: HostedBrand = { name: "", logo_url: "", favicon_url: "", background_url: "", primary_color: "#2563EB", accent_color: "#059669", background_color: "#F8FAFC", support_email: "", welcome_heading: "Welcome back", welcome_text: "" }
const inputClass = "mt-1 h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm"
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-50"

export function HostedSubdomainSetup({ userId }: { userId: string }) {
  const { activeWorkspaceId } = useActiveWorkspace(userId)
  return <HostedSubdomainEditor key={`${userId}:${activeWorkspaceId}`} userId={userId} />
}

function HostedSubdomainEditor({ userId }: { userId: string }) {
  const [data, setData] = useState<Setup | null>(null)
  const [brand, setBrand] = useState<HostedBrand>(emptyBrand)
  const [slug, setSlug] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [reload, setReload] = useState(0)
  const working = useRef(false)
  const previewDialog = useRef<HTMLDialogElement>(null)
  const dirty = Boolean(data && (slug !== (data.portal?.slug || "") || JSON.stringify(brand) !== JSON.stringify(data.portal?.configuration || { ...emptyBrand, ...data.defaults })))
  useEffect(() => {
    if (preview) previewDialog.current?.showModal()
  }, [preview])
  useEffect(() => {
    const controller = new AbortController()
    void hostedSubdomainRequest<Setup>(userId, "", { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return
      setData(value); setBrand(value.portal?.configuration || { ...emptyBrand, ...value.defaults }); setSlug(value.portal?.slug || ""); setError("")
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load your portal") })
    return () => controller.abort()
  }, [userId, reload])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(""), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function perform(action: () => Promise<void>) {
    if (working.current) return
    working.current = true
    setBusy(true); setError("")
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete this step") }
    finally { working.current = false; setBusy(false) }
  }
  async function save(openPreview = false) {
    const portal = await hostedSubdomainRequest<PortalRecord>(userId, "", { method: "PUT", body: JSON.stringify({ slug, configuration: brand, revision: data?.portal?.revision || 0 }) })
    setData(value => value ? { ...value, portal } : value); setBrand(portal.configuration); setSlug(portal.slug)
    setNotice("Draft saved."); setPreview(openPreview)
  }
  function field(key: keyof HostedBrand, label: string, type = "text") {
    return <label className="block min-w-0 text-sm text-gray-700">{label}<input type={type} required={key === "name" || key === "support_email"} value={brand[key]} maxLength={key === "name" ? 100 : key === "support_email" ? 254 : 120}
      onChange={event => setBrand(value => ({ ...value, [key]: event.target.value }))} className={inputClass} /></label>
  }
  function imageField(key: "logo_url" | "favicon_url" | "background_url", label: string) {
    const maxBytes = key === "logo_url" ? 1024 * 1024 : 128 * 1024
    const maxSize = key === "logo_url" ? "1 MB" : "128 KB"
    const hintId = `hosted-${key}-hint`
    return <div className="min-w-0 text-sm text-gray-700"><label className="block">{label}
      <input type="file" accept="image/png,image/jpeg,image/webp" aria-describedby={hintId} className="mt-1 block min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white p-2 text-xs"
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          void perform(async () => {
            if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > maxBytes) throw new Error(`Choose a PNG, JPEG or WebP image no larger than ${maxSize}.`)
            const value = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result))
              reader.onerror = () => reject(new Error("The image could not be read."))
              reader.readAsDataURL(file)
            })
            setBrand(current => ({ ...current, [key]: value }))
          })
        }} /></label>
      <p id={hintId} className="mt-1 text-xs text-gray-500">PNG, JPEG or WebP. Up to {maxSize}.</p>
      {brand[key] && <div className="mt-2 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand[key]} alt={`${label} preview`} className="h-10 w-20 rounded object-contain" />
        <button type="button" className={buttonClass} title={`Remove ${label.toLowerCase()}`} aria-label={`Remove ${label.toLowerCase()}`} onClick={() => setBrand(current => ({ ...current, [key]: "" }))}><X size={16} /></button>
      </div>}
    </div>
  }
  const canEdit = data?.entitled && (data.commercially_available || data.portal?.published)
  return <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
    <header className="flex items-center justify-between gap-4 border-b border-gray-200 pb-5">
      <h1 className="text-2xl font-semibold">Hosted portal</h1>
      <button className={buttonClass} aria-label="Refresh hosted portal" title="Refresh hosted portal" disabled={busy}
        onClick={() => { if (!dirty || window.confirm("Discard unsaved portal changes?")) setReload(value => value + 1) }}><RefreshCw size={16} /></button>
    </header>
    {error && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm text-emerald-700">{notice}</p>}
    {!data && !error && <p role="status" className="py-8 text-sm text-gray-600">Loading portal...</p>}
    {data && <>
      <section className="border-b border-gray-200 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">White Label Subdomain Agency</h2><span className="text-sm text-gray-600">{data.entitled ? "Hosted portal included" : "White-label subscription required"}</span>
        </div>
        {!data.entitled && <Link href="/billing" className="mt-3 inline-block text-sm text-blue-700 underline">Choose a white-label plan</Link>}
        {!data.commercially_available && !data.portal?.published && <p className="mt-3 text-sm text-gray-600">New hosted portals are not available yet.</p>}
      </section>
      {data.portal?.published && <section className="flex flex-wrap items-center gap-3 border-b border-gray-200 py-5">
        <span className="min-w-0 break-all text-sm">{data.portal.hostname}</span>
        <span className="text-sm text-gray-500">{data.portal.status}</span>
        {data.entitled && data.portal.status === "active" && <a href={data.portal.url} target="_blank" rel="noreferrer" className={buttonClass}>Open portal<ExternalLink size={16} /></a>}
        <button className={buttonClass} title="Copy portal URL" aria-label="Copy portal URL" onClick={() => void perform(async () => { await navigator.clipboard.writeText(data.portal!.url); setNotice("Portal URL copied.") })}><Copy size={16} /></button>
        <Link href="/settings" className="text-sm text-blue-700 underline">Manage client invitations</Link>
      </section>}
      {canEdit && <form onSubmit={event => { event.preventDefault(); void perform(() => save(true)) }}>
        <fieldset disabled={busy} className="min-w-0 disabled:opacity-60">
          <section className="border-b border-gray-200 py-6">
            <h2 className="mb-4 font-semibold">Portal address</h2>
            <label className="block max-w-xl text-sm text-gray-700">Subdomain
              <div className="mt-1 flex min-w-0 items-center rounded-md border border-gray-300 bg-white"><input aria-label="Subdomain" required disabled={Boolean(data.portal)} pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" maxLength={40}
                value={slug} onChange={event => setSlug(event.target.value.toLowerCase())} className="h-10 min-w-0 flex-1 rounded-l-md px-3" /><span className="shrink-0 pr-3 text-xs text-gray-500">.decisionate.app</span></div>
            </label>
          </section>
          <section className="border-b border-gray-200 py-6">
            <h2 className="mb-4 font-semibold">Brand identity</h2>
            <div className="grid gap-4 sm:grid-cols-2">{field("name", "Portal name")}{field("support_email", "Support email", "email")}{imageField("logo_url", "Logo")}{imageField("favicon_url", "Browser icon")}</div>
            <div className="mt-5 flex flex-wrap gap-6">{([['primary_color', 'Primary colour'], ['accent_color', 'Accent colour'], ['background_color', 'Background colour']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input aria-label={label} type="color" value={brand[key]} onChange={event => setBrand(value => ({ ...value, [key]: event.target.value }))} className="h-9 w-10 cursor-pointer" />{label}</label>)}</div>
          </section>
          <section className="border-b border-gray-200 py-6">
            <h2 className="mb-4 font-semibold">Welcome screen</h2>
            <div className="grid gap-4 sm:grid-cols-2">{field("welcome_heading", "Welcome heading")}{imageField("background_url", "Background image")}</div>
            <label className="mt-4 block text-sm text-gray-700">Welcome message<textarea value={brand.welcome_text} maxLength={400} onChange={event => setBrand(value => ({ ...value, welcome_text: event.target.value }))} className="mt-1 min-h-24 w-full rounded-md border border-gray-300 bg-white p-3" /></label>
          </section>
          <div className="flex flex-wrap justify-end gap-3 py-5"><button type="button" className={buttonClass} onClick={() => void perform(() => save())}><Save size={16} />Save draft</button><button type="submit" className={buttonClass}><Eye size={16} />Preview portal</button></div>
        </fieldset>
      </form>}
      {data.blockers.length > 0 && canEdit && <p className="text-sm text-amber-800">Publishing is awaiting platform launch checks. Your draft can be saved.</p>}
      {data.portal?.last_error && <p role="alert" className="mt-3 text-sm text-amber-800">{data.portal.last_error}</p>}
    </>}
    {preview && data?.portal && <dialog ref={previewDialog} aria-label="Portal preview" onCancel={event => { if (busy) event.preventDefault(); else setPreview(false) }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-5xl overflow-auto rounded-lg bg-white backdrop:bg-black/40">
      <div className="mx-auto max-w-5xl rounded-lg bg-white p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Portal preview</h2><div className="flex gap-2">
          <button title="Desktop preview" aria-label="Desktop preview" aria-pressed={!mobile} onClick={() => setMobile(false)} className={buttonClass}><Monitor size={18} /></button>
          <button title="Mobile preview" aria-label="Mobile preview" aria-pressed={mobile} onClick={() => setMobile(true)} className={buttonClass}><Smartphone size={18} /></button>
          <button title="Close preview" aria-label="Close preview" onClick={() => setPreview(false)} disabled={busy} className={buttonClass}><X size={18} /></button></div></div>
        <div className={`mx-auto my-6 flex min-h-96 items-center justify-center rounded-md border border-gray-200 p-5 ${mobile ? "max-w-sm" : "w-full"}`} style={{ backgroundColor: brand.background_color, ...(brand.background_url ? { backgroundImage: `url(${JSON.stringify(brand.background_url)})`, backgroundSize: "cover" } : {}) }}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-sm">
            {brand.logo_url && /* eslint-disable-next-line @next/next/no-img-element */
              <img src={brand.logo_url} alt={brand.name} className="mb-4 h-12 max-w-full object-contain" />}
            <p className="break-words text-sm font-semibold text-gray-600">{brand.name}</p><h3 className="mt-3 break-words text-xl font-semibold">{brand.welcome_heading}</h3><p className="mt-3 break-words text-sm text-gray-600">{brand.welcome_text}</p>
            <div className="mt-5 rounded-md px-3 py-2 text-center text-sm" style={{ backgroundColor: brand.primary_color, color: getBrandSurfaceTextColor(brand.primary_color) }}>Continue to sign in</div>
          </div>
        </div>
        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end"><button className={buttonClass} disabled={busy || data.blockers.length > 0 || data.portal.status === "suspended"} onClick={() => void perform(async () => {
          const portal = await hostedSubdomainRequest<PortalRecord>(userId, "/activate", { method: "POST", body: JSON.stringify({ revision: data.portal!.revision, confirmation: "PUBLISH PORTAL" }) })
          setData(value => value ? { ...value, portal } : value); setPreview(false); setNotice("Portal published.")
        })}><Check size={16} />{busy ? "Publishing..." : data.portal.published ? "Publish changes" : "Activate portal"}</button></div>
      </div>
    </dialog>}
  </main>
}
