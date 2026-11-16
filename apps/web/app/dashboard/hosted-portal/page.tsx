import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { HostedSubdomainSetup } from "@/features/hosted-subdomains/setup"

export default async function HostedPortalPage() {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")
  return <HostedSubdomainSetup userId={userId} />
}
