import type {
  OrganizationRecord,
  OrganizationWorkspaceRecord,
} from "@/lib/api"

export const defaultBrandPrimaryColor = "#2563EB"
export const defaultBrandAccentColor = "#14B8A6"
export const decisionateBrandLogoUrl =
  "/icons/decisionate-icon.svg"
export const maxBrandLogoUrlLength = 250_000
export const maxBrandLogoUploadBytes = 150_000
export const supportedBrandLogoMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const

export type WorkspaceBrand = {
  name: string
  logoUrl: string
  primaryColor: string
  accentColor: string
}

export type WorkspaceBrandPayload = {
  name?: string | null
  logo_url?: string | null
  primary_color?: string | null
  accent_color?: string | null
}

export const defaultWorkspaceBrand: WorkspaceBrand = {
  name: "Decisionate",
  logoUrl: decisionateBrandLogoUrl,
  primaryColor: defaultBrandPrimaryColor,
  accentColor: defaultBrandAccentColor,
}

export function getWorkspaceBrand(
  activeWorkspaceId: string,
  userId: string | undefined,
  organization: OrganizationRecord | null,
  workspaces: OrganizationWorkspaceRecord[],
  fullName: string | null | undefined
): WorkspaceBrand {
  if (!userId || !activeWorkspaceId) {
    return defaultWorkspaceBrand
  }

  const fallbackName =
    organization?.report_display_name ||
    organization?.name ||
    fullName ||
    defaultWorkspaceBrand.name

  if (activeWorkspaceId === userId) {
    if (!organization) {
      return defaultWorkspaceBrand
    }

    return {
      name: fallbackName,
      logoUrl:
        organization.logo_url?.trim() || "",
      primaryColor: getSafeBrandColor(
        organization.primary_color,
        defaultBrandPrimaryColor
      ),
      accentColor: getSafeBrandColor(
        organization.accent_color,
        defaultBrandAccentColor
      ),
    }
  }

  const workspace =
    workspaces.find(
      (item) =>
        item.owner_user_id === activeWorkspaceId
    )

  if (!workspace) {
    return defaultWorkspaceBrand
  }

  return {
    name:
      workspace.report_display_name ||
      workspace.name ||
      fallbackName,
    logoUrl: getWorkspacePortalLogoUrl(
      workspace
    ),
    primaryColor: getSafeBrandColor(
      workspace.primary_color,
      defaultBrandPrimaryColor
    ),
    accentColor: getSafeBrandColor(
      workspace.accent_color,
      defaultBrandAccentColor
    ),
  }
}

export function getWorkspaceBrandFromPayload(
  branding: WorkspaceBrandPayload | null | undefined
): WorkspaceBrand {
  if (!branding) {
    return defaultWorkspaceBrand
  }

  const name =
    branding.name?.trim() ||
    defaultWorkspaceBrand.name
  const logoUrl =
    branding.logo_url?.trim() || ""
  const primaryColor =
    branding.primary_color?.trim() || ""
  const accentColor =
    branding.accent_color?.trim() || ""
  const defaultDecisionatePayload =
    !logoUrl &&
    name === defaultWorkspaceBrand.name &&
    (
      !primaryColor ||
      primaryColor.toUpperCase() ===
        defaultBrandPrimaryColor
    ) &&
    (
      !accentColor ||
      accentColor.toUpperCase() ===
        defaultBrandAccentColor
    )

  return {
    name,
    logoUrl:
      logoUrl ||
      (
        defaultDecisionatePayload
          ? defaultWorkspaceBrand.logoUrl
          : ""
    ),
    primaryColor: getSafeBrandColor(
      primaryColor,
      defaultBrandPrimaryColor
    ),
    accentColor: getSafeBrandColor(
      accentColor,
      defaultBrandAccentColor
    ),
  }
}

export function getBrandColorWithAlpha(
  color: string,
  alpha: string
) {
  if (
    !isValidBrandColor(color) ||
    !/^[0-9a-fA-F]{2}$/.test(alpha)
  ) {
    return color
  }

  return `${color}${alpha}`
}

export function getReadableBrandTextColor(
  color: string | null | undefined,
  fallbackColor = defaultBrandPrimaryColor,
  backgroundColor = "#FFFFFF"
) {
  const safeColor =
    getSafeBrandColor(color, fallbackColor)
  const safeBackgroundColor =
    getSafeBrandColor(backgroundColor, "#FFFFFF")

  if (
    getColorContrastRatio(
      safeColor,
      safeBackgroundColor
    ) >= 4.5
  ) {
    return safeColor
  }

  const colorRgb =
    getRgbColor(safeColor)
  const backgroundRgb =
    getRgbColor(safeBackgroundColor)

  if (!colorRgb || !backgroundRgb) {
    return getBestContrastTextColor(
      safeBackgroundColor
    )
  }

  const targetRgb =
    getRelativeLuminance(backgroundRgb) > 0.5
      ? {
        red: 0,
        green: 0,
        blue: 0,
      }
      : {
        red: 255,
        green: 255,
        blue: 255,
      }

  for (
    let blendAmount = 0.08;
    blendAmount <= 1;
    blendAmount += 0.08
  ) {
    const candidateColor =
      getHexColorFromRgb(
        blendRgbColors(
          colorRgb,
          targetRgb,
          blendAmount
        )
      )

    if (
      getColorContrastRatio(
        candidateColor,
        safeBackgroundColor
      ) >= 4.5
    ) {
      return candidateColor
    }
  }

  return getBestContrastTextColor(
    safeBackgroundColor
  )
}

