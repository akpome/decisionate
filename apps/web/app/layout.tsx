import "./globals.css"
import { ClerkProvider } from "@clerk/nextjs"
import type {
  Metadata,
  Viewport,
} from "next"
import type { ReactNode } from "react"
import { PwaRegistration } from "./pwa-registration"
import { ThemeBootstrap } from "./theme-bootstrap"

export const metadata: Metadata = {
  title: {
    default: "Decisionate",
    template: "%s | Decisionate",
  },
  description:
    "Decision intelligence workspace for growing businesses, with forecasts, alerts, recommendations, and accountable decisions.",
  applicationName: "Decisionate",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/decisionate-icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: [
      {
        url: "/icons/decisionate-icon.svg",
        type: "image/svg+xml",
      },
    ],
  },
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
      "Turn operational data into clearer decisions, forecasts, recommendations, and accountable follow-up.",
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
    <ClerkProvider
      signInFallbackRedirectUrl="/dashboard"
      signInForceRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/onboarding"
      signUpForceRedirectUrl="/onboarding"
    >
      <html
        lang="en"
        suppressHydrationWarning
      >
        <body className="bg-gray-50 text-gray-950 antialiased">
          <ThemeBootstrap />
          <div className="min-h-screen">
            {children}
          </div>
          <PwaRegistration />
        </body>
      </html>
    </ClerkProvider>
  )
}
