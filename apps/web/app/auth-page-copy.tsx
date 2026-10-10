"use client"

import { useDecisionateText } from "@/app/use-decisionate-language"

type AuthPageCopyProps = {
  title: string
  description: string
}

export function AuthPageCopy({
  title,
  description,
}: AuthPageCopyProps) {
  const { t } = useDecisionateText()

  return (
    <>
      <h1 className="text-2xl font-semibold text-gray-950">
        {t(title)}
      </h1>

      <p className="mt-2 text-sm leading-6 text-gray-600">
        {t(description)}
      </p>

    </>
  )
}
