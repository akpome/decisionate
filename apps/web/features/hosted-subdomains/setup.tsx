"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Check, Copy, ExternalLink, Eye, LoaderCircle, Monitor, RefreshCw, Save, Smartphone, X } from "lucide-react"
import { hostedSubdomainRequest } from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { getBrandSurfaceTextColor } from "@/lib/workspace-brand"
import { getHostedLogo, isHostedLogoUrl, type HostedBrand } from "./types"
import { useHostedPortal } from "./provider"

type PortalRecord = { id: string; slug: string; hostname: string; revision: number; status: string; configuration: HostedBrand; url: string; published: boolean; last_error: string | null }
type Setup = { portal: PortalRecord | null; plan: string; entitled: boolean; commercially_available: boolean; blockers: string[]; defaults: Partial<HostedBrand> }
type AddressCheck = { input: string; status: "available" | "reserved" | "taken" | "invalid" | "error"; message: string }
const emptyBrand: HostedBrand = { name: "", logo_url: "", favicon_url: "", background_url: "", primary_color: "#2563EB", accent_color: "#059669", background_color: "#F8FAFC", support_email: "", welcome_heading: "Welcome back", welcome_text: "" }
const inputClass = "mt-1 h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm"
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-50"

export function HostedSubdomainSetup({ userId, embedded = false }: { userId: string; embedded?: boolean }) {
  const { activeWorkspaceId } = useActiveWorkspace(userId)
  return <HostedSubdomainEditor key={`${userId}:${activeWorkspaceId}`} userId={userId} embedded={embedded} />
}

