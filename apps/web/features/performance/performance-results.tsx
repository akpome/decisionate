import { PerformanceResult } from "./types"

export const money = (value: number | null, currency: string) => value == null ? "Unavailable" : new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(value)

export function PerformanceResults({ result }: { result: PerformanceResult }) {
  const returns = result.definition.kind === "return", currency = result.definition.currency
  const value = (row: PerformanceResult["rows"][number]) => returns ? row.return_per_dollar : row.money_left
  const shown = result.rows.filter(row => row.ready).slice(0, 8)
  const max = Math.max(1, ...shown.map(row => Math.abs(value(row) || 0)))
  const negative = shown.some(row => (value(row) || 0) < 0)
  const heading = returns ? `Revenue for each 1 ${currency} spent` : "Money left after selected costs"
  return <div className="space-y-6" aria-label="Comparison results">
    <section className="border-b border-gray-200 pb-5">
      <p className="mb-2 text-sm text-gray-600">{result.definition.date_range.start} to {result.definition.date_range.end} / {currency}</p>
      <h2 className="break-words text-xl font-semibold">{result.headline}</h2>
      <p className="mt-3 text-sm text-gray-700">{result.next_action}</p>
      {returns && <p className="mt-2 text-sm text-gray-600">{result.basis}</p>}
    </section>
    {shown.length > 0 && <figure aria-label={heading} className="max-w-4xl space-y-4">
      <figcaption className="text-sm font-semibold">{heading}{result.rows.length > 8 ? " / first 8 complete results" : ""}</figcaption>
      {shown.map((row, index) => <div key={`${row.name}:${index}`} className="space-y-1.5">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm"><span className="min-w-0 break-words">{row.name}</span><span className="font-semibold tabular-nums">{money(value(row), currency)}</span></div>
        <div className="relative h-3 w-full overflow-hidden rounded-sm bg-gray-100" aria-hidden="true">
          {negative && <div className="absolute inset-y-0 left-1/2 w-px bg-gray-400" />}
          <div className={`absolute h-full ${value(row)! < 0 ? "bg-rose-600" : returns ? "bg-blue-600" : "bg-emerald-600"}`} style={{ width: `${(negative ? 50 : 100) * Math.abs(value(row) || 0) / max}%`, ...(negative && value(row)! < 0 ? { right: "50%" } : { left: negative ? "50%" : 0 }) }} />
        </div>
      </div>)}
    </figure>}
    {result.rows.length > 0 && <div className="overflow-x-auto border-y border-gray-200" tabIndex={0} role="region" aria-label="All comparison amounts">
      <table className="w-full min-w-[640px] text-left text-sm"><caption className="sr-only">Recorded amounts and comparison results</caption>
        <thead className="bg-gray-50"><tr>{["Comparison", "Revenue", returns ? "Spending" : "Selected costs", returns ? `Revenue / 1 ${currency}` : "Money left", ...(returns ? [] : ["Margin"]), "Record checks"].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{label}</th>)}</tr></thead>
        <tbody>{result.rows.map((row, index) => <tr key={`${row.name}:${index}`} className="border-t border-gray-100 align-top"><th scope="row" className="min-w-40 max-w-60 break-words px-3 py-4 font-medium">{row.name}</th>
          {[row.revenue, row.costs, value(row)].map((amount, index) => <td key={index} className={`whitespace-nowrap px-3 py-4 tabular-nums ${amount != null && amount < 0 ? "text-rose-700" : ""}`}>{money(amount, currency)}</td>)}
          {!returns && <td className="whitespace-nowrap px-3 py-4 tabular-nums">{row.margin_percent == null ? "Unavailable" : `${row.margin_percent.toFixed(1)}%`}</td>}
          <td className="min-w-48 max-w-96 px-3 py-4 text-xs leading-5">{row.issues.length ? <ul className="space-y-2 text-amber-900">{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : "Complete for the selected records"}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <details className="border-b border-gray-200 pb-4 text-sm"><summary className="cursor-pointer py-2 font-medium">What is included</summary>
      <ul className="list-disc space-y-2 py-3 pl-5 text-gray-600">{result.limitations.map(text => <li key={text}>{text}</li>)}</ul>
      <p className="text-xs text-gray-500">Calculated {result.generated_at.slice(0, 10)}. {result.analysis_id ? "Saved comparison; source updates do not change it." : "Unsaved preview."}</p>
    </details>
  </div>
}
