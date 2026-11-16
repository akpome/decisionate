import "./globals.css"
import type {
  Metadata,
  Viewport,
} from "next"
import type { ReactNode } from "react"
import { headers } from "next/headers"
import { AppClerkProvider } from "./clerk-provider"
import { PwaRegistration } from "./pwa-registration"
import { ThemeBootstrap } from "./theme-bootstrap"
import { LanguageBootstrap } from "./language-bootstrap"
import { WorkspaceFaviconBootstrap } from "./workspace-favicon-bootstrap"
import { portalBrand } from "@/lib/portal-brand"
import { requestHostedPortal } from "@/features/hosted-subdomains/server"
import { HostedPortalProvider } from "@/features/hosted-subdomains/provider"

const baseMetadata: Metadata = {
  title: {
    default: portalBrand.name,
    template: `%s | ${portalBrand.name}`,
  },
  description:
    "Analyze business performance across datasets with selected metrics, dimension filters, seasonal checks, forecasts, weekly reports, and accountable decisions.",
  applicationName: portalBrand.name,
  robots: { index: false, follow: false },
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

export async function generateMetadata(): Promise<Metadata> {
  const portal = await requestHostedPortal()
  return {
    ...baseMetadata,
    ...(portal?.branding ? { title: portal.branding.name, applicationName: portal.branding.name,
      icons: portal.branding.favicon_url || portal.branding.logo_url || undefined,
      openGraph: { title: portal.branding.name } } : {}),
  }
}

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  colorScheme: "light dark",
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  const portal = await requestHostedPortal()
  const returnTo = (await headers()).get("x-decisionate-hosted-return")
  return (
    <html
      lang="en-CA"
      suppressHydrationWarning
    >
      <head>
        {!portal && portalBrand.logo && <link
          rel="icon"
          href={portalBrand.logo}
          type="image/png"
        />}
        {!portal && <WorkspaceFaviconBootstrap />}
      </head>
      <body className="bg-gray-50 text-gray-950 antialiased">
        <HostedPortalProvider portal={portal} returnTo={returnTo}>
        <AppClerkProvider portal={portal} hostedReturn={returnTo}>
          <ThemeBootstrap />
          <LanguageBootstrap />
          <div className="min-h-screen">
            {children}
          </div>
          {!portalBrand.id && <PwaRegistration />}
        </AppClerkProvider>
        </HostedPortalProvider>
      </body>
    </html>
  )
}
