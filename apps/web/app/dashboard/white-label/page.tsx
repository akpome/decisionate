import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { HostedPortalSetup } from "@/features/white-label/hosted-setup"

export default async function WhiteLabelPage() {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")
  return <HostedPortalSetup userId={userId} />
}
