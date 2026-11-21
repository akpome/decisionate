import SharedDashboardPage from "@/app/share/dashboard/page"
import Link from "next/link"
import { DemoAdSpendStory } from "@/features/demo/components/demo-ad-spend-story"
import { marketingPageMetadata } from "@/lib/seo-server"

export function generateMetadata() {
  return marketingPageMetadata("/demo")
}

const views = [
  ["dashboard", "Dashboards", "/demo"],
  ["spend", "Return on spend", "/demo?view=spend"],
  ["review", "Decision review", "/demo?view=review"],
] as const

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const requested = (await searchParams).view
  const view = requested === "spend" || requested === "review" ? requested : "dashboard"
  return (
    <>
      <nav aria-label="Live demo" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 sm:px-8">
        {views.map(([key, label, href]) => (
          <Link key={key} href={href} aria-current={key === view ? "page" : undefined}
            className={key === view ? "font-semibold text-blue-700 underline underline-offset-4" : "hover:text-blue-700"}>
            {label}
          </Link>
        ))}
      </nav>
      {view === "dashboard" ? <SharedDashboardPage demo /> : <DemoAdSpendStory view={view} />}
    </>
  )
}
