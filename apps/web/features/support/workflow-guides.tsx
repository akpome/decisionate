"use client"

import { ArrowUpRight, ChevronDown, Search } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { canonicalWorkspacePathname } from "@/lib/application-routes"
import { safeGuidanceRoute } from "./product-guidance"
import guideData from "./workflow-guides.generated.json"

export function filterWorkflowGuides(query: string, category: string) {
  const terms = query.trim().toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return guideData.flatMap(group => {
    if (category && group.id !== category) return []
    const articles = group.articles.flatMap(article => {
      if (!terms.length) return [article]
      const sections = article.sections.filter(section => {
        const text = [group.label, article.title, section.title, ...section.questions, section.body].join(" ").toLowerCase()
        return terms.every(term => text.includes(term))
      })
      return sections.length ? [{ ...article, sections }] : []
    })
    return articles.length ? [{ ...group, articles }] : []
  })
}

function guideText(body: string) {
  return body.replace(/^#{1,6} /gm, "").replace(/`|\*\*/g, "")
    .replace(/([^\n])\n(?!\n|\s*(?:\d+\.|[-*]|\|))/g, "$1 ")
}

export function guideCopy(body: string) {
  const appLink = /\[([^\]\n]+)\]\((\/[a-z0-9/-]+)\)/g
  const text = guideText(body)
  const segments = []
  let offset = 0
  for (const match of text.matchAll(appLink)) {
    const [token, label, route] = match
    const start = match.index
    if (!safeGuidanceRoute(route)) continue
    segments.push(text.slice(offset, start), <Link key={start} href={canonicalWorkspacePathname(route)} prefetch={false}
      className="font-medium text-blue-700 underline">{label}</Link>)
    offset = start + token.length
  }
  segments.push(text.slice(offset))
  return segments
}

type GuideArticle = (typeof guideData)[number]["articles"][number]

function ArticleGuide({ article, expanded }: { article: GuideArticle; expanded: boolean }) {
  const [opened, setOpened] = useState(false)
  return <details open={expanded || undefined} onToggle={event => setOpened(event.currentTarget.open)} className="group/guide border-b border-gray-200">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium">
      <span className="min-w-0 break-words">{article.title}</span>
      <ChevronDown size={16} aria-hidden="true" className="shrink-0 group-open/guide:rotate-180" />
    </summary>
    {(opened || expanded) && <div className="space-y-5 pb-4">
      {article.sections.map(section => <section key={section.id} className="max-w-3xl border-l border-gray-200 pl-4">
        <h4 className="text-sm font-semibold">{section.title}</h4>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{guideCopy(section.body)}</p>
        {safeGuidanceRoute(section.route) && section.route !== "/help" && <Link href={canonicalWorkspacePathname(section.route)} prefetch={false}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 underline">
          Open page <ArrowUpRight size={13} aria-hidden="true" />
        </Link>}
      </section>)}
    </div>}
  </details>
}

export default function WorkflowGuides() {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const groups = filterWorkflowGuides(query, category)
  return <div className="mt-4 space-y-5">
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
      <label className="min-w-0 text-xs font-medium text-gray-600">
        Search workflow guides
        <span className="relative mt-1 block">
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-gray-500" />
          <input type="search" value={query} maxLength={120} onChange={event => setQuery(event.target.value)}
            className="h-10 w-full min-w-0 rounded-md border border-gray-300 bg-transparent pl-9 pr-3 text-sm text-gray-950" />
        </span>
      </label>
      <label className="min-w-0 text-xs font-medium text-gray-600">
        Topic
        <select value={category} onChange={event => setCategory(event.target.value)}
          className="mt-1 h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950">
          <option value="">All topics</option>
          {guideData.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
        </select>
      </label>
    </div>
    {!groups.length && <p role="status" className="text-sm text-gray-600">No workflow guides match your search.</p>}
    {groups.map(group => <section key={group.id} aria-labelledby={`workflow-topic-${group.id}`}>
      <h3 id={`workflow-topic-${group.id}`} className="border-b border-gray-200 pb-2 text-sm font-semibold">{group.label}</h3>
      {group.articles.map(article => <ArticleGuide key={article.id} article={article} expanded={Boolean(query.trim())} />)}
    </section>)}
  </div>
}
