"use client"

import type { ReactNode } from "react"
import { useDecisionateText } from "@/app/use-decisionate-language"

type DashboardPageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
  leading?: ReactNode
  className?: string
}

export function DashboardPageHeader({
  title,
  description,
  actions,
  eyebrow,
  leading,
  className = "",
}: DashboardPageHeaderProps) {
  const { t } = useDecisionateText()
  const translateNode = (node: ReactNode) =>
    typeof node === "string" ? t(node) : node

  return (
    <header
      className={`flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between ${className}`.trim()}
    >
      <div className="min-w-0 sm:flex-1 sm:basis-64">
        {leading && (
          <div className="mb-3">
            {leading}
          </div>
        )}

        {eyebrow && (
          <p className="mb-1 text-xs font-semibold text-[var(--decisionate-brand-primary-text)]">
            {translateNode(eyebrow)}
          </p>
        )}

        <h1 className="break-words text-2xl font-semibold leading-8 text-gray-950">
          {translateNode(title)}
        </h1>

        {description && (
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
            {translateNode(description)}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  )
}
