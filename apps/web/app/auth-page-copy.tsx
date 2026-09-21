"use client"

import { useDecisionateText } from "@/app/use-decisionate-language"
import Link from "next/link"

type AuthPageCopyProps = {
  title: string
  description: string
  prompt?: string
  action?: string
}

export function AuthPageCopy({
  title,
  description,
  prompt,
  action,
}: AuthPageCopyProps) {
  const { t } = useDecisionateText()

  return (
    <>
      <h1 className="mt-5 text-3xl font-bold tracking-tight text-gray-950 sm:text-5xl">
        {t(title)}
      </h1>

      <p className="mt-4 text-lg leading-8 text-gray-600">
        {t(description)}
      </p>

      {prompt && action && (
        <p className="mt-4 text-sm text-gray-600">
          {t(prompt)}{" "}
          <span className="font-semibold text-[var(--decisionate-brand-primary-text)]">
            {t(action)}
          </span>
        </p>
      )}
    </>
  )
}

export function AuthSignupPrompt() {
  const { t } = useDecisionateText()

  return (
    <p className="text-sm text-gray-600">
      {t("New user?")} {" "}
      <Link
        href="/sign-up"
        className="font-semibold underline underline-offset-2"
      >
        {t("Create your account")}
      </Link>
    </p>
  )
}
