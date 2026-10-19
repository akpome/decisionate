"use client"

import Link from "next/link"
import { FileText, GitCompare, Table2 } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"

const destinations = [
  { key: "reports", href: "/dashboard/reports", label: "Reports", icon: FileText },
  { key: "relationships", href: "/dashboard/relationships", label: "Relationships", icon: GitCompare },
  { key: "dataset-reports", href: "/dashboard/reports/dataset", label: "Dataset reports", icon: Table2 },
] as const

export function AnalysisNavigation({ active }: { active: typeof destinations[number]["key"] }) {
  const { t } = useDecisionateText()

  return (
    <nav aria-label={t("Analysis navigation")} className="flex min-w-0 border-b border-gray-200 print:hidden">
      {destinations.map(({ key, href, label, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={`inline-flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 border-b-2 px-2 py-2 text-center text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:min-h-12 sm:flex-none sm:flex-row sm:gap-2 sm:px-4 sm:py-3 sm:text-sm ${active === key ? "border-blue-600 bg-blue-50 text-blue-800" : "border-transparent text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950"}`}
        >
          <Icon size={17} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 break-words">{t(label)}</span>
        </Link>
      ))}
    </nav>
  )
}
