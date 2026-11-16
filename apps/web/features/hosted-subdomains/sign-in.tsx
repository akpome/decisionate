"use client"

import { useClerk } from "@clerk/nextjs"
import { ArrowRight } from "lucide-react"
import { type HostedBrand } from "./types"
import { getBrandSurfaceTextColor } from "@/lib/workspace-brand"

export function HostedSignIn({ brand, returnTo, signup = false }: { brand: HostedBrand; returnTo: string; signup?: boolean }) {
  const clerk = useClerk()
  return <main className="flex min-h-screen items-center justify-center px-5 py-12" style={{ backgroundColor: brand.background_color,
    ...(brand.background_url ? { backgroundImage: `url(${JSON.stringify(brand.background_url)})`, backgroundSize: "cover" } : {}) }}>
    <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-7">
      {brand.logo_url && /* eslint-disable-next-line @next/next/no-img-element */
        <img src={brand.logo_url} alt={brand.name} className="mb-5 h-12 max-w-full object-contain object-left" />}
      <p className="break-words text-sm font-semibold text-gray-600">{brand.name}</p>
      <h1 className="mt-3 break-words text-2xl font-semibold text-gray-950">{brand.welcome_heading || "Welcome back"}</h1>
      {brand.welcome_text && <p className="mt-3 break-words text-sm leading-6 text-gray-600">{brand.welcome_text}</p>}
      <a className="mt-6 flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold"
        style={{ backgroundColor: brand.primary_color, color: getBrandSurfaceTextColor(brand.primary_color) }}
        href={signup ? clerk.buildSignUpUrl({ redirectUrl: returnTo }) : clerk.buildSignInUrl({ redirectUrl: returnTo })}>
        {signup ? "Create your account" : "Continue to sign in"}<ArrowRight size={16} />
      </a>
      <div className="mt-5 flex flex-wrap justify-between gap-3 text-xs text-gray-600">
        <a href={`mailto:${brand.support_email}`} className="underline">Contact support</a>
        <a href="https://decisionate.ca/privacy" className="underline">Privacy</a>
        <a href="https://decisionate.ca/terms" className="underline">Terms</a>
      </div>
    </section>
  </main>
}
