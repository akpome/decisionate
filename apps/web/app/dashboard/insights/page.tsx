import { redirect } from "next/navigation"
import { legacyInsightsDestination } from "@/features/reports/legacy-insights-destination"

export default async function InsightsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(legacyInsightsDestination(await searchParams))
}
