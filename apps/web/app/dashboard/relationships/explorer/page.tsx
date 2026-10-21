import { redirect } from "next/navigation"
import { legacyRelationshipDestination } from "@/features/reports/legacy-relationship-destination"

export default async function RetiredExplorerPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(legacyRelationshipDestination(await searchParams))
}
