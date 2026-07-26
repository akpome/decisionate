"use client"

import {
  useState,
} from "react"
import {
  defaultBrandPrimaryColor,
  getBrandSurfaceTextColor,
  isValidBrandColor,
} from "@/lib/workspace-brand"

type WorkspaceBrandMarkProps = {
  name: string
  logoUrl?: string | null
  primaryColor?: string | null
  className?: string
}

export function WorkspaceBrandMark({
  name,
  logoUrl,
  primaryColor,
  className = "",
}: WorkspaceBrandMarkProps) {
  const cleanName = name.trim()
  const cleanLogoUrl =
    logoUrl?.trim() || ""
  const [
    failedLogoUrl,
    setFailedLogoUrl,
  ] = useState<string | null>(null)
  const brandColor =
    primaryColor &&
    isValidBrandColor(primaryColor)
      ? primaryColor
      : defaultBrandPrimaryColor
  const showLogo =
    Boolean(cleanLogoUrl) &&
    failedLogoUrl !== cleanLogoUrl

  return (
    <span
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center overflow-hidden font-bold ${className}`}
      style={{
        backgroundColor: showLogo
          ? "transparent"
          : brandColor,
        color: showLogo
          ? "transparent"
          : getBrandSurfaceTextColor(
              brandColor
            ),
      }}
    >
      <span>
        {cleanName.charAt(0).toUpperCase() || "D"}
      </span>

      {showLogo && (
        // A remote workspace logo can fail after it is saved. Keep the initial underneath as a resilient fallback.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={cleanLogoUrl}
          src={cleanLogoUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-contain p-0"
          onError={() => {
            setFailedLogoUrl(
              cleanLogoUrl
            )
          }}
        />
      )}
    </span>
  )
}
