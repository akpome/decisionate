type SampleRow = Record<string, unknown>

export function summarizeDemoSpend(rows: readonly SampleRow[]) {
  const totals = new Map<string, { campaign: string; spend: number; revenue: number }>()
  const dates: string[] = []
  for (const row of rows) {
    const campaign = row.campaign_name
    const date = row.date
    const spend = row.cost
    const revenue = row.conversions_value
    if (typeof campaign !== "string" || typeof date !== "string" ||
        typeof spend !== "number" || !Number.isFinite(spend) || spend < 0 ||
        typeof revenue !== "number" || !Number.isFinite(revenue) || revenue < 0) continue
    const total = totals.get(campaign) ?? { campaign, spend: 0, revenue: 0 }
    total.spend += spend
    total.revenue += revenue
    totals.set(campaign, total)
    dates.push(date)
  }
  dates.sort()
  const campaigns = [...totals.values()].filter(row => row.spend > 0)
    .map(row => ({ ...row, returnPerDollar: row.revenue / row.spend }))
    .sort((a, b) => b.returnPerDollar - a.returnPerDollar || a.campaign.localeCompare(b.campaign))
  return { campaigns, start: dates[0], end: dates.at(-1) }
}
