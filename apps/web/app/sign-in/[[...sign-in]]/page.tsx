import { AuthCard } from "@/app/auth-card"
import { headers } from "next/headers"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { WorkspaceInvitationSignIn } from "@/features/auth/components/workspace-invitation-sign-in"
import { getAuthRequestOrigin, getInvitedWorkspaceId, getSafeReturnTo } from "@/features/auth/lib/auth-redirects"

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{
    redirect_url?: string | string[]
    switch_account?: string | string[]
  }>
}) {
  const { redirect_url, switch_account } = await searchParams
  const returnTo = getSafeReturnTo(redirect_url, getAuthRequestOrigin(await headers()))
  const accountSwitch = switch_account === "1" && Boolean(getInvitedWorkspaceId(returnTo))
  const card = <AuthCard mode="sign-in" returnTo={returnTo} />
  return (
    <AuthLayout mode="sign-in" title="Sign in" description="Welcome back to Decisionate." returnTo={returnTo} showAccountLink={!accountSwitch}>
      {accountSwitch ? <WorkspaceInvitationSignIn returnTo={returnTo}>{card}</WorkspaceInvitationSignIn> : card}
    </AuthLayout>
  )
}
