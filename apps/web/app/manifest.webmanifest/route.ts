const defaultManifestName = "Decisionate"
const defaultManifestDescription =
  "Decision intelligence workspace for growing businesses, with forecasts, alerts, recommendations, and accountable decisions."
const defaultManifestThemeColor = "#4f46e5"
const defaultManifestBackgroundColor = "#f8fafc"
const decisionateIconUrl =
  "/icons/decisionate-icon.svg"
const decisionateMaskableIconUrl =
  "/icons/decisionate-maskable.svg"

type ManifestIcon = {
  src: string
  sizes: string
  type?: string
  purpose?: string
}

export function GET(request: Request) {
  const searchParams =
    new URL(request.url).searchParams
  const name =
    cleanManifestText(
      searchParams.get("name"),
      defaultManifestName
    )
  const themeColor =
    cleanManifestColor(
      searchParams.get("theme_color"),
      defaultManifestThemeColor
    )
  const logoUrl =
    cleanManifestLogoUrl(
      searchParams.get("logo_url")
    ) ||
    getFallbackManifestIconUrl(
      name,
      themeColor
    )

  const manifest = {
    name,
    short_name: getManifestShortName(name),
    description: defaultManifestDescription,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color:
      defaultManifestBackgroundColor,
    theme_color: themeColor,
    categories: [
      "business",
      "finance",
      "productivity",
    ],
    icons: getManifestIcons(logoUrl),
    shortcuts: [
      getManifestShortcut(
        "Dashboard",
        "Open KPI dashboard",
        "/dashboard",
        logoUrl
      ),
      getManifestShortcut(
        "Alerts",
        "Open KPI email alerts",
        "/dashboard/alerts",
        logoUrl
      ),
      getManifestShortcut(
        "Decisions",
        "Open decision workspace",
        "/dashboard/decisions",
        logoUrl
      ),
    ],
    id: "/dashboard",
    display_override: [
      "standalone",
      "browser",
    ],
  }

  return Response.json(
    manifest,
    {
      headers: {
        "Cache-Control":
          "public, max-age=0, must-revalidate",
        "Content-Type":
          "application/manifest+json",
      },
    }
  )
}

function getManifestIcons(
  logoUrl: string
): ManifestIcon[] {
  const iconType =
    getManifestIconType(logoUrl)
  const primaryIcon: ManifestIcon = {
    src: logoUrl,
    sizes: "any",
    purpose: "any",
  }

  if (iconType) {
    primaryIcon.type = iconType
  }

  if (logoUrl === decisionateIconUrl) {
    return [
      primaryIcon,
      {
        src: decisionateMaskableIconUrl,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ]
  }

  return [primaryIcon]
}

function getManifestShortcut(
  name: string,
  description: string,
  url: string,
  logoUrl: string
) {
  const iconType =
    getManifestIconType(logoUrl)
  const icon: ManifestIcon = {
    src: logoUrl,
    sizes: "any",
  }

  if (iconType) {
    icon.type = iconType
  }

  return {
    name,
    short_name: name,
    description,
    url,
    icons: [icon],
  }
}

function cleanManifestText(
  value: string | null,
  fallback: string
) {
  const cleanValue =
    value?.trim().replace(/\s+/g, " ")

  if (!cleanValue) {
    return fallback
  }

  return cleanValue.slice(0, 80)
}

function getManifestShortName(
  name: string
) {
  return name.length > 20
    ? `${name.slice(0, 17).trim()}...`
    : name
}

function cleanManifestColor(
  value: string | null,
  fallback: string
) {
  const cleanValue =
    value?.trim()

  return cleanValue &&
    /^#[0-9a-fA-F]{6}$/.test(cleanValue)
    ? cleanValue
    : fallback
}

function cleanManifestLogoUrl(
  value: string | null
) {
  const cleanValue =
    value?.trim()

  if (!cleanValue || cleanValue.length > 500) {
    return ""
  }

  if (
    cleanValue.startsWith("/") &&
    !cleanValue.startsWith("//")
  ) {
    return cleanValue
  }

  try {
    const parsedUrl =
      new URL(cleanValue)

    if (
      parsedUrl.protocol === "https:" ||
      parsedUrl.protocol === "http:"
    ) {
      return cleanValue
    }
  } catch {
    return ""
  }

  return ""
}

function getManifestIconType(
  logoUrl: string
) {
  const cleanLogoUrl =
    logoUrl.toLowerCase().split("?")[0]

  if (
    cleanLogoUrl.startsWith(
      "data:image/svg+xml,"
    )
  ) {
    return "image/svg+xml"
  }

  if (cleanLogoUrl.endsWith(".svg")) {
    return "image/svg+xml"
  }

  if (cleanLogoUrl.endsWith(".png")) {
    return "image/png"
  }

  if (
    cleanLogoUrl.endsWith(".jpg") ||
    cleanLogoUrl.endsWith(".jpeg")
  ) {
    return "image/jpeg"
  }

  if (cleanLogoUrl.endsWith(".webp")) {
    return "image/webp"
  }

  return undefined
}

function getFallbackManifestIconUrl(
  name: string,
  themeColor: string
) {
  return name === defaultManifestName
    ? decisionateIconUrl
    : getGeneratedManifestIconDataUrl(
        name,
        themeColor
      )
}

function getGeneratedManifestIconDataUrl(
  name: string,
  themeColor: string
) {
  const initial =
    name.trim().charAt(0).toUpperCase() ||
    "D"
  const textColor =
    getManifestSurfaceTextColor(themeColor)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="112" fill="${themeColor}" />
      <text x="256" y="312" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="232" font-weight="700" fill="${textColor}">${escapeManifestSvgText(initial)}</text>
    </svg>
  `

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function getManifestSurfaceTextColor(
  backgroundColor: string
) {
  const red =
    Number.parseInt(
      backgroundColor.slice(1, 3),
      16
    )
  const green =
    Number.parseInt(
      backgroundColor.slice(3, 5),
      16
    )
  const blue =
    Number.parseInt(
      backgroundColor.slice(5, 7),
      16
    )
  const luminance =
    (0.2126 * red +
      0.7152 * green +
      0.0722 * blue) /
    255

  return luminance > 0.58
    ? "#0F172A"
    : "#FFFFFF"
}

function escapeManifestSvgText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
