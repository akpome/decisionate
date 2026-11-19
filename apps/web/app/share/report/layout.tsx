import type { Metadata } from "next"

export const metadata: Metadata = { title: "Shared report", robots: { index: false, follow: false }, referrer: "no-referrer" }

export default function SharedReportLayout({ children }: { children: React.ReactNode }) { return children }
