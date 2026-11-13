"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Download, Globe, Plus, RefreshCw, Save, Trash2 } from "lucide-react"
import { downloadWhiteLabelPackage, whiteLabelRequest } from "@/lib/api"
import { canConfirmLaunch, emptyConfiguration, hasSetupChanges, resumeStep, stageLabels, type Configuration, type Listing, type Setup } from "./state"
const fieldClass = "mt-1 h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm disabled:bg-gray-100"
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"

export function suggestApplicationId(name: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63)
  return /^[a-z]/.test(id) ? id : id ? `brand-${id}`.slice(0, 63) : ""
}

export function WhiteLabelSetup({ userId }: { userId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [opened, setOpened] = useState(false)
  return <section className="mt-8 min-w-0 border-y border-gray-200 py-5">
    <button type="button" aria-expanded={expanded} aria-controls="white-label-setup" onClick={() => { setOpened(true); setExpanded(!expanded) }} className="flex w-full items-center gap-3 text-left text-lg font-semibold">
      <Globe size={20} className="text-blue-600" />White-label setup<span className="ml-auto text-sm font-normal text-blue-700">{expanded ? "Close" : "Open"}</span>
    </button>
    {opened && <div id="white-label-setup" hidden={!expanded}><SetupWizard key={userId} userId={userId} /></div>}
  </section>
}

function SetupWizard({ userId }: { userId: string }) {
  const [data, setData] = useState<Listing | null>(null)
  const [saved, setSaved] = useState<Setup | null>(null)
  const [form, setForm] = useState(emptyConfiguration)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [customId, setCustomId] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<{ id: string } | "reload" | null>(null)
  const actionPending = useRef(false)
  const dirty = hasSetupChanges(form, saved)
  useEffect(() => {
    let current = true
    void whiteLabelRequest<Listing>(userId).then(result => { if (current) setData(result) })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "Could not load setup") })
    return () => { current = false }
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

  function change<K extends keyof Configuration>(key: K, value: Configuration[K]) {
    setForm(current => ({ ...current, [key]: value, ...(key === "confirmed_checks" ? {} : { confirmed_checks: [] }) }))
    setMessage("")
  }
  async function run(action: () => Promise<void>) {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true); setError(""); setMessage("")
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : "Setup could not be updated") }
    finally { actionPending.current = false; setBusy(false) }
  }
  async function refresh(selectedId: string | null = saved?.configuration.id ?? null) {
    const result = await whiteLabelRequest<Listing>(userId)
    setData(result)
    const latest = result.setups.find(item => item.configuration.id === selectedId)
    if (selectedId && !latest) { setSaved(null); setForm({ ...emptyConfiguration }); setStep(0); setCustomId(false); setMessage("This draft was removed by another administrator.") }
    if (latest) { setSaved(latest); setForm(latest.configuration) }
    if (!selectedId) { setForm({ ...emptyConfiguration }); setCustomId(false) }
  }
  function choose(id: string) {
    const selected = data?.setups.find(item => item.configuration.id === id) ?? null
    setSaved(selected); setForm(selected?.configuration ?? { ...emptyConfiguration }); setStep(selected ? resumeStep(selected) : 0)
    setCustomId(!!selected)
    setError(""); setMessage(""); setConfirmDelete(false)
  }
  function navigate(target: { id: string } | "reload") {
    if (busy) return
    if (dirty) { setPendingNavigation(target); return }
    if (target === "reload") void run(refresh)
    else choose(target.id)
  }
  function accept(result: Setup) {
    setSaved(result); setForm(result.configuration)
    setData(current => current ? { ...current, setups: [result, ...current.setups.filter(item => item.configuration.id !== result.configuration.id)] } : current)
  }
  async function save(advance = false) {
    const result = await whiteLabelRequest<Setup>(userId, `/${encodeURIComponent(form.id)}`, {
      method: "PUT", body: JSON.stringify({ configuration: { ...form, allowed_origins: form.allowed_origins.map(value => value.trim()).filter(Boolean) }, revision: saved?.revision ?? 0 }),
    })
    accept(result)
    if (advance) setStep(current => Math.min(current + 1, 3))
    setMessage("Setup saved. Live applications are unchanged.")
  }
  async function download() {
    if (!saved || dirty || !saved.readiness.package_ready) return
    const blob = await downloadWhiteLabelPackage(userId, saved.configuration.id, saved.revision)
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url; link.download = `${saved.configuration.id}-setup.zip`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage("Setup package downloaded. Deployment is still required.")
  }
  async function complete() {
    if (!saved || !canConfirmLaunch(saved, dirty)) return
    const result = await whiteLabelRequest<Setup>(userId, `/${encodeURIComponent(saved.configuration.id)}/complete`, {
      method: "POST", body: JSON.stringify({ revision: saved.revision }),
    })
    accept(result)
    setMessage("Launch confirmation recorded.")
  }

  return <div className="mt-5 min-w-0 space-y-5">
    <div className="flex flex-wrap items-end gap-3">
      <label className="w-full min-w-0 text-sm sm:w-auto sm:flex-1">Application setup
        <select value={saved?.configuration.id ?? ""} disabled={busy || !data} onChange={event => navigate({ id: event.target.value })} className={fieldClass}>
          <option value="">New application</option>{data?.setups.map(item => <option key={item.configuration.id} value={item.configuration.id}>{item.configuration.name} - {stageLabels[item.stage] ?? "Draft"}</option>)}
        </select>
      </label>
      <button type="button" className={buttonClass} disabled={busy || !data} onClick={() => navigate({ id: "" })}><Plus size={16} />New</button>
      <button type="button" title="Reload setup and configuration checks" aria-label="Reload setup" className={buttonClass} disabled={busy} onClick={() => navigate("reload")}><RefreshCw size={16} /></button>
    </div>
    {!data && !error && <p role="status" className="text-sm text-gray-500">Loading applications...</p>}
    {data && <p className="break-words text-xs text-gray-500">Registered: {data.registered.map(item => item.name).join(", ")}</p>}
    {error && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="text-sm text-green-700">{message}</p>}
    {pendingNavigation && <div role="alertdialog" aria-label="Discard unsaved setup changes?" className="flex flex-wrap items-center gap-3 border-y border-amber-200 py-3 text-sm">
      <p>Discard unsaved changes{pendingNavigation === "reload" ? " and reload the latest setup" : ""}?</p>
      <button type="button" disabled={busy} className={buttonClass} onClick={() => {
        const target = pendingNavigation; setPendingNavigation(null)
        if (target === "reload") void run(refresh)
        else choose(target.id)
      }}>Discard and continue</button>
      <button type="button" className={buttonClass} onClick={() => setPendingNavigation(null)}>Keep editing</button>
    </div>}
    {saved && <p role="status" className={`text-sm font-medium ${saved.completion?.current && !dirty ? "text-green-700" : "text-gray-700"}`}>
      {dirty ? "Unsaved changes" : stageLabels[saved.stage] ?? "Draft"}
      {saved.completion?.current && !dirty && <span className="ml-2 font-normal">{new Date(saved.completion.confirmed_at).toLocaleString()}</span>}
    </p>}
    <nav aria-label="Setup steps" className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
      {["Brand", "Sign-in and billing", "Deployment", "Launch review"].map((label, index) => <button type="button" key={label} disabled={busy} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)} className={`${buttonClass} ${step === index ? "border-blue-600 bg-blue-50 text-blue-700" : "text-gray-600"}`}>{index + 1}. {label}</button>)}
    </nav>
    <form onSubmit={event => { event.preventDefault(); void run(() => save()) }}>
      <fieldset disabled={busy || !data} className="min-w-0">
        {step === 0 && <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm">Brand name<input required maxLength={120} value={form.name} onChange={event => {
            const name = event.target.value
            setForm(current => ({ ...current, name, id: !saved && !customId ? suggestApplicationId(name) : current.id, confirmed_checks: [] }))
            setMessage("")
          }} className={fieldClass} /></label>
          <label className="min-w-0 text-sm">Application ID<input required disabled={!!saved} pattern="[a-z][a-z0-9-]{1,62}" placeholder="decisionate-ai" value={form.id} onChange={event => { setCustomId(true); change("id", event.target.value) }} className={fieldClass} /></label>
          <label className="min-w-0 text-sm">Frontend URL<input required disabled={saved?.readiness.registered} type="url" placeholder="https://www.decisionate.ai" value={form.web_url} onChange={event => change("web_url", event.target.value)} className={fieldClass} /></label>
          <label className="min-w-0 text-sm">Additional frontend origins<input disabled={saved?.readiness.registered} placeholder="https://decisionate.ai" value={form.allowed_origins.join(",")} onChange={event => change("allowed_origins", event.target.value.split(","))} className={fieldClass} /></label>
          <label className="min-w-0 text-sm">Support email<input type="email" value={form.support_email} onChange={event => change("support_email", event.target.value)} className={fieldClass} /></label>
          <label className="min-w-0 text-sm">Sender email<input type="email" placeholder="no-reply@your-domain.com" value={form.sender_email} onChange={event => change("sender_email", event.target.value)} className={fieldClass} /></label>
          <label className="min-w-0 text-sm">Logo URL (optional)<input type="url" value={form.logo_url} onChange={event => change("logo_url", event.target.value)} className={fieldClass} /></label>
          <label className="min-w-0 text-sm">Brand color<input type="color" value={form.primary_color} onChange={event => change("primary_color", event.target.value)} className="mt-1 block h-10 w-16 rounded border border-gray-300 bg-white p-1" /></label>
          <label className="min-w-0 text-sm">Privacy page URL<input type="url" value={form.privacy_url} onChange={event => change("privacy_url", event.target.value)} className={fieldClass} /></label>
          <label className="min-w-0 text-sm">Terms page URL<input type="url" value={form.terms_url} onChange={event => change("terms_url", event.target.value)} className={fieldClass} /></label>
        </div>}
        {step === 1 && <div className="min-w-0 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="min-w-0 text-sm">Clerk issuer URL<input disabled={saved?.readiness.registered} type="url" placeholder="https://your-instance.clerk.accounts.dev" value={form.auth_issuer} onChange={event => change("auth_issuer", event.target.value)} className={fieldClass} /></label>
            <label className="min-w-0 text-sm">Billing currency<select value={form.currency} onChange={event => change("currency", event.target.value)} className={fieldClass}>{["USD", "CAD", "EUR", "GBP", "AUD", "NZD"].map(currency => <option key={currency}>{currency}</option>)}</select></label>
          </div>
          <h3 className="text-sm font-semibold">Stripe prices</h3>
          <div className="space-y-4">{data?.products.map(product => {
            const price = form.prices[product.key] ?? { price_id: "", amount_cents: null }
            return <div key={product.key} className="grid min-w-0 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-[1fr_2fr_1fr] sm:items-end">
              <p className="pb-2 text-sm">{product.label}</p>
              <label className="min-w-0 text-xs text-gray-600">{product.label} price ID<input value={price.price_id} placeholder="price_..." onChange={event => change("prices", { ...form.prices, [product.key]: { ...price, price_id: event.target.value } })} className={fieldClass} /></label>
              <label className="min-w-0 text-xs text-gray-600">Price in {form.currency}<input type="number" min="0" max="1000000" step="0.01" value={price.amount_cents === null ? "" : price.amount_cents / 100} onChange={event => change("prices", { ...form.prices, [product.key]: { ...price, amount_cents: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100) } })} className={fieldClass} /></label>
            </div>
          })}</div>
        </div>}
        {step === 2 && <div className="min-w-0 space-y-5">
          <label className="block max-w-md text-sm">Railway API service name<input value={form.railway_api_service} onChange={event => change("railway_api_service", event.target.value)} className={fieldClass} /></label>
          {saved && <p className="break-all text-sm">API: {saved.readiness.api_url || "Set DECISIONATE_API_URL to the public HTTPS API address, then redeploy."}</p>}
          {saved && !saved.readiness.package_ready && <div className="border-l-2 border-amber-500 pl-3 text-sm">
            <h3 className="font-medium">Missing from saved setup</h3>
            <ul className="mt-2 space-y-2">{saved.readiness.setup_checks.filter(check => !check.complete).map(check => <li key={check.key}>
              <button type="button" className="text-left text-blue-700 underline" onClick={() => setStep(check.step)}>{check.label}</button>
            </li>)}</ul>
          </div>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={!saved || dirty || !saved.readiness.package_ready} onClick={() => void run(download)} className={buttonClass}><Download size={16} />Download setup package</button>
            <span className="text-sm text-gray-500">{dirty ? "Save changes before downloading." : !saved ? "Save the brand and billing settings first." : "No credentials included."}</span>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700">
            <li>Merge the package variables into the API and workers. Keep existing application variables.</li>
            <li>Add the brand&apos;s credentials in the deployment secret store.</li>
            <li>Deploy the frontend and redeploy the API, analytics worker, ingestion worker and scheduler.</li>
          </ol>
          <button type="button" disabled={!saved || dirty} className={buttonClass} onClick={() => void run(async () => { await refresh(); setStep(3) })}><RefreshCw size={16} />Check deployment</button>
        </div>}
        {step === 3 && <div className="min-w-0 space-y-5">
          {!saved && <p className="text-sm text-gray-600">Save and deploy the setup before reviewing launch.</p>}
          {saved && <>
            <h3 className="text-sm font-semibold">{saved.readiness.configuration_complete ? "API configuration matches" : "API configuration incomplete"}</h3>
            <p className="text-sm text-gray-500">{saved.readiness.scope}</p>
            <button type="button" className={buttonClass} onClick={() => navigate("reload")}><RefreshCw size={16} />Refresh checks</button>
            {saved.completion && !saved.completion.current && <p role="status" className="border-l-2 border-amber-500 pl-3 text-sm text-amber-800">Configuration changed since the last confirmation. Review and confirm launch again.</p>}
            <details className="border-y border-gray-200 py-3"><summary className="cursor-pointer text-sm">Configuration checks: {saved.readiness.checks.filter(check => check.complete).length} / {saved.readiness.checks.length}</summary>
              <ul className="mt-3 space-y-3">{saved.readiness.checks.map(check => <li key={check.key} className="flex min-w-0 items-start gap-2 text-xs">{check.complete ? <CheckCircle2 size={16} className="shrink-0 text-green-700" /> : <Circle size={16} className="shrink-0 text-amber-600" />}<div className="min-w-0"><p className="break-all font-mono">{check.label}</p>{!check.complete && <p className="mt-1 text-gray-500">{check.detail}</p>}</div></li>)}</ul>
            </details>
            {!saved.readiness.configuration_complete && <p className="text-sm text-amber-800">Resolve the missing setup or deployment values before confirming launch tests.</p>}
            <h3 className="text-sm font-semibold">Launch tests: {form.confirmed_checks.length} / {saved.readiness.launch_checks.length}</h3>
            <div className="space-y-3">{saved.readiness.launch_checks.map((check, index) => <label key={check} className="flex items-start gap-3 text-sm"><input type="checkbox" disabled={!saved.readiness.configuration_complete} className="mt-1 shrink-0" checked={form.confirmed_checks.includes(index)} onChange={event => change("confirmed_checks", event.target.checked ? [...form.confirmed_checks, index].sort() : form.confirmed_checks.filter(value => value !== index))} /><span>{check}</span></label>)}</div>
            <p className="text-sm text-gray-500">Confirmation records your completed tests. It does not activate services or verify them automatically.</p>
            <button type="button" disabled={!canConfirmLaunch(saved, dirty)} onClick={() => void run(complete)} className={`${buttonClass} border-blue-600 bg-blue-600 text-white`}><CheckCircle2 size={16} />Confirm launch</button>
            {dirty && <p className="text-sm text-gray-600">Save the completed launch tests before confirming.</p>}
          </>}
        </div>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
          <div className="flex flex-wrap gap-3"><button type="submit" disabled={!form.id || !form.name || !form.web_url || !dirty} className={`${buttonClass} border-blue-600 bg-blue-600 text-white`}><Save size={16} />{busy ? "Working..." : step === 3 ? "Save launch tests" : "Save setup"}</button>
            {dirty && <button type="button" className={buttonClass} onClick={() => { setForm(saved?.configuration ?? { ...emptyConfiguration }); setError(""); setCustomId(!!saved) }}>Discard changes</button>}
            {step > 0 && <button type="button" className={buttonClass} onClick={() => setStep(step - 1)}><ArrowLeft size={16} />Back</button>}
            {step < 3 && <button type="button" disabled={!form.id || !form.name || !form.web_url} className={buttonClass} onClick={event => {
              if (!event.currentTarget.form?.reportValidity()) return
              if (dirty) void run(() => save(true))
              else setStep(step + 1)
            }}>{dirty ? "Save and continue" : "Continue"}<ArrowRight size={16} /></button>}
          </div>
          {saved && !saved.readiness.registered && <button type="button" title="Delete setup draft" aria-label="Delete setup draft" className={`${buttonClass} text-red-600`} onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></button>}
        </div>
        {confirmDelete && <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 border-t border-red-200 pt-4 text-sm"><p>Delete this setup draft? No workspace will be deleted.</p><button type="button" className={`${buttonClass} text-red-700`} onClick={() => void run(async () => { await whiteLabelRequest(userId, `/${encodeURIComponent(form.id)}`, { method: "DELETE" }); choose(""); await refresh(null); setMessage("Setup draft deleted.") })}>Delete draft</button><button type="button" className={buttonClass} onClick={() => setConfirmDelete(false)}>Cancel</button></div>}
      </fieldset>
    </form>
  </div>
}
