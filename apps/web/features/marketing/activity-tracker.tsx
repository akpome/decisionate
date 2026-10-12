"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { useUser } from "@clerk/nextjs"
import { marketingRequest } from "@/lib/api"

export function MarketingActivityTracker() {
  const pathname = usePathname()
  const { user } = useUser()
  useEffect(() => {
    if (!user) return
    const content = new URLSearchParams(window.location.search).get("utm_content")
    const messageId = content?.match(/^lifecycle-(\d+)$/)?.[1]
    const meaningful = /^\/dashboard(?:$|\/(?:dashboards|insights|decisions)(?:\/|$))/.test(pathname)
    if (!meaningful && !messageId) return
    const timer = window.setTimeout(() => {
      const event = !meaningful ? "link_visit" : pathname.includes("/insights") ? "insight_review" : pathname.includes("/decisions") ? "decision_review" : "dashboard_view"
      if (document.visibilityState === "visible") void marketingRequest(user.id, "/activity", { method: "POST", body: JSON.stringify({ event, message_id: messageId ? Number(messageId) : null }) }).catch(() => {})
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [pathname, user])
  return null
}