export function getBrandSurfaceTextColor(
  backgroundColor: string | null | undefined,
  fallbackColor = defaultBrandPrimaryColor
) {
  const safeBackgroundColor =
    getSafeBrandColor(
      backgroundColor,
      fallbackColor
    )

  return getBestContrastTextColor(
    safeBackgroundColor
  )
}

export function isValidBrandColor(
  color: string
) {
  return /^#[0-9a-fA-F]{6}$/.test(color)
}

export function isValidBrandLogoUrl(
  logoUrl: string
) {
  const cleanLogoUrl = logoUrl.trim()

  if (!cleanLogoUrl) {
    return true
  }

  if (
    cleanLogoUrl.length >
    maxBrandLogoUrlLength
  ) {
    return false
  }

  if (isInlineBrandLogoUrl(cleanLogoUrl)) {
    return true
  }

  try {
    const parsedLogoUrl = new URL(cleanLogoUrl)

    return (
      Boolean(parsedLogoUrl.hostname) &&
      (
        parsedLogoUrl.protocol === "https:" ||
        parsedLogoUrl.protocol === "http:"
      )
    )
  } catch {
    return false
  }
}

export function isInlineBrandLogoUrl(
  logoUrl: string
) {
  const cleanLogoUrl =
    logoUrl.trim().toLowerCase()

  return supportedBrandLogoMimeTypes.some(
    (mimeType) =>
      cleanLogoUrl.startsWith(
        `data:${mimeType};base64,`
      )
  )
}

function getSafeBrandColor(
  color: string | null | undefined,
  fallbackColor: string
) {
  return color && isValidBrandColor(color)
    ? color
    : fallbackColor
}

function getWorkspacePortalLogoUrl(
  workspace: OrganizationWorkspaceRecord | undefined
) {
  return workspace?.logo_url?.trim() || ""
}

function getRgbColor(
  color: string
) {
  if (!isValidBrandColor(color)) {
    return null
  }

  return {
    red: Number.parseInt(
      color.slice(1, 3),
      16
    ),
    green: Number.parseInt(
      color.slice(3, 5),
      16
    ),
    blue: Number.parseInt(
      color.slice(5, 7),
      16
    ),
  }
}

function getHexColorFromRgb({
  red,
  green,
  blue,
}: {
  red: number
  green: number
  blue: number
}) {
  return `#${[
    red,
    green,
    blue,
  ]
    .map((value) =>
      Math.round(value)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")
    .toUpperCase()}`
}

function blendRgbColors(
  color: {
    red: number
    green: number
    blue: number
  },
  targetColor: {
    red: number
    green: number
    blue: number
  },
  amount: number
) {
  return {
    red:
      color.red +
      (targetColor.red - color.red) *
        amount,
    green:
      color.green +
      (targetColor.green - color.green) *
        amount,
    blue:
      color.blue +
      (targetColor.blue - color.blue) *
        amount,
  }
}

function getColorContrastRatio(
  foregroundColor: string,
  backgroundColor: string
) {
  const foregroundRgb =
    getRgbColor(foregroundColor)
  const backgroundRgb =
    getRgbColor(backgroundColor)

  if (!foregroundRgb || !backgroundRgb) {
    return 0
  }

  const foregroundLuminance =
    getRelativeLuminance(foregroundRgb)
  const backgroundLuminance =
    getRelativeLuminance(backgroundRgb)
  const lighterLuminance =
    Math.max(
      foregroundLuminance,
      backgroundLuminance
    )
  const darkerLuminance =
    Math.min(
      foregroundLuminance,
      backgroundLuminance
    )

  return (
    (lighterLuminance + 0.05) /
    (darkerLuminance + 0.05)
  )
}

function getRelativeLuminance({
  red,
  green,
  blue,
}: {
  red: number
  green: number
  blue: number
}) {
  const [
    linearRed,
    linearGreen,
    linearBlue,
  ] = [
    red,
    green,
    blue,
  ].map((channel) => {
    const normalizedChannel =
      channel / 255

    return normalizedChannel <= 0.03928
      ? normalizedChannel / 12.92
      : ((normalizedChannel + 0.055) / 1.055) **
          2.4
  })

  return (
    0.2126 * linearRed +
    0.7152 * linearGreen +
    0.0722 * linearBlue
  )
}

function getBestContrastTextColor(
  backgroundColor: string
) {
  const darkTextColor = "#111827"
  const lightTextColor = "#FFFFFF"
  const darkContrast =
    getColorContrastRatio(
      darkTextColor,
      backgroundColor
    )
  const lightContrast =
    getColorContrastRatio(
      lightTextColor,
      backgroundColor
    )

  return darkContrast >= lightContrast
    ? darkTextColor
    : lightTextColor
}
