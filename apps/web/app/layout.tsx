import "./globals.css"
import type {
  Metadata,
  Viewport,
} from "next"
import type { ReactNode } from "react"
import { AppClerkProvider } from "./clerk-provider"
import { PwaRegistration } from "./pwa-registration"
import { ThemeBootstrap } from "./theme-bootstrap"
import { LanguageBootstrap } from "./language-bootstrap"
import { WorkspaceFaviconBootstrap } from "./workspace-favicon-bootstrap"
import { portalBrand } from "@/lib/portal-brand"

export const metadata: Metadata = {
  title: {
    default: portalBrand.name,
    template: `%s | ${portalBrand.name}`,
  },
  description:
    "Analyze business performance across datasets with selected metrics, dimension filters, seasonal checks, forecasts, weekly reports, and accountable decisions.",
  applicationName: portalBrand.name,
  manifest: portalBrand.id ? undefined : "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: portalBrand.name,
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: portalBrand.name,
    description:
      "Compare accounting, sales and marketing data in cross-dataset reports, investigate relationships and unusual changes, and track the actions you choose.",
    type: "website",
  },
}

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  colorScheme: "light dark",
}

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html
      lang="en-CA"
      suppressHydrationWarning
    >
      <head>
        {portalBrand.logo && <link
          rel="icon"
          href={portalBrand.logo}
          type="image/png"
        />}
        <WorkspaceFaviconBootstrap />
      </head>
      <body className="bg-gray-50 text-gray-950 antialiased">
        <AppClerkProvider>
          <ThemeBootstrap />
          <LanguageBootstrap />
          <div className="min-h-screen">
            {children}
          </div>
          {!portalBrand.id && <PwaRegistration />}
        </AppClerkProvider>
      </body>
    </html>
  )
}
