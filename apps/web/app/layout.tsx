import "./globals.css"
import type {
  Metadata,
  Viewport,
} from "next"
import type { ReactNode } from "react"
import { AppClerkProvider } from "./clerk-provider"
import { PwaRegistration } from "./pwa-registration"
import { ThemeBootstrap } from "./theme-bootstrap"
import { WorkspaceFaviconBootstrap } from "./workspace-favicon-bootstrap"

export const metadata: Metadata = {
  title: {
    default: "Decisionate",
    template: "%s | Decisionate",
  },
  description:
    "Business intelligence dashboards and decision intelligence for growing businesses, with forecasts, AI recommendations, and accountable decisions.",
  applicationName: "Decisionate",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Decisionate",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: "Decisionate",
    description:
      "Turn operational data into business intelligence, clearer decisions, forecasts, recommendations, and accountable follow-up.",
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
    <AppClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
      >
        <head>
          <link
            rel="icon"
            href="/icons/decisionate-icon.svg"
            type="image/svg+xml"
          />
          <WorkspaceFaviconBootstrap />
        </head>
        <body className="bg-gray-50 text-gray-950 antialiased">
          <ThemeBootstrap />
          <div className="min-h-screen">
            {children}
        </div>
          <PwaRegistration />
        </body>
      </html>
    </AppClerkProvider>
  )
}
