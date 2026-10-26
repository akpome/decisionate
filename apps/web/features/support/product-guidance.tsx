"use client"

import Link from "next/link"
import { ArrowUp, BookOpen, LoaderCircle, MessageCircle, RotateCcw, Square, Trash2 } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { askProductGuidance, type GuidanceResponse, type GuidanceTurn } from "@/lib/api"

type Message = GuidanceTurn & { id: number; response?: GuidanceResponse }
type Props = { userId: string; workspaceId: string; onContactSupport: (message: string) => void }

const starters = [
  "How do I build a report across datasets?",
  "Why is there insufficient relationship evidence?",
  "How do seasonal forecasts work?",
]

export function guidanceHistory(messages: GuidanceTurn[]): GuidanceTurn[] {
  return messages.slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 2000) }))
}

export function safeGuidanceRoute(route: string): boolean {
  return /^\/(?:dashboard(?:\/[a-z0-9-]+)*|privacy|terms|security)$/.test(route)
}

export function ProductGuidance({ userId, workspaceId, onContactSupport }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [retryQuestion, setRetryQuestion] = useState("")
  const request = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const log = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [messages, busy, error])

  function stop() {
    request.current?.abort()
    request.current = null
    setBusy(false)
  }

  function clear() {
    stop()
    setMessages([])
    setQuestion("")
    setError("")
    setRetryQuestion("")
    input.current?.focus()
  }

  async function ask(text: string, retry = false) {
    const clean = text.trim()
    if (!clean || clean.length > 2000 || !userId || !workspaceId || request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError("")
    setRetryQuestion(clean)
    const prior = retry ? messages.slice(0, -1) : messages
    if (!retry) {
      const message: Message = { id: ++sequence.current, role: "user", content: clean }
      setMessages(current => [...current, message].slice(-20))
    }
    setQuestion("")
    try {
      const response = await askProductGuidance(clean, guidanceHistory(prior), userId, workspaceId, controller.signal)
      if (controller.signal.aborted) return
      const message: Message = { id: ++sequence.current, role: "assistant", content: response.answer, response }
      setMessages(current => [...current, message].slice(-20))
      setRetryQuestion("")
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(failure instanceof Error ? failure.message : "Product guidance is unavailable. Please try again or contact support.")
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void ask(question)
  }

  function contactSupport() {
    const lastQuestion = [...messages].reverse().find(message => message.role === "user")?.content
    onContactSupport(lastQuestion ? `Product guidance question:\n${lastQuestion}\n\nWhat I need help with:\n` : "")
  }

  return (
    <section id="product-guidance" aria-labelledby="product-guidance-title" className="border-y border-gray-200 py-5 dark:border-gray-700">
      <div className="flex items-center justify-between gap-3">
        <h2 id="product-guidance-title" className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          <MessageCircle size={20} aria-hidden="true" className="shrink-0 text-blue-600" />Ask Decisionate
        </h2>
        <button type="button" onClick={clear} disabled={!messages.length && !question} title="Clear conversation" aria-label="Clear conversation" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 disabled:opacity-40">
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-2 max-w-3xl text-xs text-gray-600 dark:text-gray-400">
        Questions and recent messages may be sent to our AI provider. Do not include private records or credentials. Answers use product documentation, not your live account. <Link href="/privacy" className="text-blue-600 underline">Privacy</Link>
      </p>
      <div ref={log} role="log" aria-label="Product guidance conversation" aria-live="polite" aria-relevant="additions" className="mt-4 max-h-[480px] min-h-40 space-y-5 overflow-y-auto overscroll-contain py-2 pr-2 [overflow-wrap:anywhere]">
        {!messages.length && (
          <div className="space-y-2">
            <p className="text-sm font-medium">What would you like help with?</p>
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              {starters.map(starter => <button key={starter} type="button" disabled={busy || !userId || !workspaceId} onClick={() => void ask(starter)} className="max-w-full text-left text-sm text-blue-600 underline decoration-blue-200 underline-offset-4 disabled:opacity-50">{starter}</button>)}
            </div>
          </div>
        )}
        {messages.map(message => (
          <article key={message.id} className={message.role === "user" ? "border-l-2 border-blue-500 pl-3" : "space-y-2"}>
            <p className="text-xs font-semibold text-gray-500">{message.role === "user" ? "You" : message.response?.mode === "ai" ? "Decisionate · AI answer" : "Decisionate · Documentation"}</p>
            <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
            {message.response?.sources.map(source => (
              <details key={source.chunk_id} className="border-l border-gray-200 pl-3 text-xs dark:border-gray-700">
                <summary className="cursor-pointer py-1 text-blue-600">{source.title} · {source.section}</summary>
                <p className="my-2 whitespace-pre-wrap leading-5 text-gray-600 dark:text-gray-300">{source.content}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-2">
                  {safeGuidanceRoute(source.route) && <Link href={source.route} className="inline-flex items-center gap-1 text-blue-600 underline"><BookOpen size={13} aria-hidden="true" />Open page</Link>}
                  <span className="text-gray-500">Documentation reviewed {source.reviewed_on}</span>
                </div>
              </details>
            ))}
          </article>
        ))}
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-gray-500"><LoaderCircle size={16} aria-hidden="true" className="animate-spin" />Finding guidance...</p>}
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600"><p>{error}</p><button type="button" onClick={() => void ask(retryQuestion, true)} className="inline-flex items-center gap-1 underline"><RotateCcw size={14} aria-hidden="true" />Retry</button></div>}
      </div>
      <form onSubmit={submit} className="mt-4">
        <label htmlFor="guidance-question" className="text-sm font-medium">Your question</label>
        <div className="mt-2 flex items-end gap-2">
          <textarea ref={input} id="guidance-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} rows={2} placeholder="Ask about reports, forecasts, connections or decisions" disabled={!userId || !workspaceId} className="min-h-20 min-w-0 flex-1 resize-y rounded-md border border-gray-300 bg-transparent p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }} />
          {busy ? <button type="button" onClick={stop} title="Stop waiting" aria-label="Stop waiting" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300"><Square size={16} aria-hidden="true" /></button> : <button type="submit" disabled={!question.trim() || !userId || !workspaceId} title="Send question" aria-label="Send question" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white disabled:opacity-40"><ArrowUp size={19} aria-hidden="true" /></button>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
          <span>{question.length}/2,000</span>
          <button type="button" onClick={contactSupport} className="text-blue-600 underline">Contact support</button>
        </div>
      </form>
    </section>
  )
}
