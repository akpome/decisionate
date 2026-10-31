"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { performancePath, toolLabels, type ToolKind } from "@/features/performance/types"

export function AnalysisTools({ active = "metrics" }: { active?: "metrics" | ToolKind }) {
  const router = useRouter()
  const items = [
      { key: "metrics", label: "Compare metrics", href: "/dashboard/reports" },
      ...Object.entries(toolLabels).map(([key, label]) => ({ key, label, href: performancePath(key as ToolKind) })),
  ]
  return <nav aria-label="Business analysis tools" className="border-b border-gray-200 pb-3 text-sm print:hidden">
    <label className="block text-xs text-gray-600 lg:hidden">Analysis tool<select aria-label="Analysis tool" className="mt-1 min-h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950" value={active}
      onChange={event => router.push(items.find(item => item.key === event.target.value)!.href)}>{items.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
    <div className="hidden flex-wrap gap-x-6 gap-y-3 lg:flex">{items.map(item => <Link key={item.key} href={item.href} aria-current={active === item.key ? "page" : undefined}
      className={`min-h-10 content-center ${active === item.key ? "font-semibold text-blue-700 underline underline-offset-8" : "text-gray-600 hover:text-gray-950"}`}>{item.label}</Link>)}
    </div>
  </nav>
}
