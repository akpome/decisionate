"use client"

import {
  useEffect,
} from "react"

import {
  getBrandSurfaceTextColor,
  isInlineBrandLogoUrl,
  type WorkspaceBrand,
} from "@/lib/workspace-brand"

const workspaceFaviconAttribute =
  "data-decisionate-workspace-favicon"
const workspaceFaviconSelector =
  'link[rel~="icon"]'

type WorkspaceBrowserBrandOptions = {
  manageFavicon?: boolean
  manageManifest?: boolean
}

export function useWorkspaceBrowserBrand(
  title: string | undefined,
  brand: WorkspaceBrand,
  options: WorkspaceBrowserBrandOptions = {}
) {
  const brandName = brand.name
  const brandLogoUrl = brand.logoUrl
  const brandPrimaryColor = brand.primaryColor
  const manageFavicon =
    options.manageFavicon ?? true
  const manageManifest =
    options.manageManifest ?? true

  useEffect(() => {
    if (!title) {
      return
    }

    const previousTitle = document.title

    document.title = title

    return () => {
      if (document.title === title) {
        document.title = previousTitle
      }
    }
  }, [title])

  useEffect(() => {
    if (!manageManifest) {
      return
    }

    const manifestLink =
      document.head.querySelector<HTMLLinkElement>(
        'link[rel="manifest"]'
      )

    if (!manifestLink) {
      return
    }

    manifestLink.href =
      getWorkspaceManifestHref({
        name: brandName,
        logoUrl: brandLogoUrl,
        primaryColor: brandPrimaryColor,
      })

    // Keep the active workspace manifest in place while the next brand loads.
    // Restoring the previous default here makes the browser briefly switch
    // back to Decisionate during normal workspace and route transitions.
  }, [
    brandLogoUrl,
    brandName,
    brandPrimaryColor,
    manageManifest,
  ])

  useEffect(() => {
    if (!manageFavicon) {
      return
    }

    const cleanLogoUrl = brandLogoUrl.trim()
    const generatedLogoUrl =
      getGeneratedWorkspaceIconDataUrl(
        brandName,
        brandPrimaryColor
      )
    const defaultLogoUrl =
      "/icons/decisionate-icon.svg"
    let activeFaviconUrl =
      cleanLogoUrl ||
      generatedLogoUrl ||
      defaultLogoUrl
    const logoImage = new Image()
    let cancelled = false

    const applyFavicon = (url: string) => {
      if (cancelled) return

      const managedIconSelector =
        `${workspaceFaviconSelector}[${workspaceFaviconAttribute}="true"]`
      const iconLink =
        document.head.querySelector<HTMLLinkElement>(
          managedIconSelector
        ) ??
        document.head.querySelector<HTMLLinkElement>(
          workspaceFaviconSelector
        ) ??
        document.createElement("link")

      if (!iconLink.parentNode) {
        document.head.appendChild(iconLink)
      }

      const type = getWorkspaceFaviconType(url)

      iconLink.rel = "icon"
      iconLink.setAttribute(
        workspaceFaviconAttribute,
        "true"
      )

      if (iconLink.getAttribute("href") !== url) {
        iconLink.href = url
      }

      if (type) {
        if (iconLink.getAttribute("type") !== type) {
          iconLink.type = type
        }
      } else {
        if (iconLink.hasAttribute("type")) {
          iconLink.removeAttribute("type")
        }
      }
    }

    applyFavicon(activeFaviconUrl)

    logoImage.onload = () => {
      activeFaviconUrl = cleanLogoUrl
      applyFavicon(activeFaviconUrl)
    }

    logoImage.onerror = () => {
      activeFaviconUrl =
        generatedLogoUrl || defaultLogoUrl
      applyFavicon(activeFaviconUrl)
    }

    if (cleanLogoUrl) {
      logoImage.src = cleanLogoUrl
    }

    return () => {
      cancelled = true
      logoImage.onload = null
      logoImage.onerror = null
    }
  }, [
    brandLogoUrl,
    brandName,
    brandPrimaryColor,
    manageFavicon,
  ])
}

function getWorkspaceManifestHref(
  brand: Pick<
    WorkspaceBrand,
    "logoUrl" | "name" | "primaryColor"
  >
) {
  const logoUrl =
    isInlineBrandLogoUrl(brand.logoUrl)
      ? ""
      : brand.logoUrl
  const params = new URLSearchParams({
    name: brand.name,
    logo_url: logoUrl,
    theme_color: brand.primaryColor,
  })

  return `/manifest.webmanifest?${params.toString()}`
}

function getWorkspaceFaviconType(
  url: string
) {
  const normalizedUrl =
    url.toLowerCase().split("?")[0]

  if (
    normalizedUrl.startsWith("data:image/svg") ||
    normalizedUrl.endsWith(".svg")
  ) {
    return "image/svg+xml"
  }

  if (
    normalizedUrl.startsWith("data:image/png") ||
    normalizedUrl.endsWith(".png")
  ) {
    return "image/png"
  }

  if (
    normalizedUrl.startsWith("data:image/jpeg") ||
    normalizedUrl.endsWith(".jpg") ||
    normalizedUrl.endsWith(".jpeg")
  ) {
    return "image/jpeg"
  }

  if (
    normalizedUrl.startsWith("data:image/webp") ||
    normalizedUrl.endsWith(".webp")
  ) {
    return "image/webp"
  }

  return undefined
}

function getGeneratedWorkspaceIconDataUrl(
  brandName: string,
  primaryColor: string
) {
  const cleanName =
    brandName.trim()

  if (!cleanName || cleanName === "Decisionate") {
    return ""
  }

  const initial =
    cleanName.charAt(0).toUpperCase()
  const textColor =
    getBrandSurfaceTextColor(primaryColor)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="28" fill="${primaryColor}" />
      <text x="64" y="78" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700" fill="${textColor}">${escapeSvgText(initial)}</text>
    </svg>
  `

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function escapeSvgText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
