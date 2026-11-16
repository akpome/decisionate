import { AuthCard } from "@/app/auth-card"
import { headers } from "next/headers"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { getAuthRequestOrigin, getSafeReturnTo } from "@/features/auth/lib/auth-redirects"
import { getAuthRedirectUrl } from "@/features/auth/lib/auth-redirects"
import { requestHostedPortal } from "@/features/hosted-subdomains/server"
import { HostedSignIn } from "@/features/hosted-subdomains/sign-in"

export default async function SignUpPage({ searchParams }: {
  searchParams: Promise<{ redirect_url?: string | string[] }>
}) {
  const { redirect_url } = await searchParams
  const returnTo = getSafeReturnTo(redirect_url, getAuthRequestOrigin(await headers()))
  const portal = await requestHostedPortal()
  if (portal?.branding) return <HostedSignIn signup brand={portal.branding} returnTo={portal.origin + getAuthRedirectUrl(returnTo)} />
  return (
    <AuthLayout mode="sign-up" title="Create your account" description="Use your work email to join Decisionate." returnTo={returnTo}>
      <AuthCard mode="sign-up" returnTo={returnTo} />
    </AuthLayout>
  )
}
