"use client"

import { useLayoutEffect } from "react"

const workspaceFaviconAttribute =
  "data-decisionate-workspace-favicon"
const workspaceFaviconSelector =
  'link[rel~="icon"]'
const pendingWorkspaceIconUrl =
  "/icons/workspace-pending.svg"
const defaultIconUrl = "/icons/decisionate-icon.svg"

export function WorkspaceFaviconBootstrap() {
  useLayoutEffect(() => {
    const path = window.location.pathname
    const isWorkspaceRoute =
      path.startsWith("/dashboard") ||
      path.startsWith("/share")
    const iconUrl = isWorkspaceRoute
      ? pendingWorkspaceIconUrl
      : defaultIconUrl
    const iconLinks = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>(
        workspaceFaviconSelector
      )
    )
    const links = iconLinks.length
      ? iconLinks
      : [document.createElement("link")]

    links.forEach((link) => {
      if (!link.parentNode) {
        document.head.appendChild(link)
      }
      link.rel = "icon"
      link.type = "image/svg+xml"
      link.href = iconUrl
      if (isWorkspaceRoute) {
        link.setAttribute(
          workspaceFaviconAttribute,
          "true"
        )
      }
    })
  }, [])

  return null
}
