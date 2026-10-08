"use client"

import Link from "next/link"
import { LoaderCircle, Plus } from "lucide-react"
import type { ButtonHTMLAttributes, ComponentProps } from "react"

import { useDecisionateText } from "@/app/use-decisionate-language"

type ActionAppearance = {
  label?: string
  title?: string
  className?: string
  size?: "sm" | "md"
  variant?: "primary" | "secondary"
}

type CreateDecisionButtonProps = ActionAppearance &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "title"> & {
    creating?: boolean
  }

type CreateDecisionLinkProps = ActionAppearance &
  Omit<ComponentProps<typeof Link>, "children" | "className" | "title">

function actionClassName(
  size: ActionAppearance["size"],
  variant: ActionAppearance["variant"],
  className: string,
) {
  return [
    "inline-flex max-w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--decisionate-brand-primary-ring)] focus-visible:ring-offset-2 print:hidden",
    size === "sm" ? "h-9 px-3 text-xs" : "h-10 px-4 text-sm",
    variant === "secondary"
      ? "border border-[var(--decisionate-brand-primary-ring)] bg-white text-[var(--decisionate-brand-primary-text)] hover:bg-[var(--decisionate-brand-primary-soft)]"
      : "bg-[var(--decisionate-brand-primary)] text-[var(--decisionate-brand-primary-surface-text)] hover:opacity-90",
    "disabled:cursor-not-allowed disabled:opacity-60",
    className,
  ].join(" ")
}

export function CreateDecisionButton({
  label = "Create decision",
  title,
  className = "",
  size = "md",
  variant = "primary",
  creating = false,
  disabled = false,
  type = "button",
  ...props
}: CreateDecisionButtonProps) {
  const { t } = useDecisionateText()
  const Icon = creating ? LoaderCircle : Plus

  return (
    <button
      {...props}
      type={type}
      disabled={disabled || creating}
      aria-busy={creating}
      title={t(title ?? label)}
      className={actionClassName(size, variant, className)}
    >
      <Icon size={16} aria-hidden="true" className={creating ? "shrink-0 animate-spin" : "shrink-0"} />
      {/* Reserve both labels so pending requests cannot resize the button. */}
      <span className="grid">
        <span
          className={`col-start-1 row-start-1 ${creating ? "invisible" : ""}`}
          aria-hidden={creating || undefined}
        >
          {t(label)}
        </span>
        <span
          className={`col-start-1 row-start-1 ${creating ? "" : "invisible"}`}
          aria-hidden={!creating || undefined}
        >
          {t("Creating...")}
        </span>
      </span>
    </button>
  )
}

export function CreateDecisionLink({
  label = "Create decision",
  title,
  className = "",
  size = "md",
  variant = "primary",
  ...props
}: CreateDecisionLinkProps) {
  const { t } = useDecisionateText()

  return (
    <Link
      {...props}
      title={t(title ?? label)}
      className={actionClassName(size, variant, className)}
    >
      <Plus size={16} aria-hidden="true" className="shrink-0" />
      {t(label)}
    </Link>
  )
}