function HostedSubdomainEditor({ userId, embedded }: { userId: string; embedded: boolean }) {
  const router = useRouter()
  const { portal: activePortal } = useHostedPortal()
  const [data, setData] = useState<Setup | null>(null)
  const [brand, setBrand] = useState<HostedBrand>(emptyBrand)
  const [slug, setSlug] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [reload, setReload] = useState(0)
  const [failedLogo, setFailedLogo] = useState("")
  const [addressCheck, setAddressCheck] = useState<AddressCheck | null>(null)
  const [addressRetry, setAddressRetry] = useState(0)
  const working = useRef(false)
  const previewDialog = useRef<HTMLDialogElement>(null)
  const logo = getHostedLogo(brand)
  const uploadedLogo = logo.startsWith("data:")
  const logoError = logo && failedLogo === logo ? "The logo could not be loaded. Check its URL or upload a PNG, JPEG or WebP file." : ""
  const canEdit = data?.entitled && (data.commercially_available || data.portal?.published)
  const checkedAddress = addressCheck?.input === slug ? addressCheck : null
  const checkingAddress = Boolean(canEdit && !data?.portal && slug.trim() && !checkedAddress)
  const addressReady = Boolean(data?.portal || checkedAddress?.status === "available")
  const addressMessage = checkingAddress ? "Checking address..." : checkedAddress?.message || ""
  const dirty = Boolean(data && (slug !== (data.portal?.slug || "") || JSON.stringify(brand) !== JSON.stringify(data.portal?.configuration || { ...emptyBrand, ...data.defaults })))
  const Container = embedded ? "section" : "main"
  const Heading = embedded ? "h2" : "h1"
  const Subheading = embedded ? "h3" : "h2"
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
    if (!canEdit || data?.portal || !slug.trim()) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void hostedSubdomainRequest<Omit<AddressCheck, "input">>(userId, `/availability?slug=${encodeURIComponent(slug)}`, { signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) setAddressCheck({ ...result, input: slug })
      }).catch(() => {
        if (!controller.signal.aborted) setAddressCheck({ input: slug, status: "error", message: "Could not check this address. Try again." })
      })
    }, 350)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [userId, slug, canEdit, data?.portal, addressRetry])
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
    if (!data?.portal && !addressReady) throw new Error(addressMessage || "Choose an available subdomain.")
    if (logo && !uploadedLogo && !isHostedLogoUrl(logo.trim())) throw new Error("Enter an HTTPS logo URL or upload a logo.")
    const configuration = { ...brand, logo_url: logo.trim(), favicon_url: "" }
    const portal = await hostedSubdomainRequest<PortalRecord>(userId, "", { method: "PUT", body: JSON.stringify({ slug, configuration, revision: data?.portal?.revision || 0 }) })
    setData(value => value ? { ...value, portal } : value); setBrand(portal.configuration); setSlug(portal.slug)
    setNotice("Draft saved."); setPreview(openPreview)
  }
  function field(key: keyof HostedBrand, label: string, type = "text") {
    return <label className="block min-w-0 text-sm text-gray-700">{label}<input type={type} required={key === "name" || key === "support_email"} value={brand[key]} maxLength={key === "name" ? 100 : key === "support_email" ? 254 : 120}
      onChange={event => setBrand(value => ({ ...value, [key]: event.target.value }))} className={inputClass} /></label>
  }
  function imageField(key: "logo_url" | "background_url", label: string) {
    const maxBytes = key === "logo_url" ? 1024 * 1024 : 128 * 1024
    const maxSize = key === "logo_url" ? "1 MB" : "128 KB"
    const hintId = `hosted-${key}-hint`
    const source = key === "logo_url" ? getHostedLogo(brand) : brand[key]
    const image = key === "logo_url" && source && !source.startsWith("data:") && !isHostedLogoUrl(source.trim()) ? "" : source
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
            setBrand(current => ({ ...current, [key]: value, ...(key === "logo_url" ? { favicon_url: "" } : {}) }))
            if (key === "logo_url") setFailedLogo("")
          })
        }} /></label>
      <p id={hintId} className="mt-1 text-xs text-gray-500">PNG, JPEG or WebP. Up to {maxSize}.</p>
      {image && <div className="mt-2 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={key === "logo_url" ? "Logo preview" : `${label} preview`} referrerPolicy="no-referrer" onError={() => { if (key === "logo_url") setFailedLogo(image) }} className="h-10 w-20 rounded object-contain" />
        <button type="button" className={buttonClass} title={key === "logo_url" ? "Remove logo" : `Remove ${label.toLowerCase()}`} aria-label={key === "logo_url" ? "Remove logo" : `Remove ${label.toLowerCase()}`} onClick={() => setBrand(current => ({ ...current, [key]: "", ...(key === "logo_url" ? { favicon_url: "" } : {}) }))}><X size={16} /></button>
      </div>}
      {key === "logo_url" && logoError && <p role="alert" className="mt-2 text-sm text-red-700">{logoError}</p>}
    </div>
  }
  return <Container aria-label={embedded ? "Hosted portal settings" : undefined} className={embedded ? "min-w-0" : "mx-auto w-full max-w-5xl px-4 py-6 sm:px-6"}>
    <header className="flex items-center justify-between gap-4 border-b border-gray-200 pb-5">
      <Heading className={embedded ? "text-xl font-semibold" : "text-2xl font-semibold"}>{embedded ? "Hosted portal settings" : "Hosted portal"}</Heading>
      <button className={buttonClass} aria-label="Refresh hosted portal" title="Refresh hosted portal" disabled={busy}
        onClick={() => { if (!dirty || window.confirm("Discard unsaved portal changes?")) setReload(value => value + 1) }}><RefreshCw size={16} /></button>
    </header>
    {error && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm text-emerald-700">{notice}</p>}
    {!data && !error && <p role="status" className="py-8 text-sm text-gray-600">Loading portal...</p>}
    {data && <>
      <section className="border-b border-gray-200 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Subheading className="font-semibold">{data.plan === "professional" ? "Professional" : "Agency"}</Subheading>
          <span className="text-sm text-gray-600">{data.entitled ? "Hosted portal included" : "Active subscription required"}</span>
        </div>
        {!data.entitled && <Link href="/billing" className="mt-3 inline-block text-sm text-blue-700 underline">Open Billing</Link>}
        {!data.commercially_available && !data.portal?.published && <p className="mt-3 text-sm text-gray-600">New hosted portals are not available yet.</p>}
      </section>
      {data.portal && <section aria-label="Portal address" className="flex flex-wrap items-center gap-3 border-b border-gray-200 py-5">
        <span className="min-w-0 break-all text-sm">{data.portal.hostname}</span>
        <span className="text-sm text-gray-500">{data.portal.status}</span>
        {data.entitled && data.portal.status === "active" && <a href={data.portal.url} target="_blank" rel="noreferrer" className={buttonClass}>Open portal<ExternalLink size={16} /></a>}
        <button className={buttonClass} title="Copy portal URL" aria-label="Copy portal URL" onClick={() => void perform(async () => { await navigator.clipboard.writeText(data.portal!.url); setNotice("Portal URL copied.") })}><Copy size={16} /></button>
        {!embedded && <Link href="/settings" className="text-sm text-blue-700 underline">{data.plan === "professional" ? "Manage workspace members" : "Manage client invitations"}</Link>}
      </section>}
      {canEdit && <form onSubmit={event => { event.preventDefault(); void perform(() => save(true)) }}>
        <fieldset disabled={busy} className="min-w-0 disabled:opacity-60">
          {!data.portal && <section className="border-b border-gray-200 py-6">
            <Subheading className="mb-4 font-semibold">Portal address</Subheading>
            <label className="block max-w-xl text-sm text-gray-700">Subdomain
              <div className="mt-1 flex min-w-0 items-center rounded-md border border-gray-300 bg-white"><input aria-label="Subdomain" aria-describedby="hosted-address-status" aria-invalid={Boolean(checkedAddress && checkedAddress.status !== "available")} autoCapitalize="none" spellCheck={false} required pattern={"[a-z0-9][a-z0-9\\-]{1,38}[a-z0-9]"} maxLength={40}
                value={slug} onChange={event => { setSlug(event.target.value.toLowerCase()); setAddressCheck(null) }} className="h-10 min-w-0 flex-1 rounded-l-md px-3" /><span className="shrink-0 pr-3 text-xs text-gray-500">.decisionate.app</span></div>
            </label>
            <div id="hosted-address-status" role="status" className={`mt-2 flex min-h-5 max-w-xl items-center gap-2 text-sm ${!data.portal && checkedAddress && checkedAddress.status !== "available" ? "text-red-700" : "text-gray-600"}`}>
              {checkingAddress && <LoaderCircle aria-hidden="true" size={16} className="shrink-0 animate-spin" />}
              <span>{addressMessage}</span>
              {!data.portal && checkedAddress?.status === "error" && <button type="button" className="shrink-0 underline" onClick={() => { setAddressCheck(null); setAddressRetry(value => value + 1) }}>Try again</button>}
            </div>
          </section>}
          <section className="border-b border-gray-200 py-6">
            <Subheading className="mb-4 font-semibold">Brand identity</Subheading>
            <div className="grid gap-4 sm:grid-cols-2">{field("name", "Portal name")}{field("support_email", "Support email", "email")}
              <label className="min-w-0 text-sm text-gray-700" htmlFor="hosted-logo-url">Logo URL
                <input id="hosted-logo-url" type="url" inputMode="url" pattern="https://.*" title="Enter an HTTPS logo URL" maxLength={2048}
                  value={uploadedLogo ? "" : logo} placeholder={uploadedLogo ? "Uploaded logo selected. Paste a URL to replace it." : "https://example.com/logo.png"}
                  onChange={event => { setBrand(current => ({ ...current, logo_url: event.target.value, favicon_url: "" })); setFailedLogo(""); setError("") }} className={inputClass} />
              </label>
              {imageField("logo_url", "Upload logo")}
            </div>
            <div className="mt-5 flex flex-wrap gap-6">{([['primary_color', 'Primary colour'], ['accent_color', 'Accent colour'], ['background_color', 'Background colour']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input aria-label={label} type="color" value={brand[key]} onChange={event => setBrand(value => ({ ...value, [key]: event.target.value }))} className="h-9 w-10 cursor-pointer" />{label}</label>)}</div>
          </section>
          <section className="border-b border-gray-200 py-6">
            <Subheading className="mb-4 font-semibold">Welcome screen</Subheading>
            <div className="grid gap-4 sm:grid-cols-2">{field("welcome_heading", "Welcome heading")}{imageField("background_url", "Background image")}</div>
            <label className="mt-4 block text-sm text-gray-700">Welcome message<textarea value={brand.welcome_text} maxLength={400} onChange={event => setBrand(value => ({ ...value, welcome_text: event.target.value }))} className="mt-1 min-h-24 w-full rounded-md border border-gray-300 bg-white p-3" /></label>
          </section>
          <div className="flex flex-wrap justify-end gap-3 py-5"><button type="button" className={buttonClass} disabled={!addressReady} onClick={() => void perform(() => save())}><Save size={16} />Save draft</button><button type="submit" className={buttonClass} disabled={!addressReady}><Eye size={16} />Preview portal</button></div>
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
            {logo && /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logo} alt={brand.name} referrerPolicy="no-referrer" onError={() => setFailedLogo(logo)} className="mb-4 h-12 max-w-full object-contain" />}
            {logoError && <p role="alert" className="mb-3 text-sm text-red-700">{logoError}</p>}
            <p className="break-words text-sm font-semibold text-gray-600">{brand.name}</p><h3 className="mt-3 break-words text-xl font-semibold">{brand.welcome_heading}</h3><p className="mt-3 break-words text-sm text-gray-600">{brand.welcome_text}</p>
            <div className="mt-5 rounded-md px-3 py-2 text-center text-sm" style={{ backgroundColor: brand.primary_color, color: getBrandSurfaceTextColor(brand.primary_color) }}>Continue to sign in</div>
          </div>
        </div>
        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end"><button className={buttonClass} disabled={busy || data.blockers.length > 0 || data.portal.status === "suspended"} onClick={() => void perform(async () => {
          const portal = await hostedSubdomainRequest<PortalRecord>(userId, "/activate", { method: "POST", body: JSON.stringify({ revision: data.portal!.revision, confirmation: "PUBLISH PORTAL" }) })
          setData(value => value ? { ...value, portal } : value); setPreview(false); setNotice("Portal published.")
          if (activePortal?.id === portal.id) router.refresh()
        })}><Check size={16} />{busy ? "Publishing..." : data.portal.published ? "Publish changes" : "Activate portal"}</button></div>
      </div>
    </dialog>}
  </Container>
}
