"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Grid2X2 } from "lucide-react"
import { correlationRequest } from "@/lib/api"
import { useDecisionateText } from "@/app/use-decisionate-language"
import type { CorrelationCapabilities } from "./types"

export function CorrelationEntry({ userId, workspaceId }: { userId?: string; workspaceId?: string }) {
  const { t } = useDecisionateText()
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let current = true
    if (userId) correlationRequest<CorrelationCapabilities>(userId, "/correlation-capabilities", {}, workspaceId)
      .then(value => { if (current) setAvailable(value.ui) }).catch(() => { if (current) setAvailable(false) })
    return () => { current = false }
  }, [userId, workspaceId])
  if (!available) return null
  return <Link href="/dashboard/relationships/explorer" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium"><Grid2X2 size={16} aria-hidden="true" />{t("Compare multiple metrics")}</Link>
}
