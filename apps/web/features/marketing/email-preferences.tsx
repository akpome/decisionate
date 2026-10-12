"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Save } from "lucide-react"
import { getMarketingConsent, marketingRequest, type MarketingConsentRequest, type MarketingContact } from "@/lib/api"
import { storeMarketingChoice } from "@/features/auth/lib/marketing-consent"
import { useDecisionateText } from "@/app/use-decisionate-language"

function ConsentIdentity({ config }: { config: MarketingConsentRequest }) {
  const { t } = useDecisionateText()
  return <p className="whitespace-pre-line break-words text-xs leading-5 text-gray-500">{config.sender_identity}{"\n"}{config.mailing_address}{"\n"}<a href={`mailto:${config.reply_to}`} className="underline">{config.reply_to}</a>{" · "}<Link href="/privacy" target="_blank" className="underline">{t("Privacy Policy")}</Link></p>
}

export function SignupMarketingOptIn() {
  const [config, setConfig] = useState<MarketingConsentRequest | null>(null)
  const [checked, setChecked] = useState(false)
  const { t, language } = useDecisionateText()
  useEffect(() => {
    let cancelled = false
    void getMarketingConsent(language).then(result => {
      if (!cancelled) { storeMarketingChoice(false, result.version, result.language); setChecked(false); setConfig(result) }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [language])
  if (!config?.available) return null
  return <div className="space-y-2">
    <label className="flex items-start gap-3 text-sm leading-6 text-gray-700">
      <input type="checkbox" checked={checked} onChange={event => {
        setChecked(event.target.checked)
        storeMarketingChoice(event.target.checked, config.version, config.language)
      }} className="mt-1 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]" />
      <span>{t(config.text)} <span className="text-gray-500">{t("Optional")}</span></span>
    </label>
    <ConsentIdentity config={config} />
  </div>
}

export function EmailPreferences({ userId }: { userId: string }) {
  const [config, setConfig] = useState<MarketingConsentRequest | null>(null)
  const [contact, setContact] = useState<MarketingContact | null>(null)
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("")
  const { t, language } = useDecisionateText()
  useEffect(() => {
    let cancelled = false
    void Promise.all([getMarketingConsent(language), marketingRequest<MarketingContact>(userId, "/preferences")]).then(([consent, current]) => {
      if (cancelled) return
      setConfig(consent); setContact(current)
      setChecked(["subscribed", "pending_confirmation"].includes(current.marketing_status))
    }).catch(error => { if (!cancelled) setStatus(error instanceof Error ? error.message : "Email preferences are unavailable") })
    return () => { cancelled = true }
  }, [userId, language])
  async function save() {
    if (!config) return
    setSaving(true); setStatus("")
    try {
      const result = await marketingRequest<MarketingContact>(userId, "/preferences", { method: "PUT", body: JSON.stringify({ subscribed: checked, consent_version: config.version, language: config.language }) })
      setContact(result); setStatus(result.marketing_status === "pending_confirmation" ? "Verify your email address to receive marketing emails." : "Email preferences saved.")
    } catch (error) { setStatus(error instanceof Error ? error.message : "Email preferences could not be updated") }
    finally { setSaving(false) }
  }
  return <section className="border-y border-gray-200 py-6">
    <h2 className="text-xl font-semibold">{t("Email preferences")}</h2>
    <div className="mt-4 space-y-3">
      <label className="flex items-start gap-3 text-sm leading-6">
        <input type="checkbox" checked={checked} disabled={!contact || saving || !config?.available || !!contact.suppression_reason} onChange={event => setChecked(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]" />
        <span>{t(config?.text ?? "Send me Decisionate product updates, tips and offers. I can unsubscribe at any time.")}</span>
      </label>
      {config?.available && <ConsentIdentity config={config} />}
      {config && !config.available && <p className="text-sm text-gray-500">{t("Marketing subscriptions are not available yet.")}</p>}
      {contact?.suppression_reason && <p className="text-sm text-rose-700">{t("This address is suppressed. Contact support before subscribing.")}</p>}
      <button type="button" onClick={() => void save()} disabled={saving || !contact || (!config?.available && checked)} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium disabled:opacity-50"><Save size={16} aria-hidden="true" />{t(saving ? "Saving..." : "Save preferences")}</button>
      {status && <p role="status" className="text-sm">{t(status)}</p>}
    </div>
  </section>
}
