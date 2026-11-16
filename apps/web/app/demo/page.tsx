import SharedDashboardPage from "@/app/share/dashboard/page"

import { marketingPageMetadata } from "@/lib/seo-server"

export function generateMetadata() {
  return marketingPageMetadata("/demo")
}

export default function DemoPage() {
  return <SharedDashboardPage demo />
}
