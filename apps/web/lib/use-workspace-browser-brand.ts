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
const workspaceBrandStoragePrefix =
  "decisionate:workspace-brand:"
const pendingWorkspaceIconUrl =
  "/icons/workspace-pending.svg"

type WorkspaceBrowserBrandOptions = {
  manageFavicon?: boolean
  manageManifest?: boolean
  keepFaviconStable?: boolean
  workspaceKey?: string
  brandReady?: boolean
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
  const keepFaviconStable =
    options.keepFaviconStable ?? false
  const workspaceKey =
    options.workspaceKey?.trim() || ""
  const brandReady =
    options.brandReady ?? true

  useEffect(() => {
    if (!brandReady || !workspaceKey) {
      return
    }

    try {
      window.localStorage.setItem(
        `${workspaceBrandStoragePrefix}${workspaceKey}`,
        JSON.stringify(brand)
      )
    } catch {
      // Browser branding cache is best-effort.
    }
  }, [
    brand,
    brandReady,
    workspaceKey,
  ])

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

    const cachedBrand =
      readCachedWorkspaceBrand(workspaceKey)
    const effectiveBrand =
      brandReady
        ? brand
        : cachedBrand
    const manifestLink =
      document.head.querySelector<HTMLLinkElement>(
        'link[rel="manifest"]'
      )

    if (!manifestLink) {
      return
    }

    manifestLink.href =
      getWorkspaceManifestHref({
        name: effectiveBrand?.name || "Workspace",
        logoUrl: effectiveBrand?.logoUrl || pendingWorkspaceIconUrl,
        primaryColor:
          effectiveBrand?.primaryColor || brandPrimaryColor,
      })

    // Keep the active workspace manifest in place while the next brand loads.
    // Restoring the previous default here makes the browser briefly switch
    // back to Decisionate during normal workspace and route transitions.
  }, [
    brand,
    brandLogoUrl,
    brandName,
    brandPrimaryColor,
    brandReady,
    manageManifest,
    workspaceKey,
  ])

  useEffect(() => {
    if (!manageFavicon) {
      return
    }

    const cachedBrand =
      readCachedWorkspaceBrand(workspaceKey)
    const effectiveBrand =
      brandReady
        ? brand
        : cachedBrand
    const effectiveBrandName =
      effectiveBrand?.name?.trim() || "Workspace"
    const effectiveBrandLogoUrl =
      effectiveBrand?.logoUrl?.trim() || ""
    const effectiveBrandPrimaryColor =
      effectiveBrand?.primaryColor || brandPrimaryColor
    const cleanLogoUrl = effectiveBrandLogoUrl
    const generatedLogoUrl =
      effectiveBrand
        ? getGeneratedWorkspaceIconDataUrl(
            effectiveBrandName,
            effectiveBrandPrimaryColor
          )
        : ""
    const defaultLogoUrl =
      "/icons/decisionate-icon.svg"
    const unresolvedLogoUrl =
      pendingWorkspaceIconUrl
    let activeFaviconUrl =
      cleanLogoUrl ||
      generatedLogoUrl ||
      (brandReady ? defaultLogoUrl : unresolvedLogoUrl)
    const logoImage = new Image()
    let cancelled = false
    let faviconHeadObserver:
      MutationObserver | null = null

    const applyFavicon = (url: string) => {
      if (cancelled) return

      const iconLinks = Array.from(
        document.head.querySelectorAll<HTMLLinkElement>(
          workspaceFaviconSelector
        )
      )
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

      const linksToUpdate = keepFaviconStable
        ? Array.from(
          new Set([
            ...iconLinks,
            iconLink,
          ])
        )
        : [iconLink]

      const type = getWorkspaceFaviconType(url)

      linksToUpdate.forEach(link => {
        if (link.rel !== "icon") {
          link.rel = "icon"
        }

        if (
          link.getAttribute(
            workspaceFaviconAttribute
          ) !== "true"
        ) {
          link.setAttribute(
            workspaceFaviconAttribute,
            "true"
          )
        }

        if (link.getAttribute("href") !== url) {
          link.href = url
        }

        if (type) {
          if (link.getAttribute("type") !== type) {
            link.type = type
          }
        } else if (link.hasAttribute("type")) {
          link.removeAttribute("type")
        }
      })
    }

    applyFavicon(activeFaviconUrl)

    logoImage.onload = () => {
      activeFaviconUrl = cleanLogoUrl
      applyFavicon(activeFaviconUrl)
    }

    logoImage.onerror = () => {
      activeFaviconUrl =
        generatedLogoUrl ||
        (brandReady ? defaultLogoUrl : unresolvedLogoUrl)
      applyFavicon(activeFaviconUrl)
    }

    if (cleanLogoUrl) {
      logoImage.src = cleanLogoUrl
    }

    const refreshFavicon = () => {
      applyFavicon(activeFaviconUrl)
    }
    const faviconInterval =
      keepFaviconStable
        ? window.setInterval(
          refreshFavicon,
          1000
        )
        : null

    if (keepFaviconStable) {
      faviconHeadObserver =
        new MutationObserver(() => {
          applyFavicon(activeFaviconUrl)
        })
      faviconHeadObserver.observe(
        document.head,
        { childList: true }
      )
      window.addEventListener(
        "focus",
        refreshFavicon
      )
      window.addEventListener(
        "pageshow",
        refreshFavicon
      )
    }

    return () => {
      cancelled = true
      if (faviconInterval !== null) {
        window.clearInterval(
          faviconInterval
        )
      }
      if (keepFaviconStable) {
        faviconHeadObserver?.disconnect()
        window.removeEventListener(
          "focus",
          refreshFavicon
        )
        window.removeEventListener(
          "pageshow",
          refreshFavicon
        )
      }
      logoImage.onload = null
      logoImage.onerror = null
    }
  }, [
    brand,
    brandLogoUrl,
    brandName,
    brandPrimaryColor,
    brandReady,
    keepFaviconStable,
    manageFavicon,
    workspaceKey,
  ])
}

function readCachedWorkspaceBrand(
  workspaceKey: string
): WorkspaceBrand | null {
  if (!workspaceKey || typeof window === "undefined") {
    return null
  }

  try {
    const value = window.localStorage.getItem(
      `${workspaceBrandStoragePrefix}${workspaceKey}`
    )
    if (!value) {
      return null
    }

    const parsed = JSON.parse(value)
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.name !== "string" ||
      typeof parsed.logoUrl !== "string" ||
      typeof parsed.primaryColor !== "string" ||
      typeof parsed.accentColor !== "string"
    ) {
      return null
    }

    return parsed as WorkspaceBrand
  } catch {
    return null
  }
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
