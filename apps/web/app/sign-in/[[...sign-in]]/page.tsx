import { AuthCard } from "@/app/auth-card"
import { headers } from "next/headers"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { getAuthRequestOrigin, getSafeReturnTo } from "@/features/auth/lib/auth-redirects"

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{
    redirect_url?: string | string[]
  }>
}) {
  const { redirect_url } = await searchParams
  const returnTo = getSafeReturnTo(redirect_url, getAuthRequestOrigin(await headers()))
  return (
    <AuthLayout mode="sign-in" title="Sign in" description="Welcome back to Decisionate." returnTo={returnTo}>
      <AuthCard mode="sign-in" returnTo={returnTo} />
    </AuthLayout>
  )
}
