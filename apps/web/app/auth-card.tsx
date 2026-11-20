import { auth } from "@clerk/nextjs/server"
import { headers } from "next/headers"
import { getHostedInvitationWorkspaceId } from "@/features/auth/lib/auth-redirects"
import { ContinueHostedInvitation } from "@/features/auth/components/continue-hosted-invitation"
import { ClerkAuthCard } from "./clerk-auth-card"

type AuthCardProps = {
  mode: "sign-in" | "sign-up"
  returnTo?: string | null
}

export async function AuthCard({
  mode,
  returnTo,
}: AuthCardProps) {
  const hostedReturn = (await headers()).get("x-decisionate-hosted-return")
  if (hostedReturn && getHostedInvitationWorkspaceId(hostedReturn)) {
    // Use the session at entry, not a session created by the form itself.
    const { sessionId } = await auth()
    if (sessionId) return <ContinueHostedInvitation mode={mode} hostedReturn={hostedReturn} sessionId={sessionId} />
  }
  return (
    <ClerkAuthCard
      mode={mode}
      returnTo={returnTo}
    />
  )
}
