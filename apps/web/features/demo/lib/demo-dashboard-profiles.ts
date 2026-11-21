import type { DashboardChartTitles, DashboardMetricMapping } from "@/features/dashboards/dashboard-registry"

type Profile = {
  dataset: string
  mapping?: DashboardMetricMapping
  titles?: DashboardChartTitles
}

export const demoDashboardProfiles: Partial<Record<string, Profile>> = {
  "general-business": { dataset: "google-analytics" },
  "marketing-performance": {
    dataset: "google-ads",
    mapping: { date: "date", primary: "cost", category: "campaign_name", stage: "advertising_channel_type", operationsValue: "conversions" },
    titles: { trend: "Ad spend over time", mix: "Spend by campaign", operations: "Conversions by ad type" },
  },
  "sales-performance": {
    dataset: "hubspot",
    mapping: { date: "date", primary: "pipeline_value", category: "lead_source", stage: "deal_stage", operationsValue: "pipeline_value" },
    titles: { trend: "Pipeline value over time", mix: "Pipeline value by lead source", operations: "Pipeline value by deal stage" },
  },
  "retail-performance": {
    dataset: "shopify",
    mapping: { date: "date", primary: "revenue", category: "product_category", stage: "fulfillment_status", operationsValue: "orders" },
    titles: { trend: "Sales over time", mix: "Sales by product category", operations: "Orders by fulfillment status" },
  },
  "professional-services": {
    dataset: "freshbooks",
    mapping: { date: "date", primary: "revenue", category: "service_category", stage: "payment_status", operationsValue: "invoices" },
    titles: { trend: "Revenue over time", mix: "Revenue by service", operations: "Invoices by payment status" },
  },
}

export function demoDashboardProfile(dashboard: string | undefined, dataset: string) {
  const profile = dashboard ? demoDashboardProfiles[dashboard] : undefined
  return profile?.dataset === dataset ? profile : undefined
}
