"use client"

import { useRef, useState, type ReactNode } from "react"
import { LoaderCircle, Target, X } from "lucide-react"

const field = "mt-1 block w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
export type AnalysisAction = { title: string; action: string; expected_outcome: string; review_date: string }

export function AnalysisActionForm({ evidence, children, examples, onSave, onCancel, disabled = false }: {
  evidence: string; children?: ReactNode; examples?: readonly [string, string]; disabled?: boolean
  onSave: (draft: AnalysisAction) => Promise<void>; onCancel: () => void
}) {
  const [action, setAction] = useState(""), [expected, setExpected] = useState("")
  const [review, setReview] = useState(() => {
    const date = new Date(); date.setDate(date.getDate() + 14)
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-")
  })
  const [error, setError] = useState(""), [saving, setSaving] = useState(false)
  const pending = useRef(false)
  return <form aria-label="Decision action" className="max-w-4xl space-y-3 print:hidden" onSubmit={async event => {
    event.preventDefault()
    if (pending.current || disabled || action.trim().length < 8 || expected.trim().length < 8 || !review) return
    pending.current = true; setSaving(true); setError("")
    try { await onSave({ title: action.trim().slice(0, 200), action: action.trim(), expected_outcome: expected.trim(), review_date: review }) }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create the decision. Try again.") }
    finally { pending.current = false; setSaving(false) }
  }}>
    <p className="break-words text-sm text-gray-600"><strong>Evidence:</strong> {evidence}</p>
    <fieldset disabled={disabled || saving} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="text-sm">What will you do?<textarea autoFocus className={field} required minLength={8} maxLength={5000} value={action} placeholder={examples?.[0]} onChange={e => setAction(e.target.value)} /></label>
      <label className="text-sm">What result do you expect?<textarea className={field} required minLength={8} maxLength={3000} value={expected} placeholder={examples?.[1]} onChange={e => setExpected(e.target.value)} /></label>
      {children}
      <label className="text-sm">Review on<input type="date" required className={field} value={review} onChange={e => setReview(e.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="submit" disabled={!review || action.trim().length < 8 || expected.trim().length < 8} className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Target size={16} />}{saving ? "Creating decision..." : "Create decision"}</button>
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><X size={16} />Cancel</button>
      </div>
    </fieldset>
  </form>
}
