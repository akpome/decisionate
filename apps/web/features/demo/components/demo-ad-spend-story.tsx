"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, CalendarDays, CheckCircle2 } from "lucide-react"
import { loadPublicDemoDashboard } from "@/features/demo/lib/demo-data"
import { summarizeDemoSpend } from "@/features/demo/lib/demo-spend"
import { DECISIONATE_AUTH_LINKS } from "@/lib/decisionate-domains"

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0, minimumFractionDigits: 0 })
const dollars = (value: number) => `$${value.toFixed(2)}`

export function DemoAdSpendStory({ view }: { view: "spend" | "review" }) {
  const [summary, setSummary] = useState<ReturnType<typeof summarizeDemoSpend>>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const request = new AbortController()
    void loadPublicDemoDashboard("google-ads", undefined, request.signal)
      .then(data => setSummary(summarizeDemoSpend(data?.dataset.chart?.data ?? [])))
      .catch(() => { if (!request.signal.aborted) setFailed(true) })
    return () => request.abort()
  }, [])
  const best = summary?.campaigns[0]
  const review = view === "review"

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <header className="border-b border-gray-200 pb-5">
          <p className="mb-2 text-sm font-semibold text-blue-700">Live demo · Sample data</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">{review ? "Test a change before spending more" : "Which campaigns earned more per dollar?"}</h1>
          <p className="mt-2 text-sm text-gray-600">
            {review ? "Example decision based on the sample Return on spend report." : "Google Ads · Reported conversion value · CAD"}
          </p>
        </header>
        {!summary || !best ? (
          <p className="py-6 text-sm text-gray-600" role="status">{failed || summary ? "Sample results are unavailable. Reload to try again." : "Loading sample results..."}</p>
        ) : review ? (
          <div className="divide-y divide-gray-200">
            <section className="py-5">
              <h2 className="font-semibold">What the report showed</h2>
              <p className="mt-2 text-gray-700">{best.campaign} reported {dollars(best.returnPerDollar)} in conversion value per $1 spent, the highest in this sample.</p>
            </section>
            <section className="py-5">
              <h2 className="font-semibold">What to try</h2>
              <p className="mt-2 text-gray-700">Keep the total ad budget unchanged. Test shifting a small share to {best.campaign} in one market and leave a similar market unchanged.</p>
            </section>
            <section className="py-5">
              <h2 className="flex items-center gap-2 font-semibold"><CalendarDays size={17} aria-hidden="true" /> Check in four weeks</h2>
              <p className="mt-2 text-gray-700">Compare store orders and net sales after ad costs against the unchanged market. Use the same dates and tracking rules.</p>
              <p className="mt-3 text-sm font-medium text-gray-600">Outcome: not yet recorded</p>
            </section>
          </div>
        ) : (
          <>
            <div className="py-5">
              <p className="text-xs text-gray-600">{summary.start} to {summary.end}</p>
              <p className="mt-2 flex items-start gap-2 text-lg font-semibold"><CheckCircle2 className="mt-1 shrink-0 text-emerald-700" size={19} aria-hidden="true" /> {best.campaign}: {dollars(best.returnPerDollar)} reported per $1 spent</p>
            </div>
            <div className="overflow-x-auto rounded-md border border-gray-200 bg-white" role="region" aria-label="Campaign returns" tabIndex={0}>
              <table className="w-full min-w-[30rem] text-left text-sm">
                <thead className="bg-gray-100 text-gray-700"><tr>
                  <th scope="col" className="px-4 py-3">Campaign</th>
                  <th scope="col" className="px-4 py-3 text-right">Spend</th>
                  <th scope="col" className="px-4 py-3 text-right">Reported value</th>
                  <th scope="col" className="px-4 py-3 text-right">Value per $1</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {summary.campaigns.map(row => (
                    <tr key={row.campaign}>
                      <th scope="row" className="px-4 py-3 font-medium">{row.campaign}</th>
                      <td className="px-4 py-3 text-right tabular-nums">{cad.format(row.spend)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{cad.format(row.revenue)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{dollars(row.returnPerDollar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-gray-600">Ad-platform figures show reported value, not profit or proof the ads caused those sales.</p>
          </>
        )}
        <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold text-blue-700">
          <Link href={review ? "/demo?view=spend" : "/demo?view=review"} className="inline-flex items-center gap-2 hover:underline">
            {review ? "Back to the report" : "See the decision this could support"} <ArrowRight size={16} aria-hidden="true" />
          </Link>
          {review && <Link href={DECISIONATE_AUTH_LINKS.signUp} className="hover:underline">Start your trial</Link>}
        </div>
      </div>
    </main>
  )
}
