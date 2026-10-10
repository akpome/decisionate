import { AuthCard } from "@/app/auth-card"
import { headers } from "next/headers"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { getAuthRequestOrigin, getSafeReturnTo } from "@/features/auth/lib/auth-redirects"

export default async function SignUpPage({ searchParams }: {
  searchParams: Promise<{ redirect_url?: string | string[] }>
}) {
  const { redirect_url } = await searchParams
  const returnTo = getSafeReturnTo(redirect_url, getAuthRequestOrigin(await headers()))
  return (
    <AuthLayout mode="sign-up" title="Create your account" description="Use your work email to join Decisionate." returnTo={returnTo}>
      <AuthCard mode="sign-up" returnTo={returnTo} />
    </AuthLayout>
  )
}
