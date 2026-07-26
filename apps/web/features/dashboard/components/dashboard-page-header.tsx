import type { ReactNode } from "react"

type DashboardPageHeaderProps = {
  title: ReactNode
  description: ReactNode
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
  return (
    <header
      className={`flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between ${className}`.trim()}
    >
      <div className="min-w-0">
        {leading && (
          <div className="mb-3">
            {leading}
          </div>
        )}

        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--decisionate-brand-primary-text)]">
            {eyebrow}
          </p>
        )}

        <h1 className="break-words text-3xl font-bold tracking-tight text-gray-950">
          {title}
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
          {description}
        </p>
      </div>

      {actions && (
        <div className="flex min-w-0 flex-wrap items-start gap-3 lg:justify-end">
          {actions}
        </div>
      )}
    </header>
  )
}
