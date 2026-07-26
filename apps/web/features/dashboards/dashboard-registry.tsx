"use client"

import {
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useUser } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import {
  FileDown,
  Share2,
  Unlink,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import {
  createDecision,
  getDecisionSummary,
  type AIAnalysis,
  type DecisionSummary,
} from "@/lib/api"
import {
  buildAIRecommendationDecisionPayload,
} from "@/features/decisions/lib/ai-decision-handoff"
import type {
  DashboardChartTitleKey,
  DashboardChartTitles,
  DashboardMetricMapping,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  WorkspaceBrandMark,
} from "@/app/dashboard/workspace-brand-mark"
import type {
  WorkspaceBrand,
} from "@/lib/workspace-brand"
import type {
  DashboardComponentKey,
} from "@/features/dashboards/dashboard-definitions"
import {
  AIAnalysisPanel,
} from "@/features/ai/components/analysis-panel"
import {
  AnalysisStatus,
} from "@/features/ai/components/analysis-status"
import {
  dashboardChartPalette,
} from "@/features/dashboard/lib/chart-palette"

type DashboardPlaceholderProps = {
  name: string
  description: string
  highlights: string[]
  dataset?: DashboardDatasetInput | null
  datasetName?: string
  datasetId?: number
  analysisMetric?: string
  analysisLoading?: boolean
  analysisError?: boolean
  onRetryAnalysis?: () => void
  manualMapping?: DashboardMetricMapping
  chartTitles?: DashboardChartTitles
  decisionSummary?: DecisionSummary | null
  controls?: ReactNode
  status?: ReactNode
  brand?: WorkspaceBrand
  canManageWorkspaceData?: boolean
  onDownloadPdf?: () => void
  onShare?: () => void
  onStopSharing?: () => void
  onCreateRecommendation?: () => void
  creatingRecommendation?: boolean
  pdfDisabled?: boolean
  shareDisabled?: boolean
  stopSharingDisabled?: boolean
  pdfLabel?: string
  shareLabel?: string
  stopSharingLabel?: string
  shareTitle?: string
  shareAriaLabel?: string
  stopSharingTitle?: string
  stopSharingAriaLabel?: string
  shareEnabled?: boolean
  showActions?: boolean
  exportMode?: boolean
}

export type {
  DashboardChartTitleKey,
  DashboardChartTitles,
  DashboardMetricMapping,
} from "@/lib/api"

type DashboardDatasetCell =
  | string
  | number
  | Date
  | null
  | undefined

type DashboardDatasetRow =
  Record<string, DashboardDatasetCell>

type DashboardDatasetMetric = {
  column: string
  total?: number
  average?: number
  min?: number
  max?: number
  minimum?: number
  maximum?: number
}

export type DashboardDatasetInput = {
  row_count?: number
  preview?: DashboardDatasetRow[]
  metrics?: DashboardDatasetMetric[]
  ai_analysis?: AIAnalysis | null
  chart?: {
    data?: DashboardDatasetRow[]
    x_key?: string
  }
}

type IndustryMetric = {
  label: string
  value: string
  detail: string
}

type IndustryChartPoint = {
  name: string
  value: number
  secondary?: number
}

type IndustryMixPoint = {
  name: string
  value: number
  color: string
}

type IndustryDashboardConfig = {
  metrics: IndustryMetric[]
  trendTitle: string
  trendDescription: string
  trendData: IndustryChartPoint[]
  trendLabel: string
  trendStatus?: string
  secondaryTrendLabel?: string
  mixTitle: string
  mixDescription: string
  mixData: IndustryMixPoint[]
  mixStatus?: string
  operationsTitle: string
  operationsDescription: string
  operationsData: IndustryChartPoint[]
  operationsLabel: string
  operationsStatus?: string
  signalTitle: string
  roleHints: {
    primary: string[]
    category?: string[]
    stage?: string[]
    date?: string[]
  }
  signals: {
    label: string
    value: string
    tone: "blue" | "green" | "amber" | "red" | "purple"
  }[]
}

const industryDashboardConfigs: Record<
  Exclude<
    DashboardComponentKey,
    | "generalBusiness"
    | "marketingPerformance"
    | "salesPerformance"
    | "decisionPerformance"
  >,
  IndustryDashboardConfig
> = {
  retailPerformance: {
    metrics: [
      {
        label: "Net Sales",
        value: "$128.4K",
        detail: "+12% vs last period",
      },
      {
        label: "Gross Margin",
        value: "38%",
        detail: "2.4 pts above target",
      },
      {
        label: "Inventory Turns",
        value: "5.6x",
        detail: "Healthy movement",
      },
      {
        label: "Stockout Risk",
        value: "7 SKUs",
        detail: "Needs reorder action",
      },
    ],
    trendTitle: "Sales and Margin Trend",
    trendDescription:
      "Weekly sales volume with margin performance.",
    trendData: [
      { name: "W1", value: 92, secondary: 34 },
      { name: "W2", value: 108, secondary: 36 },
      { name: "W3", value: 101, secondary: 35 },
      { name: "W4", value: 128, secondary: 38 },
      { name: "W5", value: 136, secondary: 39 },
    ],
    trendLabel: "Sales",
    secondaryTrendLabel: "Margin",
    mixTitle: "Sales Mix",
    mixDescription:
      "Revenue contribution by product category.",
    mixData: [
      { name: "Apparel", value: 34, color: "#2563eb" },
      { name: "Home", value: 26, color: "#16a34a" },
      { name: "Beauty", value: 22, color: "#f97316" },
      { name: "Other", value: 18, color: "#9333ea" },
    ],
    operationsTitle: "Inventory Movement",
    operationsDescription:
      "Sell-through rate by merchandising group.",
    operationsData: [
      { name: "Core", value: 78 },
      { name: "Seasonal", value: 64 },
      { name: "Promo", value: 86 },
      { name: "Slow", value: 31 },
    ],
    operationsLabel: "Sell-through",
    signalTitle: "Retail Highlights",
    roleHints: {
      primary: ["sales", "revenue", "net sales", "amount", "total"],
      category: ["category", "product", "department", "sku", "item"],
      stage: ["inventory", "stock", "status", "movement"],
      date: ["date", "week", "month", "created", "order"],
    },
    signals: [
      { label: "Best day", value: "Saturday", tone: "blue" },
      { label: "Basket size", value: "$74", tone: "green" },
      { label: "Shrink alert", value: "Medium", tone: "amber" },
    ],
  },
  restaurantPerformance: {
    metrics: [
      {
        label: "Revenue",
        value: "$42.8K",
        detail: "+9% week over week",
      },
      {
        label: "Avg Check",
        value: "$31.60",
        detail: "Dinner leads growth",
      },
      {
        label: "Food Cost",
        value: "29%",
        detail: "Inside target band",
      },
      {
        label: "Table Turns",
        value: "3.4x",
        detail: "Peak dinner pressure",
      },
    ],
    trendTitle: "Meal Period Revenue",
    trendDescription:
      "Lunch and dinner sales across the week.",
    trendData: [
      { name: "Mon", value: 38, secondary: 62 },
      { name: "Tue", value: 42, secondary: 67 },
      { name: "Wed", value: 45, secondary: 71 },
      { name: "Thu", value: 51, secondary: 84 },
      { name: "Fri", value: 68, secondary: 112 },
      { name: "Sat", value: 74, secondary: 124 },
    ],
    trendLabel: "Lunch",
    secondaryTrendLabel: "Dinner",
    mixTitle: "Menu Mix",
    mixDescription:
      "Sales concentration by menu group.",
    mixData: [
      { name: "Entrees", value: 46, color: "#16a34a" },
      { name: "Drinks", value: 24, color: "#2563eb" },
      { name: "Apps", value: 18, color: "#f97316" },
      { name: "Dessert", value: 12, color: "#9333ea" },
    ],
    operationsTitle: "Prime Cost Watch",
    operationsDescription:
      "Food and labor cost by operating window.",
    operationsData: [
      { name: "Breakfast", value: 53 },
      { name: "Lunch", value: 58 },
      { name: "Dinner", value: 64 },
      { name: "Late", value: 49 },
    ],
    operationsLabel: "Prime cost",
    signalTitle: "Service Highlights",
    roleHints: {
      primary: ["revenue", "sales", "check", "ticket", "amount"],
      category: ["menu", "item", "category", "meal", "period"],
      stage: ["service", "shift", "period", "daypart"],
      date: ["date", "day", "week", "month"],
    },
    signals: [
      { label: "Wait time", value: "14 min", tone: "green" },
      { label: "Void rate", value: "1.8%", tone: "blue" },
      { label: "Labor gap", value: "Fri PM", tone: "amber" },
    ],
  },
  professionalServices: {
    metrics: [
      {
        label: "Utilization",
        value: "76%",
        detail: "Target range achieved",
      },
      {
        label: "Pipeline",
        value: "$684K",
        detail: "Weighted opportunities",
      },
      {
        label: "Project Margin",
        value: "41%",
        detail: "Strong delivery mix",
      },
      {
        label: "At-risk Work",
        value: "3",
        detail: "Scope or timeline pressure",
      },
    ],
    trendTitle: "Utilization and Backlog",
    trendDescription:
      "Billable capacity compared with booked work.",
    trendData: [
      { name: "Jan", value: 68, secondary: 52 },
      { name: "Feb", value: 72, secondary: 59 },
      { name: "Mar", value: 77, secondary: 63 },
      { name: "Apr", value: 74, secondary: 61 },
      { name: "May", value: 79, secondary: 68 },
    ],
    trendLabel: "Utilization",
    secondaryTrendLabel: "Backlog",
    mixTitle: "Revenue Mix",
    mixDescription:
      "Client revenue by engagement type.",
    mixData: [
      { name: "Retainers", value: 42, color: "#9333ea" },
      { name: "Projects", value: 36, color: "#2563eb" },
      { name: "Advisory", value: 14, color: "#16a34a" },
      { name: "Support", value: 8, color: "#f97316" },
    ],
    operationsTitle: "Delivery Health",
    operationsDescription:
      "Portfolio status across active client work.",
    operationsData: [
      { name: "On track", value: 18 },
      { name: "Watch", value: 6 },
      { name: "Blocked", value: 2 },
      { name: "Closing", value: 5 },
    ],
    operationsLabel: "Engagements",
    signalTitle: "Agency Highlights",
    roleHints: {
      primary: ["revenue", "fee", "billable", "amount", "margin"],
      category: ["client", "engagement", "service", "project", "type"],
      stage: ["status", "stage", "health", "delivery"],
      date: ["date", "month", "period", "start"],
    },
    signals: [
      { label: "Best margin", value: "Retainers", tone: "purple" },
      { label: "Bench risk", value: "Low", tone: "green" },
      { label: "Renewals", value: "5 due", tone: "amber" },
    ],
  },
  healthcarePractice: {
    metrics: [
      {
        label: "Visits",
        value: "1,248",
        detail: "+7% patient volume",
      },
      {
        label: "No-show Rate",
        value: "6.2%",
        detail: "Improving trend",
      },
      {
        label: "Provider Utilization",
        value: "82%",
        detail: "Capacity tightening",
      },
      {
        label: "A/R Days",
        value: "34",
        detail: "Revenue cycle stable",
      },
    ],
    trendTitle: "Appointments and No-shows",
    trendDescription:
      "Patient volume against missed appointment rate.",
    trendData: [
      { name: "W1", value: 244, secondary: 8 },
      { name: "W2", value: 268, secondary: 7 },
      { name: "W3", value: 251, secondary: 6 },
      { name: "W4", value: 285, secondary: 6 },
      { name: "W5", value: 302, secondary: 5 },
    ],
    trendLabel: "Appointments",
    secondaryTrendLabel: "No-shows",
    mixTitle: "Visit Mix",
    mixDescription:
      "Patient demand by visit type.",
    mixData: [
      { name: "Follow-up", value: 38, color: "#2563eb" },
      { name: "New patient", value: 27, color: "#16a34a" },
      { name: "Telehealth", value: 21, color: "#0891b2" },
      { name: "Procedure", value: 14, color: "#f97316" },
    ],
    operationsTitle: "Revenue Cycle",
    operationsDescription:
      "Claims and collections by workflow stage.",
    operationsData: [
      { name: "Submitted", value: 92 },
      { name: "Accepted", value: 84 },
      { name: "Denied", value: 9 },
      { name: "Collected", value: 71 },
    ],
    operationsLabel: "Claims",
    signalTitle: "Practice Highlights",
    roleHints: {
      primary: ["visit", "appointment", "patient", "volume", "revenue"],
      category: ["visit type", "service", "provider", "location"],
      stage: ["claim", "status", "stage", "workflow"],
      date: ["date", "appointment", "week", "month"],
    },
    signals: [
      { label: "Open slots", value: "38", tone: "blue" },
      { label: "Denials", value: "9%", tone: "amber" },
      { label: "Follow-up lag", value: "2 days", tone: "green" },
    ],
  },
  realEstate: {
    metrics: [
      {
        label: "Pipeline",
        value: "$8.6M",
        detail: "Active deal value",
      },
      {
        label: "Closings",
        value: "18",
        detail: "This period",
      },
      {
        label: "Lead Conversion",
        value: "14%",
        detail: "Up from 11%",
      },
      {
        label: "Avg DOM",
        value: "27",
        detail: "Listings moving faster",
      },
    ],
    trendTitle: "Closings and Pipeline",
    trendDescription:
      "Closed transactions compared with active pipeline.",
    trendData: [
      { name: "Jan", value: 8, secondary: 58 },
      { name: "Feb", value: 11, secondary: 63 },
      { name: "Mar", value: 9, secondary: 71 },
      { name: "Apr", value: 14, secondary: 77 },
      { name: "May", value: 18, secondary: 86 },
    ],
    trendLabel: "Closings",
    secondaryTrendLabel: "Pipeline",
    mixTitle: "Lead Sources",
    mixDescription:
      "Opportunity source quality across channels.",
    mixData: [
      { name: "Referral", value: 34, color: "#16a34a" },
      { name: "Portal", value: 29, color: "#2563eb" },
      { name: "Social", value: 21, color: "#f97316" },
      { name: "Open house", value: 16, color: "#9333ea" },
    ],
    operationsTitle: "Deal Stage Funnel",
    operationsDescription:
      "Active opportunities by transaction stage.",
    operationsData: [
      { name: "Lead", value: 64 },
      { name: "Showing", value: 41 },
      { name: "Offer", value: 18 },
      { name: "Closing", value: 12 },
    ],
    operationsLabel: "Deals",
    signalTitle: "Market Highlights",
    roleHints: {
      primary: ["pipeline", "price", "value", "commission", "amount"],
      category: ["source", "lead", "area", "market", "property"],
      stage: ["stage", "status", "funnel", "deal"],
      date: ["date", "close", "month", "listing"],
    },
    signals: [
      { label: "Hot area", value: "Northside", tone: "green" },
      { label: "Price cuts", value: "6", tone: "amber" },
      { label: "New listings", value: "24", tone: "blue" },
    ],
  },
  nonprofitPerformance: {
    metrics: [
      {
        label: "Donations",
        value: "$214K",
        detail: "Campaign-to-date",
      },
      {
        label: "Program Reach",
        value: "8,420",
        detail: "People served",
      },
      {
        label: "Grant Pipeline",
        value: "$520K",
        detail: "Submitted and pending",
      },
      {
        label: "Runway",
        value: "9.5 mo",
        detail: "Operating coverage",
      },
    ],
    trendTitle: "Giving and Program Reach",
    trendDescription:
      "Fundraising progress against service delivery.",
    trendData: [
      { name: "Jan", value: 34, secondary: 52 },
      { name: "Feb", value: 41, secondary: 58 },
      { name: "Mar", value: 52, secondary: 71 },
      { name: "Apr", value: 47, secondary: 76 },
      { name: "May", value: 63, secondary: 84 },
    ],
    trendLabel: "Donations",
    secondaryTrendLabel: "Reach",
    mixTitle: "Funding Mix",
    mixDescription:
      "Revenue concentration by funding stream.",
    mixData: [
      { name: "Individuals", value: 39, color: "#2563eb" },
      { name: "Grants", value: 33, color: "#9333ea" },
      { name: "Corporate", value: 18, color: "#16a34a" },
      { name: "Events", value: 10, color: "#f97316" },
    ],
    operationsTitle: "Program Performance",
    operationsDescription:
      "Outcome delivery by active program.",
    operationsData: [
      { name: "Youth", value: 88 },
      { name: "Food", value: 74 },
      { name: "Housing", value: 61 },
      { name: "Training", value: 69 },
    ],
    operationsLabel: "Goal progress",
    signalTitle: "Mission Highlights",
    roleHints: {
      primary: ["donation", "gift", "funding", "grant", "amount"],
      category: ["program", "fund", "source", "campaign"],
      stage: ["status", "program", "grant", "stage"],
      date: ["date", "month", "campaign"],
    },
    signals: [
      { label: "Restricted funds", value: "44%", tone: "purple" },
      { label: "Volunteer hours", value: "1,180", tone: "green" },
      { label: "Grant due", value: "12 days", tone: "amber" },
    ],
  },
}

const marketingDashboardConfig: IndustryDashboardConfig = {
  metrics: [
    {
      label: "Attributed Revenue",
      value: "$186K",
      detail: "+18% campaign lift",
    },
    {
      label: "ROAS",
      value: "4.2x",
      detail: "Paid channels profitable",
    },
    {
      label: "Qualified Leads",
      value: "1,420",
      detail: "Sales-ready pipeline",
    },
    {
      label: "CAC",
      value: "$84",
      detail: "Down 11% vs target",
    },
  ],
  trendTitle: "Pipeline and Spend Efficiency",
  trendDescription:
    "Qualified lead volume compared with acquisition cost.",
  trendData: [
    { name: "Jan", value: 820, secondary: 112 },
    { name: "Feb", value: 940, secondary: 104 },
    { name: "Mar", value: 1080, secondary: 97 },
    { name: "Apr", value: 1210, secondary: 91 },
    { name: "May", value: 1420, secondary: 84 },
  ],
  trendLabel: "Qualified leads",
  secondaryTrendLabel: "CAC",
  mixTitle: "Channel Mix",
  mixDescription:
    "Revenue contribution by acquisition channel.",
  mixData: [
    { name: "Paid search", value: 34, color: "#2563eb" },
    { name: "Organic", value: 27, color: "#16a34a" },
    { name: "Email", value: 21, color: "#f97316" },
    { name: "Social", value: 18, color: "#9333ea" },
  ],
  operationsTitle: "Campaign Funnel",
  operationsDescription:
    "Audience movement from reach to closed revenue.",
  operationsData: [
    { name: "Reach", value: 92 },
    { name: "Visits", value: 64 },
    { name: "Leads", value: 38 },
    { name: "SQLs", value: 19 },
    { name: "Won", value: 8 },
  ],
  operationsLabel: "Conversion index",
  signalTitle: "Marketing Highlights",
  roleHints: {
    primary: ["revenue", "attributed", "conversion", "leads", "amount"],
    category: ["channel", "source", "campaign", "medium"],
    stage: ["stage", "funnel", "status", "lifecycle"],
    date: ["date", "month", "campaign", "created"],
  },
  signals: [
    { label: "Top channel", value: "Paid search", tone: "blue" },
    { label: "Best offer", value: "Demo", tone: "green" },
    { label: "Creative fatigue", value: "Social", tone: "amber" },
  ],
}

const salesDashboardConfig: IndustryDashboardConfig = {
  metrics: [
    {
      label: "Booked Revenue",
      value: "$312K",
      detail: "+14% vs quota pace",
    },
    {
      label: "Pipeline Coverage",
      value: "3.6x",
      detail: "Next-period target",
    },
    {
      label: "Win Rate",
      value: "28%",
      detail: "Up 4 pts this quarter",
    },
    {
      label: "Forecast Risk",
      value: "$74K",
      detail: "Needs manager review",
    },
  ],
  trendTitle: "Bookings and Pipeline Trend",
  trendDescription:
    "Closed revenue compared with qualified pipeline.",
  trendData: [
    { name: "Jan", value: 172, secondary: 610 },
    { name: "Feb", value: 188, secondary: 690 },
    { name: "Mar", value: 241, secondary: 745 },
    { name: "Apr", value: 226, secondary: 820 },
    { name: "May", value: 312, secondary: 910 },
  ],
  trendLabel: "Bookings",
  secondaryTrendLabel: "Pipeline",
  mixTitle: "Deal Source Mix",
  mixDescription:
    "Closed revenue by sales acquisition source.",
  mixData: [
    { name: "Outbound", value: 31, color: "#2563eb" },
    { name: "Inbound", value: 29, color: "#16a34a" },
    { name: "Partners", value: 23, color: "#f97316" },
    { name: "Expansion", value: 17, color: "#9333ea" },
  ],
  operationsTitle: "Sales Stage Funnel",
  operationsDescription:
    "Opportunity movement through the revenue process.",
  operationsData: [
    { name: "Lead", value: 86 },
    { name: "Qualified", value: 58 },
    { name: "Demo", value: 34 },
    { name: "Proposal", value: 21 },
    { name: "Closed", value: 12 },
  ],
  operationsLabel: "Opportunities",
  signalTitle: "Sales Highlights",
  roleHints: {
    primary: ["booked", "revenue", "amount", "deal", "opportunity"],
    category: ["source", "rep", "segment", "account", "customer"],
    stage: ["stage", "status", "funnel", "forecast"],
    date: ["date", "close", "month", "created"],
  },
  signals: [
    { label: "Top rep", value: "Morgan", tone: "blue" },
    { label: "Best segment", value: "Mid-market", tone: "green" },
    { label: "Stalled deals", value: "9", tone: "amber" },
  ],
}

function MarketingPerformanceDashboard(
  props: DashboardPlaceholderProps
) {
  return (
    <IndustryDashboard
      {...props}
      config={marketingDashboardConfig}
    />
  )
}

function SalesPerformanceDashboard(
  props: DashboardPlaceholderProps
) {
  return (
    <IndustryDashboard
      {...props}
      config={salesDashboardConfig}
    />
  )
}

function getDashboardDefaultChartTitles(
  componentKey: DashboardComponentKey
): DashboardChartTitles {
  if (componentKey === "decisionPerformance") {
    return {
      trend: "Decision Creation Trend",
      mix: "Decisions by Category",
      outcome: "Outcome Results",
      operations: "Outcome Workflow",
    }
  }

  const industryConfig =
    componentKey === "marketingPerformance"
      ? marketingDashboardConfig
      : componentKey === "salesPerformance"
        ? salesDashboardConfig
        : componentKey in industryDashboardConfigs
          ? industryDashboardConfigs[
              componentKey as keyof typeof industryDashboardConfigs
            ]
          : null

  return {
    trend:
      industryConfig?.trendTitle ??
      "Trend Chart",
    mix:
      industryConfig?.mixTitle ??
      "Category / Mix Chart",
    operations:
      industryConfig?.operationsTitle ??
      "Stage / Status Chart",
  }
}

export function getDashboardMappingChartTitles(
  componentKey: DashboardComponentKey
) {
  const titles =
    getDashboardDefaultChartTitles(componentKey)

  return {
    trend: titles.trend ?? "Trend Chart",
    mix: titles.mix ?? "Category / Mix Chart",
    operations:
      titles.operations ?? "Stage / Status Chart",
  }
}

export type DashboardChartTitleField = {
  key: DashboardChartTitleKey
  label: string
  defaultValue: string
}

export function getDashboardChartTitleFields(
  componentKey: DashboardComponentKey
): DashboardChartTitleField[] {
  const titles =
    getDashboardDefaultChartTitles(componentKey)

  if (componentKey === "decisionPerformance") {
    return [
      {
        key: "mix",
        label: "Category chart",
        defaultValue: titles.mix ?? "Decisions by Category",
      },
      {
        key: "trend",
        label: "Creation trend",
        defaultValue: titles.trend ?? "Decision Creation Trend",
      },
      {
        key: "outcome",
        label: "Outcome chart",
        defaultValue: titles.outcome ?? "Outcome Results",
      },
      {
        key: "operations",
        label: "Workflow chart",
        defaultValue: titles.operations ?? "Outcome Workflow",
      },
    ]
  }

  return [
    {
      key: "trend",
      label: "Trend chart",
      defaultValue: titles.trend ?? "Trend Chart",
    },
    {
      key: "mix",
      label: "Category / mix chart",
      defaultValue: titles.mix ?? "Category / Mix Chart",
    },
    {
      key: "operations",
      label: "Stage / status chart",
      defaultValue:
        titles.operations ?? "Stage / Status Chart",
    },
  ]
}

export function getDashboardAutoMetricMapping(
  componentKey: DashboardComponentKey,
  dataset?: DashboardDatasetInput | null
): DashboardMetricMapping {
  const industryConfig =
    componentKey === "marketingPerformance"
      ? marketingDashboardConfig
      : componentKey === "salesPerformance"
        ? salesDashboardConfig
        : componentKey in industryDashboardConfigs
          ? industryDashboardConfigs[
              componentKey as keyof typeof industryDashboardConfigs
            ]
          : null

  if (!industryConfig || !dataset) {
    return {}
  }

  const rows =
    dataset.chart?.data?.length
      ? dataset.chart.data
      : dataset.preview ?? []
  const columns = getDatasetColumns(
    rows,
    dataset.metrics
  )

  return {
    primary:
      findColumnByHints(
        columns,
        industryConfig.roleHints.primary,
        rows,
        true
      ),
    category:
      findColumnByHints(
        columns,
        industryConfig.roleHints.category ?? []
      ),
    stage:
      findColumnByHints(
        columns,
        industryConfig.roleHints.stage ?? []
      ),
    date:
      findColumnByHints(
        columns,
        industryConfig.roleHints.date ?? []
      ) ?? dataset.chart?.x_key,
  }
}

function buildMappedIndustryDashboard(
  config: IndustryDashboardConfig,
  dataset?: DashboardDatasetInput | null,
  manualMapping?: DashboardMetricMapping
): IndustryDashboardConfig {
  const rows =
    dataset?.chart?.data?.length
      ? dataset.chart.data
      : dataset?.preview ?? []
  const columns = getDatasetColumns(rows, dataset?.metrics)
  const primaryColumn = findColumnByHints(
    columns,
    config.roleHints.primary,
    rows,
    true
  )
  const getValidManualColumn = (
    value: string | undefined,
    requireNumeric = false
  ) =>
    value &&
      columns.includes(value) &&
      (!requireNumeric ||
        columnHasNumericValues(rows, value))
      ? value
      : undefined
  const mappedPrimaryColumn =
    getValidManualColumn(
      manualMapping?.primary,
      true
    ) || primaryColumn
  const categoryColumn = findColumnByHints(
    columns,
    config.roleHints.category ?? []
  )
  const mappedCategoryColumn =
    getValidManualColumn(
      manualMapping?.category
    ) || categoryColumn
  const stageColumn = findColumnByHints(
    columns,
    config.roleHints.stage ?? []
  )
  const mappedStageColumn =
    getValidManualColumn(
      manualMapping?.stage
    ) || stageColumn
  const dateColumn =
    getValidManualColumn(
      manualMapping?.date
    ) ||
    findColumnByHints(
      columns,
      config.roleHints.date ?? []
    ) ||
    getValidManualColumn(
      dataset?.chart?.x_key
    )
  const datasetRowCount =
    typeof dataset?.row_count === "number" &&
    Number.isFinite(dataset.row_count)
      ? dataset.row_count
      : undefined
  const chartRowCount = rows.length
  const chartRowDetail =
    datasetRowCount !== undefined &&
    datasetRowCount > chartRowCount
      ? `Chart sample of ${formatInteger(datasetRowCount)} dataset rows`
      : datasetRowCount !== undefined
        ? "Selected dataset"
        : "Available chart rows"

  if (!rows.length || !mappedPrimaryColumn) {
    const hasDataset = Boolean(dataset)
    const numericColumnCount =
      dataset?.metrics?.length ??
      columns.filter(column =>
        columnHasNumericValues(rows, column)
      ).length
    const readinessStatus = hasDataset
      ? "Needs mapping"
      : "Dataset needed"

    return {
      ...config,
      metrics: [
        {
          label: "Data readiness",
          value: hasDataset
            ? "Map a field"
            : "Select dataset",
          detail: hasDataset
            ? "No numeric value column matched automatically."
            : "Choose a dataset to render real metrics.",
        },
        {
          label: "Rows in Chart",
          value: formatInteger(chartRowCount),
          detail: hasDataset
            ? chartRowDetail
            : "No dataset selected",
        },
        {
          label: "Numeric Fields",
          value: formatInteger(numericColumnCount),
          detail: "Available for mapping",
        },
      ],
      trendDescription: hasDataset
        ? "Map a numeric value and date column to render this trend."
        : "Select a dataset to render this trend with real data.",
      trendData: [],
      trendLabel: "Mapped value",
      trendStatus: readinessStatus,
      mixDescription: hasDataset
        ? "Map a category column to render this mix."
        : "Select a dataset to render this mix with real data.",
      mixData: [],
      mixStatus: readinessStatus,
      operationsDescription: hasDataset
        ? "Map a stage or status column to render this breakdown."
        : "Select a dataset to render this breakdown with real data.",
      operationsData: [],
      operationsLabel: "Mapped value",
      operationsStatus: readinessStatus,
      signals: [
        {
          label: "Data source",
          value: hasDataset
            ? "Selected dataset"
            : "No dataset",
          tone: "amber" as const,
        },
        {
          label: "Value field",
          value: mappedPrimaryColumn ?? "Needs mapping",
          tone: "amber" as const,
        },
        {
          label: "Next step",
          value: "Map chart fields",
          tone: "blue" as const,
        },
      ],
    }
  }

  const primaryMetric = dataset?.metrics?.find(
    metric => metric.column === mappedPrimaryColumn
  )
  const primaryMetricName = normalizeColumnName(
    mappedPrimaryColumn
  )
  const usesAverage = isAverageLikeMetric(
    primaryMetricName
  )
  const primaryValue = usesAverage
    ? getNumericAverage(
        primaryMetric?.average,
        rows,
        mappedPrimaryColumn
      )
    : getNumericTotal(
        primaryMetric?.total,
        rows,
        mappedPrimaryColumn
      )
  const primaryLabel = formatDashboardLabel(
    mappedPrimaryColumn
  )
  const mappedMetrics = [
    {
      label: primaryLabel,
      value: formatMappedMetricValue(
        primaryValue,
        mappedPrimaryColumn
      ),
      detail: usesAverage
        ? primaryMetric?.average !== undefined
          ? "Dataset average"
          : `Average from ${formatInteger(rows.length)} rows`
        : primaryMetric?.total !== undefined
          ? "Dataset total"
          : `Total from ${formatInteger(rows.length)} rows`,
    },
    {
      label: "Rows in Chart",
      value: formatInteger(chartRowCount),
      detail: chartRowDetail,
    },
    {
      label: "Chart Fields",
      value: formatInteger(
        [
          mappedPrimaryColumn,
          mappedCategoryColumn,
          mappedStageColumn,
          dateColumn,
        ].filter(Boolean).length
      ),
      detail: "Chart columns detected",
    },
  ]
  const trendData = dateColumn
    ? buildTrendData(
        rows,
        dateColumn,
        mappedPrimaryColumn
      )
    : []
  const mixData = mappedCategoryColumn
    ? buildMixData(
        rows,
        mappedCategoryColumn,
        mappedPrimaryColumn
      )
    : []
  const operationsData = mappedStageColumn
    ? buildCategoryBarData(
        rows,
        mappedStageColumn,
        mappedPrimaryColumn
      )
    : []
  const leadingGroup =
    mixData[0] ?? operationsData[0]

  mappedMetrics.push({
    label: mappedCategoryColumn
      ? "Top Category"
      : mappedStageColumn
        ? "Top Stage"
        : "Leading Group",
    value: leadingGroup?.name ?? "Needs mapping",
    detail: leadingGroup
      ? "Highest grouped value"
      : "Map a category or stage field",
  })

  return {
    ...config,
    metrics: mappedMetrics,
    trendDescription: dateColumn
      ? `${config.trendDescription} Tracking ${primaryLabel} by ${formatDashboardLabel(dateColumn)}.`
      : "Map a date or period column to render this trend with real data.",
    trendData,
    trendLabel: primaryLabel,
    secondaryTrendLabel: undefined,
    trendStatus: dateColumn
      ? undefined
      : "Needs mapping",
    mixDescription:
      mappedCategoryColumn
        ? `${config.mixDescription} Grouped by ${formatDashboardLabel(mappedCategoryColumn)}.`
        : "Map a category, source, or segment column to render this mix with real data.",
    mixStatus: mappedCategoryColumn
      ? undefined
      : "Needs mapping",
    mixData,
    operationsDescription:
      mappedStageColumn
        ? `${config.operationsDescription} Grouped by ${formatDashboardLabel(mappedStageColumn)}.`
        : "Map a stage or status column to render this breakdown with real data.",
    operationsStatus: mappedStageColumn
      ? undefined
      : "Needs mapping",
    operationsData,
    operationsLabel: primaryLabel,
    signals: [
      {
        label: "Tracked value",
        value: formatDashboardLabel(mappedPrimaryColumn),
        tone: "green",
      },
      {
        label: "Top mix",
        value: mixData[0]?.name ?? "Needs category",
        tone: mixData.length > 0
          ? "blue"
          : "amber",
      },
      {
        label: "Top stage",
        value: operationsData[0]?.name ?? "Needs stage",
        tone: operationsData.length > 0
          ? "green"
          : "amber",
      },
    ],
  }
}

function IndustryDashboard({
  name,
  description,
  dataset,
  analysisMetric,
  analysisLoading,
  analysisError,
  onRetryAnalysis,
  manualMapping,
  chartTitles,
  config,
  controls,
  status,
  brand,
  onDownloadPdf,
  onShare,
  onStopSharing,
  onCreateRecommendation,
  creatingRecommendation,
  pdfDisabled,
  shareDisabled,
  stopSharingDisabled,
  pdfLabel,
  shareLabel,
  stopSharingLabel,
  shareTitle,
  shareAriaLabel,
  stopSharingTitle,
  stopSharingAriaLabel,
  shareEnabled,
  showActions,
  exportMode,
}: DashboardPlaceholderProps & {
  config: IndustryDashboardConfig
}) {
  const dashboardConfig =
    buildMappedIndustryDashboard(
      config,
      dataset,
      manualMapping
    )
  const dashboardMixData =
    dashboardConfig.mixData.map((item, index) => ({
      ...item,
      color:
        dashboardChartPalette[
          index % dashboardChartPalette.length
        ],
    }))
  const resolvedChartTitles = {
    trend:
      chartTitles?.trend?.trim() ||
      dashboardConfig.trendTitle,
    mix:
      chartTitles?.mix?.trim() ||
      dashboardConfig.mixTitle,
    operations:
      chartTitles?.operations?.trim() ||
      dashboardConfig.operationsTitle,
  }

  return (
    <div className="dashboard-export-dashboard space-y-4 print:space-y-1.5">
      <DashboardHeader
        name={name}
        description={description}
        controls={controls}
        status={status}
        brand={brand}
        onDownloadPdf={onDownloadPdf}
        onShare={onShare}
        onStopSharing={onStopSharing}
        pdfDisabled={pdfDisabled}
        shareDisabled={shareDisabled}
        stopSharingDisabled={stopSharingDisabled}
        pdfLabel={pdfLabel}
        shareLabel={shareLabel}
        stopSharingLabel={stopSharingLabel}
        shareTitle={shareTitle}
        shareAriaLabel={shareAriaLabel}
        stopSharingTitle={stopSharingTitle}
        stopSharingAriaLabel={stopSharingAriaLabel}
        shareEnabled={shareEnabled}
        showActions={showActions}
        exportMode={exportMode}
      />

      {analysisLoading && (
        <AnalysisStatus kind="loading" />
      )}

      {analysisError && (
        <AnalysisStatus
          kind="unavailable"
          onRetry={onRetryAnalysis}
        />
      )}

      {!analysisLoading &&
        dataset?.ai_analysis &&
        (!analysisMetric ||
          dataset.ai_analysis.metric === analysisMetric) && (
        <AIAnalysisPanel
          analysis={dataset.ai_analysis}
          title="Dashboard analysis"
          metric={analysisMetric}
          className="print:hidden"
          onCreateDecision={onCreateRecommendation}
          creatingDecision={creatingRecommendation}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4 print:gap-1.5">
        {dashboardConfig.metrics.map(metric => (
          <div
            key={metric.label}
            className="break-inside-avoid rounded-2xl border border-gray-200 bg-white p-4 shadow-sm print:rounded-xl print:p-1.5"
          >
            <p className="text-xs font-medium uppercase text-gray-500">
              {metric.label}
            </p>
            <p className="mt-1 break-words text-2xl font-bold leading-tight text-gray-950 print:text-lg">
              {metric.value}
            </p>
            <p className="mt-1 text-xs leading-4 text-gray-500 print:leading-3">
              {metric.detail}
            </p>
          </div>
        ))}
      </div>

      <div className="dashboard-export-chart-grid grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:gap-2">
        <DashboardChartCard
          title={resolvedChartTitles.trend}
          description={dashboardConfig.trendDescription}
          status={dashboardConfig.trendStatus}
          exportMode={exportMode}
        >
          {dashboardConfig.trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={dashboardConfig.trendData}
                margin={{
                  top: 6,
                  right: 10,
                  bottom: 18,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tickMargin={6} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={dashboardConfig.trendLabel}
                  stroke={dashboardChartPalette[0]}
                  strokeWidth={3}
                  dot={{ r: 4 }}
                />
                {dashboardConfig.secondaryTrendLabel && (
                  <Line
                    type="monotone"
                    dataKey="secondary"
                    name={dashboardConfig.secondaryTrendLabel}
                    stroke={dashboardChartPalette[1]}
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <DashboardChartEmptyState message="Map a value and date field to render this trend." />
          )}
        </DashboardChartCard>

        <DashboardChartCard
          title={resolvedChartTitles.mix}
          description={dashboardConfig.mixDescription}
          status={dashboardConfig.mixStatus}
          className="dashboard-export-donut-card"
          exportMode={exportMode}
        >
          {dashboardMixData.length > 0 ? (
            <div className="h-full min-h-0 overflow-hidden">
              <DashboardCategoricalChart
                items={dashboardMixData}
                barLabel="Share"
                exportMode={exportMode}
              />
            </div>
          ) : (
            <DashboardChartEmptyState
              message={
                dashboardConfig.mixStatus
                  ? "Map a category field to render this mix."
                  : "No chartable grouped values are available for this category field."
              }
            />
          )}
        </DashboardChartCard>
      </div>

      <div className="dashboard-export-chart-grid grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:gap-2">
        <DashboardChartCard
          title={resolvedChartTitles.operations}
          description={dashboardConfig.operationsDescription}
          status={dashboardConfig.operationsStatus}
          exportMode={exportMode}
        >
          {dashboardConfig.operationsData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dashboardConfig.operationsData}
                margin={{
                  top: 6,
                  right: 10,
                  bottom: 18,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tickMargin={6} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="value"
                  name={dashboardConfig.operationsLabel}
                  fill={dashboardChartPalette[1]}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <DashboardChartEmptyState
              message={
                dashboardConfig.operationsStatus
                  ? "Map a stage or status field to render this breakdown."
                  : "No chartable grouped values are available for this stage or status field."
              }
            />
          )}
        </DashboardChartCard>

        <div className="break-inside-avoid rounded-xl border border-gray-200 bg-white p-4 shadow-sm print:p-2">
          <h2 className="text-base font-semibold print:text-sm">
            {dashboardConfig.signalTitle}
          </h2>
          <p className="mt-1 text-xs leading-4 text-gray-500 print:hidden">
            Signals calculated from the selected dataset.
          </p>
          <div className="mt-3 space-y-2 print:mt-1.5 print:space-y-1">
            {dashboardConfig.signals.map(signal => (
              <div
                key={signal.label}
                className={`rounded-lg border px-3 py-2 print:px-2 print:py-1 ${signalToneClass(signal.tone)}`}
              >
                <p className="text-xs font-medium uppercase">
                  {signal.label}
                </p>
                <p className="mt-1 break-words text-lg font-bold leading-tight print:text-base">
                  {signal.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function DecisionPerformanceDashboard({
  datasetId,
  name,
  description,
  controls,
  status,
  brand,
  canManageWorkspaceData = false,
  datasetName,
  chartTitles,
  onDownloadPdf,
  onShare,
  onStopSharing,
  pdfDisabled,
  shareDisabled,
  stopSharingDisabled,
  pdfLabel,
  shareLabel,
  stopSharingLabel,
  shareTitle,
  shareAriaLabel,
  stopSharingTitle,
  stopSharingAriaLabel,
  shareEnabled,
  showActions,
  exportMode,
  decisionSummary,
}: DashboardPlaceholderProps) {
  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } = useActiveWorkspace(user?.id)
  const router = useRouter()
  const [summary, setSummary] =
    useState<DecisionSummary | null>(null)
  const [error, setError] = useState("")
  const [recommendationError, setRecommendationError] =
    useState("")
  const [creatingRecommendation, setCreatingRecommendation] =
    useState(false)
  const [summaryLoading, setSummaryLoading] =
    useState(false)
  const [summaryRetryKey, setSummaryRetryKey] =
    useState(0)

  useEffect(() => {
    if (decisionSummary) {
      return
    }

    if (!user?.id) return

    const userId = user.id

    let cancelled = false

    async function loadSummary() {
      try {
        setSummary(null)
        setSummaryLoading(true)
        setError("")

        const data =
          await getDecisionSummary(
            userId,
            activeWorkspaceId,
            datasetId
          )

        if (!cancelled) {
          setSummary(data)
          setError("")
        }
      } catch {
        if (!cancelled) {
          setError(
            "Decision metrics are unavailable."
          )
        }
      } finally {
        if (!cancelled) {
          setSummaryLoading(false)
        }
      }
    }

    void loadSummary()

    return () => {
      cancelled = true
    }
  }, [
    activeWorkspaceId,
    datasetId,
    decisionSummary,
    summaryRetryKey,
    user?.id,
    workspaceVersion,
  ])

  const displayedSummary =
    decisionSummary ?? summary

  async function handleCreateRecommendation() {
    const analysis =
      displayedSummary?.ai_analysis

    if (
      !user?.id ||
      !datasetId ||
      !analysis ||
      !analysis.recommendations.length ||
      !canManageWorkspaceData ||
      creatingRecommendation
    ) {
      return
    }

    const decisionPayload =
      buildAIRecommendationDecisionPayload(
        datasetId,
        undefined,
        analysis,
        datasetName
      )

    if (!decisionPayload) {
      return
    }

    try {
      setCreatingRecommendation(true)
      setRecommendationError("")

      const createdDecision =
        await createDecision(
          decisionPayload,
          user.id,
          activeWorkspaceId
        )

      router.push(
        `/dashboard/decisions/${createdDecision.id}`
      )
    } catch {
      setRecommendationError(
        "Unable to create a decision from this recommendation."
      )
    } finally {
      setCreatingRecommendation(false)
    }
  }

  const successRate = displayedSummary
    ? displayedSummary.outcomes_evaluated > 0
      ? Math.round(
          (
            (displayedSummary.by_outcome_status.successful ?? 0) /
            displayedSummary.outcomes_evaluated
          ) * 100
        )
      : 0
    : "—"

  const metrics = [
    {
      label: "Total Decisions",
      value: displayedSummary?.total ?? "—",
    },
    {
      label: "Success Rate",
      value:
        typeof successRate === "number"
          ? `${successRate}%`
          : successRate,
    },
    {
      label: "Outcomes Pending",
      value: displayedSummary?.outcomes_pending ?? "—",
    },
    {
      label: "Reviews Overdue",
      value: displayedSummary?.reviews_overdue ?? "—",
    },
    {
      label: "Learning Pending",
      value: displayedSummary?.learning_pending ?? "—",
    },
    {
      label: "Attention Required",
      value: displayedSummary?.attention_required ?? "—",
    },
  ]

  const outcomeData = displayedSummary ? [
    {
      name: "Successful",
      value: displayedSummary.by_outcome_status.successful ?? 0,
      color: dashboardChartPalette[1],
    },
    {
      name: "Partial",
      value:
        displayedSummary.by_outcome_status.partially_successful ?? 0,
      color: dashboardChartPalette[6],
    },
    {
      name: "Unsuccessful",
      value: displayedSummary.by_outcome_status.unsuccessful ?? 0,
      color: dashboardChartPalette[4],
    },
  ].filter(item => item.value > 0) : []

  const completionData = displayedSummary ? [
    {
      name: "Planned",
      value: displayedSummary.outcomes_planned ?? 0,
    },
    {
      name: "Pending",
      value: displayedSummary.outcomes_pending ?? 0,
    },
    {
      name: "Recorded",
      value: displayedSummary.outcomes_recorded ?? 0,
    },
    {
      name: "Learning",
      value: displayedSummary.learning_captured ?? 0,
    },
  ].filter(item => item.value > 0) : []

  const categoryData =
    displayedSummary
      ? Object.entries(displayedSummary.by_category)
          .map(([category, value], index) => ({
            name: formatDashboardLabel(category),
            value,
            color:
              dashboardChartPalette[
                index % dashboardChartPalette.length
              ],
          }))
          .filter(item => item.value > 0)
          .sort((a, b) => b.value - a.value)
      : []

  const categoryChartType =
    categoryData.length > 5 ? "bar" : "donut"
  const outcomeChartType =
    categoryChartType === "donut" ? "bar" : "donut"

  const monthlyData =
    displayedSummary
      ? Object.entries(displayedSummary.by_created_month).map(
          ([month, value]) => ({
            month: formatDashboardMonth(month),
            value,
          })
        )
      : []

  const resolvedChartTitles = {
    trend:
      chartTitles?.trend?.trim() ||
      "Decision Creation Trend",
    mix:
      chartTitles?.mix?.trim() ||
      "Decisions by Category",
    outcome:
      chartTitles?.outcome?.trim() ||
      "Outcome Results",
    operations:
      chartTitles?.operations?.trim() ||
      "Outcome Workflow",
  }

  return (
    <div className="dashboard-export-dashboard space-y-4 print:space-y-2">
      <DashboardHeader
        name={name}
        description={description}
        controls={controls}
        status={status}
        brand={brand}
        onDownloadPdf={onDownloadPdf}
        onShare={onShare}
        onStopSharing={onStopSharing}
        pdfDisabled={pdfDisabled}
        shareDisabled={shareDisabled}
        stopSharingDisabled={stopSharingDisabled}
        pdfLabel={pdfLabel}
        shareLabel={shareLabel}
        stopSharingLabel={stopSharingLabel}
        shareTitle={shareTitle}
        shareAriaLabel={shareAriaLabel}
        stopSharingTitle={stopSharingTitle}
        stopSharingAriaLabel={stopSharingAriaLabel}
        shareEnabled={shareEnabled}
        showActions={showActions}
        exportMode={exportMode}
      />

      {summaryLoading && !displayedSummary && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
        >
          Loading decision metrics...
        </div>
      )}

      {error && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>

          <button
            type="button"
            onClick={() =>
              setSummaryRetryKey(
                currentKey => currentKey + 1
              )
            }
            className="w-fit rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
          >
            Retry decision metrics
          </button>
        </div>
      )}

      {displayedSummary?.ai_analysis && (
        <AIAnalysisPanel
          analysis={displayedSummary.ai_analysis}
          title="Decision analysis"
          className="print:hidden"
          onCreateDecision={
            canManageWorkspaceData &&
            Boolean(datasetId) &&
            displayedSummary.ai_analysis.recommendations.length > 0
              ? () => {
                void handleCreateRecommendation()
              }
              : undefined
          }
          creatingDecision={creatingRecommendation}
        />
      )}

      {recommendationError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden"
        >
          {recommendationError}
        </div>
      )}

      <div className="grid gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 print:grid-cols-6">
        {metrics.map(metric => (
          <div
            key={metric.label}
            className="min-w-0 rounded-lg bg-gray-50 px-2 py-1.5"
          >
            <p className="truncate text-xs font-medium text-gray-500">
              {metric.label}
            </p>

            <p className="mt-1 text-lg font-bold leading-tight text-gray-950">
              {metric.value}
            </p>
          </div>
        ))}
      </div>

      <div className="dashboard-export-chart-grid grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:gap-3">
        <DashboardChartCard
          title={resolvedChartTitles.mix}
          description="Decision volume grouped by business area."
          className={`order-2 ${
            categoryChartType === "donut"
              ? "dashboard-export-donut-card"
              : ""
          }`}
          exportMode={exportMode}
        >
          {categoryData.length > 0 ? (
            <div className="h-full min-h-0 overflow-hidden">
              <DashboardCategoricalChart
                items={categoryData}
                barLabel="Decisions"
                exportMode={exportMode}
                chartType={categoryChartType}
              />
            </div>
          ) : (
            <DashboardChartEmptyState />
          )}
        </DashboardChartCard>

        <DashboardChartCard
          title={resolvedChartTitles.trend}
          description="New decisions by month."
          className="order-1"
          exportMode={exportMode}
        >
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={monthlyData}
                margin={{
                  top: 6,
                  right: 10,
                  bottom: 18,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tickMargin={6} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="New decisions"
                  stroke="var(--decisionate-brand-primary)"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <DashboardChartEmptyState />
          )}
        </DashboardChartCard>
      </div>

      <div className="dashboard-export-chart-grid grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:gap-3">
        <DashboardChartCard
          title={resolvedChartTitles.outcome}
          description="Evaluated decisions by result mix."
          className={`order-2 ${
            outcomeChartType === "donut"
              ? "dashboard-export-donut-card"
              : ""
          }`}
          exportMode={exportMode}
        >
          {outcomeData.length > 0 ? (
            <div className="h-full min-h-0 overflow-hidden">
              <DashboardCategoricalChart
                items={outcomeData}
                barLabel="Outcomes"
                exportMode={exportMode}
                chartType={outcomeChartType}
              />
            </div>
          ) : (
            <DashboardChartEmptyState message="No evaluated outcomes yet." />
          )}
        </DashboardChartCard>

        <DashboardChartCard
          title={resolvedChartTitles.operations}
          description="Planned outcomes moving toward recorded learning."
          className="order-1"
          exportMode={exportMode}
        >
          {completionData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={completionData}
                margin={{
                  top: 6,
                  right: 10,
                  bottom: 18,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tickMargin={6} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="value"
                  name="Outcomes"
                  fill="var(--decisionate-brand-accent)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <DashboardChartEmptyState message="No outcome workflow data yet." />
          )}
        </DashboardChartCard>
      </div>
    </div>
  )
}

export function DashboardActionButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  ariaLabel,
  tone = "default",
  className,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  ariaLabel?: string
  tone?: "default" | "danger"
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 print:hidden ${
        tone === "danger"
          ? "border-red-200 text-red-700 hover:bg-red-50"
          : "border-gray-200 text-gray-700 hover:bg-gray-50"
      } ${className ?? ""}`}
    >
      {icon}
      {label}
    </button>
  )
}

function DashboardHeader({
  name,
  description,
  controls,
  status,
  brand,
  onDownloadPdf,
  onShare,
  onStopSharing,
  pdfDisabled,
  shareDisabled,
  stopSharingDisabled,
  pdfLabel = "Save PDF",
  shareLabel = "Share",
  stopSharingLabel = "Stop sharing",
  shareTitle,
  shareAriaLabel,
  stopSharingTitle,
  stopSharingAriaLabel,
  shareEnabled,
  showActions = true,
  exportMode,
}: {
  name: string
  description: string
  controls?: ReactNode
  status?: ReactNode
  brand?: WorkspaceBrand
  onDownloadPdf?: () => void
  onShare?: () => void
  onStopSharing?: () => void
  pdfDisabled?: boolean
  shareDisabled?: boolean
  stopSharingDisabled?: boolean
  pdfLabel?: string
  shareLabel?: string
  stopSharingLabel?: string
  shareTitle?: string
  shareAriaLabel?: string
  stopSharingTitle?: string
  stopSharingAriaLabel?: string
  shareEnabled?: boolean
  showActions?: boolean
  exportMode?: boolean
}) {
  const showBrandHeader =
    Boolean(brand) && (!showActions || exportMode)

  return (
    <div className="space-y-2 print:space-y-1">
      {brand && showBrandHeader && (
        <div
          className={`items-center justify-between gap-4 rounded-xl border bg-white p-3 print:flex print:p-2 ${
            showBrandHeader
              ? "flex"
              : "hidden"
          }`}
          style={{
            borderColor: brand.primaryColor,
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <WorkspaceBrandMark
              name={brand.name}
              logoUrl={brand.logoUrl}
              primaryColor={brand.primaryColor}
              className="h-10 w-10 rounded-xl text-sm"
            />

            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase text-gray-400">
                Shared by
              </p>
              <p className="truncate text-base font-semibold text-gray-950">
                {brand.name}
              </p>
              <p className="text-xs text-gray-500">
                Reporting workspace
              </p>
            </div>
          </div>

          <div className="min-w-0 text-right">
            <p className="truncate text-lg font-bold leading-tight text-gray-950">
              {name}
            </p>
            <p className="mt-0.5 max-w-md truncate text-xs text-gray-500">
              {description}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className={!showActions || exportMode ? "hidden" : "print:hidden"}>
          <h1 className="text-3xl font-bold leading-tight print:text-xl">
            {name}
          </h1>

          <p className="mt-1 text-sm text-gray-500 print:text-xs">
            {description}
          </p>
        </div>

        {showActions && (
          <div className="flex min-w-0 flex-wrap items-start gap-3 print:hidden">
            <DashboardActionButton
              icon={<FileDown size={16} />}
              label={pdfLabel}
              onClick={onDownloadPdf ?? (() => undefined)}
              disabled={pdfDisabled || !onDownloadPdf}
            />
            <DashboardActionButton
              icon={<Share2 size={16} />}
              label={shareLabel}
              onClick={
                onShare ??
                (() => {
                  void navigator.clipboard.writeText(
                    window.location.href
                  )
                })
              }
              disabled={shareDisabled}
              title={shareTitle}
              ariaLabel={shareAriaLabel}
            />
            {shareEnabled && onStopSharing && (
              <DashboardActionButton
                icon={<Unlink size={16} />}
                label={stopSharingLabel}
                onClick={onStopSharing}
                disabled={stopSharingDisabled}
                title={stopSharingTitle}
                ariaLabel={stopSharingAriaLabel}
                tone="danger"
              />
            )}
            {controls}
          </div>
        )}
      </div>

      {status && (
        <div className="w-full print:hidden">
          {status}
        </div>
      )}
    </div>
  )
}

function DashboardChartCard({
  title,
  description,
  status,
  children,
  className = "",
  exportMode,
}: {
  title: string
  description: string
  status?: string
  children: ReactNode
  className?: string
  exportMode?: boolean
}) {
  return (
    <div
        className={`dashboard-export-chart-card ${className} flex flex-col break-inside-avoid rounded-2xl border border-gray-200 bg-white shadow-sm ${
          exportMode
            ? "h-[1.88in] overflow-hidden p-[0.12in]"
            : "h-[20rem] overflow-hidden p-4 print:h-44 print:min-h-0 print:rounded-xl print:p-1.5"
      }`}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h2
          className={`min-w-0 truncate font-semibold leading-tight ${
            exportMode
              ? "text-[11px]"
              : "text-lg print:text-xs"
          }`}
        >
          {title}
        </h2>

        {status && (
          <span
            className={`shrink-0 rounded-full border border-amber-200 bg-amber-50 font-semibold uppercase tracking-wide text-amber-700 ${
              exportMode
                ? "px-[0.04in] py-[0.01in] text-[8px]"
                : "px-2 py-0.5 text-[10px] print:px-1 print:py-0 print:text-[8px]"
            }`}
          >
            {status}
          </span>
        )}
      </div>

      <p
        className={`text-gray-500 ${
          exportMode
            ? "mt-[0.03in] truncate text-[9px] leading-[0.11in]"
            : "mt-1 text-xs leading-4 print:mt-0.5 print:truncate print:text-[10px] print:leading-3"
        }`}
      >
        {description}
      </p>

      <div
        className={`dashboard-export-chart-body min-h-0 overflow-hidden ${
          exportMode
            ? "mt-[0.04in] h-[1.5in] flex-none"
            : "mt-3 flex-1 print:mt-1 print:h-32 print:flex-none"
        }`}
      >
        {children}
      </div>
    </div>
  )
}

function DashboardChartEmptyState({
  message = "No decision data yet.",
}: {
  message?: string
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 text-center text-xs text-gray-500">
      {message}
    </div>
  )
}

function DashboardCategoricalChart({
  items,
  barLabel,
  exportMode,
  chartType,
}: {
  items: IndustryMixPoint[]
  barLabel: string
  exportMode?: boolean
  chartType?: "bar" | "donut"
}) {
  const useHorizontalBars =
    chartType === "bar" ||
    (chartType === undefined && items.length > 5)

  return (
    <div
      className={`h-full w-full ${
        exportMode && !useHorizontalBars
          ? "dashboard-export-donut-chart"
          : ""
      }`}
    >
      <div
        className={
          exportMode && !useHorizontalBars
            ? "dashboard-export-donut-plot"
            : "h-full w-full"
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          {useHorizontalBars ? (
        <BarChart
          data={items}
          layout="vertical"
          margin={{
            top: 6,
            right: 10,
            bottom: 6,
            left: 8,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={104}
            tick={{
              fontSize: 11,
            }}
          />
          <Tooltip />
          <Bar
            dataKey="value"
            name={barLabel}
            radius={[0, 6, 6, 0]}
          >
            {items.map(item => (
              <Cell
                key={item.name}
                fill={item.color}
              />
            ))}
          </Bar>
        </BarChart>
        ) : (
          <PieChart>
            <Tooltip />
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              innerRadius="44%"
              outerRadius="72%"
              paddingAngle={3}
              labelLine={!exportMode}
              label={
                exportMode
                  ? false
                  : ({
                    name,
                    value,
                    x,
                    y,
                    textAnchor,
                  }) => (
                    <text
                      x={x}
                      y={y}
                      fill="#111827"
                      fontSize={11}
                      fontWeight={500}
                      textAnchor={textAnchor}
                      dominantBaseline="central"
                      stroke="none"
                    >
                      {`${name}: ${value}${barLabel === "Share" ? "%" : ""}`}
                    </text>
                  )
              }
            >
              {items.map(item => (
                <Cell
                  key={item.name}
                  fill={item.color}
                />
              ))}
            </Pie>
          </PieChart>
        )}
        </ResponsiveContainer>
      </div>

      {exportMode && !useHorizontalBars && (
        <div className="dashboard-export-donut-labels">
          {items.map(item => (
            <span
              key={item.name}
              className="dashboard-export-donut-label"
            >
              <span
                aria-hidden="true"
                className="dashboard-export-donut-label-swatch"
                style={{ backgroundColor: item.color }}
              />
              <span>
                {`${item.name}: ${item.value}${barLabel === "Share" ? "%" : ""}`}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDashboardMonth(monthKey: string) {
  const [year, month] = monthKey.split("-")

  return new Date(
    Number(year),
    Number(month) - 1,
    1
  ).toLocaleString(
    "default",
    { month: "short" }
  )
}

function formatDashboardLabel(value: string) {
  return value
    .replaceAll(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /\b\w/g,
      character => character.toUpperCase()
    )
}

function getDatasetColumns(
  rows: DashboardDatasetRow[],
  metrics?: DashboardDatasetMetric[]
) {
  const columnNames = new Set<string>()

  metrics?.forEach(metric => {
    columnNames.add(metric.column)
  })

  rows.slice(0, 25).forEach(row => {
    Object.keys(row).forEach(column => {
      columnNames.add(column)
    })
  })

  return Array.from(columnNames)
}

function normalizeColumnName(column: string) {
  return column
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()
}

function findColumnByHints(
  columns: string[],
  hints: string[],
  rows: DashboardDatasetRow[] = [],
  requireNumeric = false
) {
  if (!hints.length) {
    return undefined
  }

  const normalizedHints =
    hints.map(normalizeColumnName)

  return columns.find(column => {
    const normalizedColumn =
      normalizeColumnName(column)

    const nameMatches = normalizedHints.some(
      hint =>
        normalizedColumn === hint ||
        normalizedColumn.includes(hint) ||
        hint.includes(normalizedColumn)
    )

    if (!nameMatches) {
      return false
    }

    return !requireNumeric || columnHasNumericValues(rows, column)
  })
}

function columnHasNumericValues(
  rows: DashboardDatasetRow[],
  column: string
) {
  if (!rows.length) {
    return true
  }

  return rows
    .slice(0, 25)
    .some(row => isNumericCell(row[column]))
}

function isNumericCell(
  value: DashboardDatasetCell
) {
  if (typeof value === "number") {
    return Number.isFinite(value)
  }

  if (typeof value !== "string" || !value.trim()) {
    return false
  }

  return parseNumericString(value) !== null
}

function parseNumericString(
  value: string
) {
  const trimmedValue = value.trim()
  const isAccountingNegative =
    trimmedValue.startsWith("(") &&
    trimmedValue.endsWith(")")
  const unsignedValue = isAccountingNegative
    ? trimmedValue.slice(1, -1)
    : trimmedValue
  const numericValue = Number(
    unsignedValue.replaceAll(/[$,%\s,]/g, "")
  )

  if (!Number.isFinite(numericValue)) {
    return null
  }

  return isAccountingNegative
    ? -numericValue
    : numericValue
}

function toNumber(value: DashboardDatasetCell) {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : 0
  }

  if (typeof value !== "string") {
    return 0
  }

  return parseNumericString(value) ?? 0
}

function sumNumericColumn(
  rows: DashboardDatasetRow[],
  column: string
) {
  return rows.reduce(
    (total, row) => total + toNumber(row[column]),
    0
  )
}

function averageNumericColumn(
  rows: DashboardDatasetRow[],
  column: string
) {
  const numericRows = rows.filter(row => {
    return isNumericCell(row[column])
  })

  if (!numericRows.length) {
    return 0
  }

  return sumNumericColumn(
    numericRows,
    column
  ) / numericRows.length
}

function getNumericTotal(
  datasetTotal: number | undefined,
  rows: DashboardDatasetRow[],
  column: string
) {
  return typeof datasetTotal === "number" &&
    Number.isFinite(datasetTotal)
    ? datasetTotal
    : sumNumericColumn(rows, column)
}

function getNumericAverage(
  datasetAverage: number | undefined,
  rows: DashboardDatasetRow[],
  column: string
) {
  return typeof datasetAverage === "number" &&
    Number.isFinite(datasetAverage)
    ? datasetAverage
    : averageNumericColumn(rows, column)
}

function isAverageLikeMetric(
  normalizedColumn: string
) {
  return [
    "average",
    "avg",
    "rate",
    "margin",
    "percent",
    "percentage",
    "ratio",
    "conversion",
    "utilization",
    "capacity",
    "coverage",
    "score",
    "turn",
    "turns",
    "price",
    "check",
    "cac",
  ].some(term => normalizedColumn.includes(term))
}

function getGroupKey(
  value: DashboardDatasetCell,
  fallback: string
) {
  if (value instanceof Date) {
    return value.toLocaleDateString()
  }

  const cleanValue =
    String(value ?? "").trim()

  return cleanValue || fallback
}

function buildCategoryBarData(
  rows: DashboardDatasetRow[],
  groupColumn: string,
  valueColumn: string
) {
  const grouped =
    groupRowsByValue(
      rows,
      groupColumn,
      valueColumn,
      true
    )

  return grouped.slice(0, 6)
}

function buildMixData(
  rows: DashboardDatasetRow[],
  groupColumn: string,
  valueColumn: string
) {
  const grouped =
    groupRowsByValue(
      rows,
      groupColumn,
      valueColumn
    )
  const total = grouped.reduce(
    (sum, item) => sum + item.value,
    0
  )
  const visibleGroups = grouped.slice(0, 5)
  const otherValue = grouped
    .slice(5)
    .reduce(
      (sum, item) => sum + item.value,
      0
    )

  if (otherValue > 0) {
    visibleGroups.push({
      name: "Other",
      value: otherValue,
    })
  }

  const percentages = buildSharePercentages(
    visibleGroups.map(item => item.value),
    total
  )

  return visibleGroups.map((item, index) => ({
    name: item.name,
    value: percentages[index] ?? item.value,
    color:
      dashboardChartPalette[
        index % dashboardChartPalette.length
      ],
  }))
}

function buildSharePercentages(
  values: number[],
  total: number
) {
  if (total <= 0) {
    return values
  }

  const rawPercentages = values.map(
    value => (value / total) * 100
  )
  const percentages = rawPercentages.map(
    value => Math.floor(value)
  )
  let remaining =
    100 - percentages.reduce(
      (sum, value) => sum + value,
      0
    )

  const remainderOrder = rawPercentages
    .map((value, index) => ({
      index,
      remainder: value - Math.floor(value),
    }))
    .sort((a, b) => b.remainder - a.remainder)

  for (let index = 0; remaining > 0; index += 1) {
    const target =
      remainderOrder[index % remainderOrder.length]

    if (!target) {
      break
    }

    percentages[target.index] += 1
    remaining -= 1
  }

  return percentages
}

function groupRowsByValue(
  rows: DashboardDatasetRow[],
  groupColumn: string,
  valueColumn: string,
  includeNegative = false
) {
  const grouped = new Map<
    string,
    {
      name: string
      value: number
    }
  >()

  rows.forEach(row => {
    const groupName = getGroupKey(
      row[groupColumn],
      "Unspecified"
    )
    const groupKey = groupName.toLocaleLowerCase()
    const current =
      grouped.get(groupKey) ?? {
        name: groupName,
        value: 0,
      }

    current.value += toNumber(
      row[valueColumn]
    )
    grouped.set(groupKey, current)
  })

  return Array.from(grouped.values())
    .filter(item =>
      includeNegative
        ? item.value !== 0
        : item.value > 0
    )
    .sort((a, b) => b.value - a.value)
}

function buildTrendData(
  rows: DashboardDatasetRow[],
  dateColumn: string,
  primaryColumn: string,
  secondaryColumn?: string
) {
  const grouped = new Map<
    string,
    {
      value: number
      secondary: number
    }
  >()

  rows.forEach((row, index) => {
    const name = getGroupKey(
      row[dateColumn],
      `P${index + 1}`
    )
    const current =
      grouped.get(name) ?? {
        value: 0,
        secondary: 0,
      }

    current.value += toNumber(row[primaryColumn])

    if (secondaryColumn) {
      current.secondary += toNumber(row[secondaryColumn])
    }

    grouped.set(name, current)
  })

  return Array.from(grouped.entries())
    .sort(([firstName], [secondName]) =>
      compareDashboardPeriods(
        firstName,
        secondName
      )
    )
    .slice(-8)
    .map(([name, values]) => ({
      name,
      value: Math.round(values.value),
      secondary: secondaryColumn
        ? Math.round(values.secondary)
        : undefined,
    }))
}

function compareDashboardPeriods(
  first: string,
  second: string
) {
  const datePattern = /[-/]|[a-z]/i
  const firstDate = datePattern.test(first)
    ? Date.parse(first)
    : Number.NaN
  const secondDate = datePattern.test(second)
    ? Date.parse(second)
    : Number.NaN

  if (
    Number.isFinite(firstDate) &&
    Number.isFinite(secondDate)
  ) {
    return firstDate - secondDate
  }

  return first.localeCompare(
    second,
    undefined,
    { numeric: true }
  )
}

function formatMappedMetricValue(
  value: number,
  column: string
) {
  const normalizedColumn = normalizeColumnName(column)
  const isCurrency = [
    "revenue",
    "sales",
    "amount",
    "price",
    "cost",
    "profit",
    "spend",
    "budget",
    "donation",
    "rent",
    "commission",
    "pipeline",
  ].some(term => normalizedColumn.includes(term))
  const prefix = isCurrency ? "$" : ""

  if (Math.abs(value) >= 1_000_000) {
    return `${prefix}${(value / 1_000_000).toFixed(1)}M`
  }

  if (Math.abs(value) >= 1_000) {
    return `${prefix}${(value / 1_000).toFixed(1)}K`
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value)
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value)
}

function signalToneClass(
  tone: IndustryDashboardConfig["signals"][number]["tone"]
) {
  if (tone === "green") {
    return "border-green-100 bg-green-50 text-green-800"
  }

  if (tone === "amber") {
    return "border-amber-100 bg-amber-50 text-amber-800"
  }

  if (tone === "red") {
    return "border-red-100 bg-red-50 text-red-800"
  }

  if (tone === "purple") {
    return "border-purple-100 bg-purple-50 text-purple-800"
  }

  return "border-blue-100 bg-blue-50 text-blue-800"
}

export const dashboardRegistry: Record<
  DashboardComponentKey,
  (props: DashboardPlaceholderProps) => ReactNode
> = {
  generalBusiness: () => null,
  marketingPerformance: MarketingPerformanceDashboard,
  salesPerformance: SalesPerformanceDashboard,
  decisionPerformance: DecisionPerformanceDashboard,
  retailPerformance: props => (
    <IndustryDashboard
      {...props}
      config={industryDashboardConfigs.retailPerformance}
    />
  ),
  restaurantPerformance: props => (
    <IndustryDashboard
      {...props}
      config={industryDashboardConfigs.restaurantPerformance}
    />
  ),
  professionalServices: props => (
    <IndustryDashboard
      {...props}
      config={industryDashboardConfigs.professionalServices}
    />
  ),
  healthcarePractice: props => (
    <IndustryDashboard
      {...props}
      config={industryDashboardConfigs.healthcarePractice}
    />
  ),
  realEstate: props => (
    <IndustryDashboard
      {...props}
      config={industryDashboardConfigs.realEstate}
    />
  ),
  nonprofitPerformance: props => (
    <IndustryDashboard
      {...props}
      config={industryDashboardConfigs.nonprofitPerformance}
    />
  ),
}
