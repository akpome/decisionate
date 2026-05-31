import Link from "next/link"

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
      <div className="max-w-3xl text-center">
        <h1 className="mb-6 text-6xl font-bold tracking-tight">
          Decisionate
        </h1>

        <p className="mb-8 text-xl text-gray-600">
          Clear actionable decisions for modern businesses.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="rounded-xl bg-black px-6 py-3 text-white"
          >
            Get Started
          </Link>

          <Link
            href="/sign-in"
            className="rounded-xl border px-6 py-3"
          >
            Sign In
          </Link>
        </div>
      </div>
    </main>
  )
}