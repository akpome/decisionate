"use client"

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useUser } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import {
  FileDown,
  Maximize2,
  Share2,
  Unlink,
  X,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
  DashboardAggregation,
  DashboardValueAggregation,
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
import {
  aggregateSummaryAwareValues,
  isInternalSummaryColumn,
  isHistoricalSummaryRow,
} from "@/features/dashboard/lib/summary-aggregation"

type DashboardPlaceholderProps = {
  name: string
  description: string
  highlights: string[]
  dataset?: DashboardDatasetInput | null
  datasetName?: string
  datasetId?: number
  aggregation?: DashboardAggregation
  aggregationType?: DashboardValueAggregation
  analysisMetric?: string
  analysisLoading?: boolean
  analysisError?: boolean
  onRetryAnalysis?: () => void
  manualMapping?: DashboardMetricMapping
  chartTitles?: DashboardChartTitles
  decisionSummary?: DecisionSummary | null
  controls?: ReactNode
  managementActions?: ReactNode
  managementPanels?: ReactNode
  showAnalysisPanel?: boolean
  status?: ReactNode
  brand?: WorkspaceBrand
  canManageWorkspaceData?: boolean
  canCreateDecisions?: boolean
  onCreateDecision?: () => void
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
  demoMode?: boolean
  headerControls?: ReactNode
  showActions?: boolean
  exportMode?: boolean
}

export type {
  DashboardAggregation,
  DashboardValueAggregation,
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
  count?: number
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
  valueColumn?: string
}

type IndustryMixPoint = {
  name: string
  value: number
  color: string
  rawValue?: number
  percentage?: number
  valueColumn?: string
}

type IndustryDashboardConfig = {
  kpiMode?: "sales"
  metrics: IndustryMetric[]
  trendTitle: string
  trendDescription: string
  trendData: IndustryChartPoint[]
  trendLabel: string
  trendDataLabel?: string
  trendDateLabel?: string
  trendStatus?: string
  secondaryTrendLabel?: string
  mixTitle: string
  mixDescription: string
  mixData: IndustryMixPoint[]
  mixDataLabel?: string
  mixStatus?: string
  operationsTitle: string
  operationsDescription: string
  operationsData: IndustryChartPoint[]
  operationsLabel: string
  operationsDataLabel?: string
  operationsStatus?: string
  signalTitle: string
  roleHints: {
    primary: string[]
    secondary?: string[]
    conversion?: string[]
    dealCount?: string[]
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
  hotelHospitality: {
    metrics: [
      {
        label: "Occupancy",
        value: "78%",
        detail: "+6 pts versus last period",
      },
      {
        label: "ADR",
        value: "$164",
        detail: "Average daily rate",
      },
      {
        label: "RevPAR",
        value: "$128",
        detail: "Revenue per available room",
      },
      {
        label: "Guest Satisfaction",
        value: "4.6/5",
        detail: "Strong review momentum",
      },
    ],
    trendTitle: "Occupancy and RevPAR Trend",
    trendDescription:
      "Room occupancy compared with revenue per available room.",
    trendData: [
      { name: "Jan", value: 68, secondary: 104 },
      { name: "Feb", value: 72, secondary: 112 },
      { name: "Mar", value: 75, secondary: 119 },
      { name: "Apr", value: 73, secondary: 116 },
      { name: "May", value: 78, secondary: 128 },
    ],
    trendLabel: "Occupancy",
    secondaryTrendLabel: "RevPAR",
    mixTitle: "Room Revenue Mix",
    mixDescription:
      "Room revenue contribution by room type.",
    mixData: [
      { name: "Standard", value: 36, color: "#0f766e" },
      { name: "Deluxe", value: 28, color: "#2563eb" },
      { name: "Suite", value: 22, color: "#f97316" },
      { name: "Group rooms", value: 14, color: "#9333ea" },
    ],
    operationsTitle: "Booking Channel Performance",
    operationsDescription:
      "Room nights by booking and distribution channel.",
    operationsData: [
      { name: "Direct", value: 84 },
      { name: "OTA", value: 72 },
      { name: "Corporate", value: 61 },
      { name: "Group", value: 48 },
    ],
    operationsLabel: "Room nights",
    signalTitle: "Hotel Highlights",
    roleHints: {
      primary: [
        "revenue",
        "room revenue",
        "adr",
        "average daily rate",
        "revpar",
        "room",
        "booking",
      ],
      category: [
        "room type",
        "room",
        "segment",
        "channel",
        "property",
        "rate",
      ],
      stage: [
        "booking",
        "reservation",
        "status",
        "occupancy",
        "cancellation",
      ],
      date: ["date", "day", "week", "month", "check-in", "booking"],
    },
    signals: [
      { label: "Best channel", value: "Direct", tone: "green" },
      { label: "Cancellation rate", value: "8.4%", tone: "amber" },
      { label: "Peak demand", value: "Fri-Sat", tone: "blue" },
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
  constructionPerformance: {
    metrics: [
      {
        label: "Contracted Revenue",
        value: "$2.4M",
        detail: "+11% new work secured",
      },
      {
        label: "Gross Margin",
        value: "24%",
        detail: "1.8 pts above target",
      },
      {
        label: "Schedule Health",
        value: "92%",
        detail: "Projects on planned pace",
      },
      {
        label: "Cost to Complete",
        value: "$418K",
        detail: "Needs weekly review",
      },
    ],
    trendTitle: "Project Progress and Cost Trend",
    trendDescription:
      "Planned delivery progress compared with cost burn.",
    trendData: [
      { name: "Jan", value: 58, secondary: 42 },
      { name: "Feb", value: 64, secondary: 48 },
      { name: "Mar", value: 71, secondary: 55 },
      { name: "Apr", value: 78, secondary: 61 },
      { name: "May", value: 86, secondary: 66 },
    ],
    trendLabel: "Progress",
    secondaryTrendLabel: "Cost burn",
    mixTitle: "Project Mix",
    mixDescription:
      "Contracted value by project type.",
    mixData: [
      { name: "Commercial", value: 38, color: "#ca8a04" },
      { name: "Residential", value: 29, color: "#2563eb" },
      { name: "Renovation", value: 19, color: "#16a34a" },
      { name: "Infrastructure", value: 14, color: "#9333ea" },
    ],
    operationsTitle: "Project Delivery Status",
    operationsDescription:
      "Active projects by schedule and delivery status.",
    operationsData: [
      { name: "On track", value: 62 },
      { name: "Watch", value: 22 },
      { name: "At risk", value: 11 },
      { name: "Complete", value: 5 },
    ],
    operationsLabel: "Projects",
    signalTitle: "Project Highlights",
    roleHints: {
      primary: ["revenue", "contract", "budget", "cost", "amount", "value"],
      category: ["project", "type", "sector", "building", "client"],
      stage: ["status", "phase", "stage", "progress", "schedule"],
      date: ["date", "month", "week", "start", "completion"],
    },
    signals: [
      { label: "Best margin", value: "Commercial", tone: "green" },
      { label: "Schedule risk", value: "2 projects", tone: "amber" },
      { label: "Open change orders", value: "7", tone: "blue" },
    ],
  },
  lawFirmPerformance: {
    metrics: [
      {
        label: "Billable Revenue",
        value: "$486K",
        detail: "+13% this period",
      },
      {
        label: "Realization",
        value: "87%",
        detail: "3 pts above target",
      },
      {
        label: "Utilization",
        value: "74%",
        detail: "Healthy team capacity",
      },
      {
        label: "Open Matters",
        value: "128",
        detail: "18 need partner review",
      },
    ],
    trendTitle: "Matter Revenue and Realization",
    trendDescription:
      "Billable revenue compared with collected realization.",
    trendData: [
      { name: "Jan", value: 312, secondary: 72 },
      { name: "Feb", value: 338, secondary: 75 },
      { name: "Mar", value: 402, secondary: 78 },
      { name: "Apr", value: 451, secondary: 82 },
      { name: "May", value: 486, secondary: 87 },
    ],
    trendLabel: "Revenue",
    secondaryTrendLabel: "Realization",
    mixTitle: "Matter Mix",
    mixDescription:
      "Open matter distribution by practice area.",
    mixData: [
      { name: "Litigation", value: 34, color: "#7c3aed" },
      { name: "Corporate", value: 28, color: "#2563eb" },
      { name: "Real estate", value: 21, color: "#16a34a" },
      { name: "Employment", value: 17, color: "#f97316" },
    ],
    operationsTitle: "Matter Workflow",
    operationsDescription:
      "Matters by their current delivery stage.",
    operationsData: [
      { name: "Intake", value: 24 },
      { name: "Active", value: 68 },
      { name: "Awaiting client", value: 19 },
      { name: "Closing", value: 17 },
    ],
    operationsLabel: "Matters",
    signalTitle: "Practice Highlights",
    roleHints: {
      primary: ["revenue", "billable", "fee", "amount", "hours", "billing"],
      category: ["matter", "practice", "area", "client", "type"],
      stage: ["status", "stage", "matter", "workflow"],
      date: ["date", "month", "opened", "close", "billing"],
    },
    signals: [
      { label: "Top practice", value: "Litigation", tone: "purple" },
      { label: "Collection gap", value: "$38K", tone: "amber" },
      { label: "Partner review", value: "18 matters", tone: "blue" },
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
  kpiMode: "sales",
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
    secondary: ["pipeline", "forecast", "open opportunity", "qualified pipeline"],
    conversion: ["conversion", "win rate", "close rate", "won rate"],
    dealCount: ["deal count", "deals", "opportunities", "bookings"],
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

  const dateColumn =
    findColumnByHints(
      columns,
      getDashboardDateHints(
        industryConfig.roleHints.date
      ),
      rows
    ) ??
    dataset.chart?.x_key ??
    getFirstNonNumericColumn(columns, rows)
  const categoryColumn =
    findColumnByHints(
      columns,
      industryConfig.roleHints.category ?? [],
      rows,
      false,
      true
    ) ??
    getFirstNonNumericColumn(
      columns,
      rows,
      dateColumn ? [dateColumn] : []
    )

  const primaryColumn = findColumnByHints(
    columns,
    industryConfig.roleHints.primary,
    rows,
    true
  )
  const secondaryColumn = findColumnByHints(
    columns.filter(column => column !== primaryColumn),
    industryConfig.roleHints.secondary ?? [],
    rows,
    true
  )

  return {
    primary: primaryColumn,
    secondary: secondaryColumn,
    operationsValue: primaryColumn,
    category:
      categoryColumn,
    stage:
      findColumnByHints(
        columns,
        industryConfig.roleHints.stage ?? [],
        rows,
        false,
        true
      ),
    date:
      dateColumn,
  }
}

function buildMappedIndustryDashboard(
  config: IndustryDashboardConfig,
  dataset?: DashboardDatasetInput | null,
  manualMapping?: DashboardMetricMapping,
  aggregation: DashboardAggregation = "monthly",
  aggregationType: DashboardValueAggregation = "sum"
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
    requireNumeric = false,
    requireNonNumeric = false
  ) =>
    value &&
      columns.includes(value) &&
      (!requireNumeric ||
        columnHasNumericValues(rows, value)) &&
      (!requireNonNumeric ||
        !columnHasNumericValues(rows, value))
      ? value
      : undefined
  const mappedPrimaryColumn =
    getValidManualColumn(
      manualMapping?.primary,
      true
    ) || primaryColumn
  const secondaryColumn = findColumnByHints(
    columns.filter(column => column !== mappedPrimaryColumn),
    config.roleHints.secondary ?? [],
    rows,
    true
  )
  const mappedSecondaryColumn =
    getValidManualColumn(
      manualMapping?.secondary,
      true
    ) || secondaryColumn
  const mappedOperationsValueColumn =
    getValidManualColumn(
      manualMapping?.operationsValue,
      true
    ) || mappedPrimaryColumn
  const dateColumn =
    getValidManualColumn(
      manualMapping?.date
    ) ||
    findColumnByHints(
      columns,
      getDashboardDateHints(
        config.roleHints.date
      ),
      rows
    ) ||
    getValidManualColumn(
      dataset?.chart?.x_key
    ) ||
    getFirstNonNumericColumn(columns, rows)
  const categoryColumn = findColumnByHints(
    columns,
    config.roleHints.category ?? [],
    rows,
    false,
    true
  )
  const mappedCategoryColumn =
    getValidManualColumn(
      manualMapping?.category,
      false,
      false
    ) ||
    categoryColumn ||
    getFirstNonNumericColumn(
      columns,
      rows,
      dateColumn ? [dateColumn] : []
    )
  const stageColumn = findColumnByHints(
    columns,
    config.roleHints.stage ?? [],
    rows,
    false,
    true
  )
  const mappedStageColumn =
    getValidManualColumn(
      manualMapping?.stage,
      false,
      false
    ) || stageColumn
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

  if (
    !rows.length ||
    (!mappedPrimaryColumn && !mappedOperationsValueColumn)
  ) {
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
      trendDataLabel: undefined,
      trendDateLabel: undefined,
      trendStatus: readinessStatus,
      mixDescription: hasDataset
        ? "Map a category column to render this mix."
        : "Select a dataset to render this mix with real data.",
      mixData: [],
      mixDataLabel: undefined,
      mixStatus: readinessStatus,
      operationsDescription: hasDataset
        ? "Map a stage or status column to render this breakdown."
        : "Select a dataset to render this breakdown with real data.",
      operationsData: [],
      operationsLabel: "Mapped value",
      operationsDataLabel: undefined,
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
          value:
            mappedPrimaryColumn ??
            mappedOperationsValueColumn ??
            "Needs mapping",
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

  const displayValueColumn =
    (mappedPrimaryColumn ?? mappedOperationsValueColumn)!
  const primaryMetric = dataset?.metrics?.find(
    metric => metric.column === displayValueColumn
  )
  const primaryValue = getNumericAggregate(
    primaryMetric,
    rows,
    displayValueColumn,
    aggregationType
  )
  const primaryLabel = formatDashboardLabel(
    displayValueColumn
  )
  const operationsPrimaryLabel = formatDashboardLabel(
    mappedOperationsValueColumn ?? displayValueColumn
  )
  const mappedMetrics = [
    {
      label: primaryLabel,
      value: formatMappedMetricValue(
        primaryValue,
        displayValueColumn
      ),
      detail: getAggregationDetail(
        primaryMetric,
        rows.length,
        aggregationType
      ),
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
          mappedSecondaryColumn,
          mappedOperationsValueColumn,
          mappedCategoryColumn,
          mappedStageColumn,
          dateColumn,
        ].filter(Boolean).length
      ),
      detail: "Chart columns detected",
    },
  ]
  const trendData = dateColumn && mappedPrimaryColumn
    ? buildTrendData(
        rows,
        dateColumn,
        mappedPrimaryColumn,
        mappedSecondaryColumn,
        aggregation,
        aggregationType
      )
    : []
  const mixData =
    mappedCategoryColumn && mappedPrimaryColumn
    ? buildMixData(
        rows,
        mappedCategoryColumn,
        mappedPrimaryColumn,
        aggregationType
      )
    : []
  const operationsData =
    mappedStageColumn && mappedOperationsValueColumn
    ? buildCategoryBarData(
        rows,
        mappedStageColumn,
        mappedOperationsValueColumn,
        aggregationType
      )
    : []
  const leadingGroup =
    mixData[0] ?? operationsData[0]

  const conversionColumn = findColumnByHints(
    columns.filter(
      column =>
        column !== mappedPrimaryColumn &&
        column !== mappedSecondaryColumn
    ),
    config.roleHints.conversion ?? [],
    rows,
    true
  )
  const dealCountColumn = findColumnByHints(
    columns.filter(
      column =>
        column !== mappedPrimaryColumn &&
        column !== mappedSecondaryColumn &&
        column !== conversionColumn
    ),
    config.roleHints.dealCount ?? [],
    rows,
    true
  )
  const salesMetrics = config.kpiMode === "sales"
    ? buildSalesKpiMetrics({
      rows,
      metrics: dataset?.metrics ?? [],
      primaryColumn: mappedPrimaryColumn,
      secondaryColumn: mappedSecondaryColumn,
      conversionColumn,
      dealCountColumn,
      aggregationType,
      trendData,
    })
    : mappedMetrics
  const salesSignals = config.kpiMode === "sales"
    ? buildSalesSignals({
      metrics: salesMetrics,
      conversionColumn,
      secondaryColumn: mappedSecondaryColumn,
      operationsData,
    })
    : config.signals

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
    metrics: salesMetrics,
    trendDescription: dateColumn && mappedPrimaryColumn
      ? `${config.trendDescription} Tracking ${primaryLabel} by ${formatDashboardLabel(dateColumn)}${config.kpiMode === "sales" && mappedSecondaryColumn ? ` with ${formatDashboardLabel(mappedSecondaryColumn)} as pipeline context` : ""}.`
      : "Map a date or period column to render this trend with real data.",
    trendData,
    trendLabel: primaryLabel,
    trendDataLabel: dateColumn && mappedPrimaryColumn
      ? `Y-axis: ${primaryLabel}${mappedSecondaryColumn ? `, ${formatDashboardLabel(mappedSecondaryColumn)}` : ""} | X-axis: ${formatDashboardLabel(dateColumn)}`
      : undefined,
    trendDateLabel: dateColumn
      ? formatDashboardLabel(dateColumn)
      : undefined,
    secondaryTrendLabel: mappedSecondaryColumn
      ? formatDashboardLabel(mappedSecondaryColumn)
      : undefined,
    trendStatus: dateColumn && mappedPrimaryColumn
      ? undefined
      : "Needs mapping",
    mixDescription:
      mappedCategoryColumn && mappedPrimaryColumn
        ? `${config.mixDescription} Grouped by ${formatDashboardLabel(mappedCategoryColumn)}.`
        : "Map a category, source, or segment column to render this mix with real data.",
    mixStatus: mappedCategoryColumn && mappedPrimaryColumn
      ? undefined
      : "Needs mapping",
    mixData,
    mixDataLabel:
      mappedCategoryColumn && mappedPrimaryColumn
        ? `Value: ${primaryLabel} | Grouped by: ${formatDashboardLabel(mappedCategoryColumn)}`
        : undefined,
    operationsDescription:
      mappedStageColumn && mappedOperationsValueColumn
        ? `${config.operationsDescription} Grouped by ${formatDashboardLabel(mappedStageColumn)} using ${operationsPrimaryLabel}.`
        : "Map a stage or status column and a numeric Y-axis value to render this breakdown with real data.",
    operationsStatus: mappedStageColumn && mappedOperationsValueColumn
      ? undefined
      : "Needs mapping",
    operationsData,
    operationsLabel: operationsPrimaryLabel,
    operationsDataLabel:
      mappedStageColumn && mappedOperationsValueColumn
        ? `Y-axis: ${operationsPrimaryLabel} | X-axis: ${formatDashboardLabel(mappedStageColumn)}`
        : undefined,
    signals: config.kpiMode === "sales" ? salesSignals : [
      {
        label: "Tracked value",
        value: formatDashboardLabel(displayValueColumn),
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

function SalesDecisionateAnalysis({
  dashboard,
  analysis,
  analysisLoading = false,
  analysisError = false,
  onRetryAnalysis,
  onCreateRecommendation,
  onCreateDecision,
  creatingRecommendation = false,
}: {
  dashboard: IndustryDashboardConfig
  analysis?: AIAnalysis | null
  analysisLoading?: boolean
  analysisError?: boolean
  onRetryAnalysis?: () => void
  onCreateRecommendation?: () => void
  onCreateDecision?: () => void
  creatingRecommendation?: boolean
}) {
  const trendData = dashboard.trendData
  const latest = trendData[trendData.length - 1]
  const previous = trendData[trendData.length - 2]
  const revenueSignal = dashboard.signals.find(
    signal => signal.label === "Revenue"
  )
  const conversionSignal = dashboard.signals.find(
    signal => signal.label === "Conversion rate"
  )
  const pipelineSignal = dashboard.signals.find(
    signal => signal.label === "Pipeline"
  )
  const whatChanged = latest && previous
    ? `${dashboard.trendLabel} is ${revenueSignal?.value.toLowerCase() ?? "being compared with the prior period"}; the latest value is ${formatInteger(latest.value)} versus ${formatInteger(previous.value)} previously${latest.secondary !== undefined ? `, with ${dashboard.secondaryTrendLabel ?? "pipeline"} at ${formatInteger(latest.secondary)}` : ""}.`
    : "A recent comparison is not available for the selected period."
  const attention = analysis?.risks[0]
    ?? (conversionSignal?.value === "Needs mapping"
      ? "Conversion rate is not mapped. Add a conversion or win-rate field before relying on funnel performance."
      : pipelineSignal?.value === "Needs mapping"
        ? "Pipeline value is not mapped. Add a pipeline or forecast field to put bookings in context."
        : "Review pipeline coverage and movement through the sales stages for the selected period.")
  const recommendation = analysisLoading
    ? "Updating the recommendation for the selected sales metrics..."
    : analysis?.recommendations[0]
      ?? (analysisError
        ? "AI analysis is unavailable. Review the evidence and record a decision when the next sales action is clear."
        : "Review pipeline coverage and stage movement, then record the action and expected outcome as a decision.")

  return (
    <section className="flex h-full flex-col rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-3 text-[var(--decisionate-brand-primary-text)] sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Decisionate Analysis</p>

        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {analysis?.confidence
                ? `${analysis.confidence} confidence`
                : "Sales attention"}
          </span>

          {analysisError && onRetryAnalysis && (
            <button
              type="button"
              onClick={onRetryAnalysis}
              className="text-xs font-semibold underline decoration-current/30 underline-offset-4 hover:opacity-80"
            >
              Retry analysis
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 border-t border-[var(--decisionate-brand-primary-ring)]/70 pt-3 text-xs sm:grid-cols-3">
        <div>
          <p className="font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]/70">
            What changed
          </p>
          <p className="mt-1 leading-5 text-gray-700">{whatChanged}</p>
        </div>
        <div>
          <p className="font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]/70">
            What needs attention
          </p>
          <p className="mt-1 leading-5 text-gray-700">{attention}</p>
        </div>
        <div>
          <p className="font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]/70">
            Recommendation
          </p>
          <p className="mt-1 leading-5 text-gray-700">{recommendation}</p>
        </div>
      </div>

      {(onCreateRecommendation && analysis?.recommendations.length) ||
        onCreateDecision ? (
        <div className="mt-auto flex items-center justify-start pt-4">
          <button
            type="button"
            onClick={
              analysis?.recommendations.length &&
              onCreateRecommendation
                ? onCreateRecommendation
                : onCreateDecision
            }
            disabled={creatingRecommendation}
            className="inline-flex items-center rounded-md bg-[var(--decisionate-brand-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingRecommendation
              ? "Creating decision..."
              : "Create decision"}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function IndustryDashboard({
  name,
  description,
  dataset,
  aggregation = "monthly",
  aggregationType = "sum",
  analysisMetric,
  analysisLoading,
  analysisError,
  onRetryAnalysis,
  manualMapping,
  chartTitles,
  config,
  controls,
  managementActions,
  managementPanels,
  showAnalysisPanel,
  status,
  brand,
  onDownloadPdf,
  onShare,
  onStopSharing,
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
  demoMode,
  headerControls,
  showActions,
  exportMode,
}: DashboardPlaceholderProps & {
  config: IndustryDashboardConfig
}) {
  const dashboardConfig =
    buildMappedIndustryDashboard(
      config,
      dataset,
      manualMapping,
      aggregation,
      aggregationType
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
  const analysisPanelClassName = controls
    ? "grid min-w-0 items-stretch gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(30rem,1fr)]"
    : "grid min-w-0 items-stretch gap-3"
  const decisionateAnalysisPanel = (
    <div className={analysisPanelClassName}>
      {dashboardConfig.kpiMode === "sales" ? (
        <SalesDecisionateAnalysis
          dashboard={dashboardConfig}
          analysis={
            !analysisMetric ||
            dataset?.ai_analysis?.metric === analysisMetric
              ? dataset?.ai_analysis
              : null
          }
          analysisLoading={analysisLoading}
          analysisError={analysisError}
          onRetryAnalysis={onRetryAnalysis}
          onCreateRecommendation={undefined}
          onCreateDecision={undefined}
          creatingRecommendation={creatingRecommendation}
        />
      ) : (
        <div className="min-w-0">
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
              title="Decisionate Analysis"
              metric={analysisMetric}
              className="h-full print:hidden !p-3"
              onCreateDecision={undefined}
              creatingDecision={creatingRecommendation}
            />
          )}
        </div>
      )}

      {showActions !== false && controls && (
        <div className="h-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 p-3 shadow-sm print:hidden">
          {controls}
        </div>
      )}
    </div>
  )

  return (
    <div className="dashboard-export-dashboard space-y-4 print:space-y-1.5">
      <DashboardHeader
        name={name}
        description={description}
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
        showStopSharing={false}
        showActions={showActions}
        exportMode={exportMode}
      />

      {managementActions && (
        <div className="flex min-w-0 justify-end print:hidden">
          {managementActions}
        </div>
      )}

      {managementPanels}

      <IndustryKpiGrid
        metrics={dashboardConfig.metrics}
        dashboardName={name}
        demoMode={demoMode}
        headerControls={headerControls}
        exportMode={exportMode}
      />

      {showAnalysisPanel !== false && !exportMode && (
        <div id="industry-dashboard-analysis-panel">
          {decisionateAnalysisPanel}
        </div>
      )}

      <div className="dashboard-export-chart-grid grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:gap-2">
        <DashboardChartCard
          title={resolvedChartTitles.trend}
          dataLabel={dashboardConfig.trendDataLabel}
          description={dashboardConfig.trendDescription}
          status={dashboardConfig.trendStatus}
          canFullscreen={dashboardConfig.trendData.length > 0}
          exportMode={exportMode}
        >
          {dashboardConfig.trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={dashboardConfig.trendData}
                margin={{
                  top: 0,
                  right: 10,
                  bottom: 42,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  angle={-35}
                  textAnchor="end"
                  height={48}
                  tickMargin={8}
                  label={
                    dashboardConfig.trendDateLabel
                      ? {
                        value: dashboardConfig.trendDateLabel,
                        position: "insideBottom",
                        offset: -28,
                        style: {
                          fill: "#6b7280",
                          fontSize: 10,
                        },
                      }
                      : undefined
                  }
                />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend
                  verticalAlign="top"
                  height={24}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={dashboardConfig.trendLabel}
                  stroke={dashboardChartPalette[0]}
                  strokeWidth={3}
                  dot={false}
                  isAnimationActive={!exportMode}
                />
                {dashboardConfig.secondaryTrendLabel && (
                  <Line
                    type="monotone"
                    dataKey="secondary"
                    name={dashboardConfig.secondaryTrendLabel}
                    stroke={dashboardChartPalette[1]}
                    strokeWidth={3}
                    dot={false}
                    isAnimationActive={!exportMode}
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
          dataLabel={dashboardConfig.mixDataLabel}
          description={dashboardConfig.mixDescription}
          status={dashboardConfig.mixStatus}
          className="dashboard-export-donut-card"
          canFullscreen={dashboardMixData.length > 0}
          exportMode={exportMode}
          fullscreenChildren={
            dashboardMixData.length > 0 ? (
              <div className="h-full min-h-0 overflow-hidden">
                <DashboardCategoricalChart
                  items={dashboardMixData}
                  barLabel="Share"
                  barOrientation="vertical"
                />
              </div>
            ) : undefined
          }
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

      <div className="dashboard-export-chart-grid grid items-stretch gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:gap-2">
        <DashboardChartCard
          title={resolvedChartTitles.operations}
          dataLabel={dashboardConfig.operationsDataLabel}
          description={dashboardConfig.operationsDescription}
          status={dashboardConfig.operationsStatus}
          className="xl:!h-full"
          canFullscreen={dashboardConfig.operationsData.length > 0}
          exportMode={exportMode}
        >
          {dashboardConfig.operationsData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dashboardConfig.operationsData}
                margin={{
                  top: 6,
                  right: 10,
                  bottom: 42,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  angle={-35}
                  textAnchor="end"
                  height={48}
                  tickMargin={8}
                />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="value"
                  name={dashboardConfig.operationsLabel}
                  fill={dashboardChartPalette[1]}
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={!exportMode}
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

        <div className="h-full break-inside-avoid rounded-xl border border-gray-200 bg-white p-4 shadow-sm print:p-2">
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

function IndustryKpiGrid({
  metrics,
  dashboardName,
  demoMode = false,
  headerControls,
  exportMode = false,
}: {
  metrics: IndustryMetric[]
  dashboardName: string
  demoMode?: boolean
  headerControls?: ReactNode
  exportMode?: boolean
}) {
  const scrollRef =
    useRef<HTMLDivElement | null>(null)
  const [canScroll, setCanScroll] =
    useState(false)

  useEffect(() => {
    const node = scrollRef.current

    if (!node || exportMode) {
      setCanScroll(false)
      return
    }

    const updateScrollState = () => {
      setCanScroll(node.scrollWidth > node.clientWidth + 1)
    }

    updateScrollState()
    window.addEventListener("resize", updateScrollState)

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollState)
    observer?.observe(node)

    return () => {
      window.removeEventListener("resize", updateScrollState)
      observer?.disconnect()
    }
  }, [exportMode, metrics.length])

  function scrollKpis(direction: -1 | 1) {
    const node = scrollRef.current

    if (!node) {
      return
    }

    node.scrollBy({
      left:
        direction *
        Math.max(node.clientWidth * 0.9, 320),
      behavior: "smooth",
    })
  }

  const demoStatusLine = demoMode ? (
    <div className="flex min-w-0 flex-1 flex-col items-start gap-2 sm:flex-row sm:items-center">
      <p className="min-w-0 truncate text-xs font-semibold text-blue-700">
        {dashboardName} · Live demo · Read-only sample data · Decisions disabled
      </p>
      {headerControls && (
        <div className="w-full min-w-0 sm:flex-1">
          {headerControls}
        </div>
      )}
    </div>
  ) : null

  return (
    <section className="space-y-2 print:space-y-1.5">
      {(demoStatusLine || canScroll) && (
        <div className="flex min-w-0 items-center justify-between gap-3">
          {demoStatusLine}

          {canScroll && (
            <div className="flex shrink-0 justify-end gap-2">
              <button
                type="button"
                onClick={() => scrollKpis(-1)}
                aria-label="Show previous KPI cards"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-semibold text-gray-600 shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
              >
                ‹
              </button>

              <button
                type="button"
                onClick={() => scrollKpis(1)}
                aria-label="Show more KPI cards"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-semibold text-gray-600 shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        className="dashboard-kpi-scroll flex min-w-0 gap-4 overflow-x-auto scroll-smooth pb-2 print:grid print:grid-cols-4 print:gap-1.5 print:overflow-visible"
      >
        {metrics.map(metric => (
          <div
            key={metric.label}
            className="dashboard-kpi-strip-card industry-kpi-strip-card break-inside-avoid rounded-2xl border border-gray-200 bg-white p-4 shadow-sm print:rounded-xl print:p-1.5"
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

    </section>
  )
}

function DecisionPerformanceDashboard({
  datasetId,
  name,
  description,
  controls,
  status,
  brand,
  canCreateDecisions = false,
  onCreateDecision,
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
      !canCreateDecisions ||
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
        showStopSharing={false}
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

      <div className="dashboard-export-chart-grid grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:gap-3">
        <DashboardChartCard
          title={resolvedChartTitles.mix}
          description="Decision volume grouped by business area."
          className={`order-2 ${
            categoryChartType === "donut"
              ? "dashboard-export-donut-card"
              : ""
          }`}
          exportMode={exportMode}
          fullscreenChildren={
            categoryData.length > 0 ? (
              <div className="h-full min-h-0 overflow-hidden">
                <DashboardCategoricalChart
                  items={categoryData}
                  barLabel="Decisions"
                  chartType={categoryChartType}
                  barOrientation="vertical"
                />
              </div>
            ) : undefined
          }
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
                  bottom: 42,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  angle={-35}
                  textAnchor="end"
                  height={48}
                  tickMargin={8}
                />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="New decisions"
                  stroke="var(--decisionate-brand-primary)"
                  strokeWidth={3}
                  dot={false}
                  isAnimationActive={!exportMode}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <DashboardChartEmptyState />
          )}
        </DashboardChartCard>
      </div>

      <div className="dashboard-export-chart-grid grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] print:gap-3">
        <DashboardChartCard
          title={resolvedChartTitles.outcome}
          description="Evaluated decisions by result mix."
          className={`order-2 ${
            outcomeChartType === "donut"
              ? "dashboard-export-donut-card"
              : ""
          }`}
          exportMode={exportMode}
          fullscreenChildren={
            outcomeData.length > 0 ? (
              <div className="h-full min-h-0 overflow-hidden">
                <DashboardCategoricalChart
                  items={outcomeData}
                  barLabel="Outcomes"
                  chartType={outcomeChartType}
                  barOrientation="vertical"
                />
              </div>
            ) : undefined
          }
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
                  bottom: 42,
                  left: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  angle={-35}
                  textAnchor="end"
                  height={48}
                  tickMargin={8}
                />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="value"
                  name="Outcomes"
                  fill="var(--decisionate-brand-accent)"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={!exportMode}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <DashboardChartEmptyState message="No outcome workflow data yet." />
          )}
        </DashboardChartCard>
      </div>

      {!exportMode && (
        <div className="grid min-w-0 items-stretch gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(30rem,1fr)]">
          <div className="min-w-0">
            {displayedSummary?.ai_analysis ? (
              <AIAnalysisPanel
                analysis={displayedSummary.ai_analysis}
                title="Decisionate Analysis"
                className="h-full print:hidden"
                onCreateDecision={
                  canCreateDecisions && Boolean(datasetId)
                    ? displayedSummary.ai_analysis.recommendations.length > 0
                      ? () => {
                        void handleCreateRecommendation()
                      }
                      : onCreateDecision
                    : undefined
                }
                creatingDecision={creatingRecommendation}
              />
            ) : (
              <div className="flex h-full flex-col rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 print:hidden">
                <p className="font-semibold text-gray-900">
                  Decisionate Analysis
                </p>
                <p className="mt-1">
                  Decision analysis will appear when decision history is available.
                </p>
                {onCreateDecision && (
                  <div className="mt-auto flex items-center justify-start pt-4">
                    <button
                      type="button"
                      onClick={onCreateDecision}
                      className="inline-flex items-center rounded-xl bg-[var(--decisionate-brand-primary)] px-3 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90"
                    >
                      Create decision
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {showActions && controls && (
            <div className="h-full min-w-0 rounded-2xl border border-gray-200 bg-gray-50 p-3 shadow-sm print:hidden">
              {controls}
            </div>
          )}
        </div>
      )}
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
  showStopSharing = true,
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
  showStopSharing?: boolean
  showActions?: boolean
  exportMode?: boolean
}) {
  const showBrandHeader =
    Boolean(brand) && (!showActions || exportMode)

  return (
    <div className="space-y-2 print:space-y-1">
      {brand && showBrandHeader && (
        <div
          className={`items-center justify-between gap-4 rounded-xl bg-white p-3 print:flex print:p-2 ${
            showBrandHeader
              ? "flex"
              : "hidden"
          }`}
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
            {showActions && (
              <>
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
                {showStopSharing && shareEnabled && onStopSharing && (
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
              </>
            )}
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
  dataLabel,
  description,
  status,
  children,
  fullscreenChildren,
  headerControls,
  className = "",
  canFullscreen = false,
  exportMode,
}: {
  title: string
  dataLabel?: string
  description: string
  status?: string
  children: ReactNode
  fullscreenChildren?: ReactNode
  headerControls?: ReactNode
  className?: string
  canFullscreen?: boolean
  exportMode?: boolean
}) {
  const [isFullscreen, setIsFullscreen] =
    useState(false)

  useEffect(() => {
    if (!isFullscreen) {
      return
    }

    const previousOverflow =
      document.body.style.overflow

    document.body.style.overflow = "hidden"

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFullscreen(false)
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown
    )

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener(
        "keydown",
        handleKeyDown
      )
    }
  }, [isFullscreen])

  return (
    <>
      <div
        className={`dashboard-export-chart-card ${className} flex flex-col break-inside-avoid rounded-2xl border border-gray-200 bg-white shadow-sm ${
          exportMode
            ? "h-[1.88in] overflow-hidden p-[0.12in]"
            : "h-[20rem] overflow-hidden p-4 print:h-44 print:min-h-0 print:rounded-xl print:p-1.5"
        }`}
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2
              className={`truncate font-semibold leading-tight ${
                exportMode
                  ? "text-[11px]"
                  : "text-lg print:text-xs"
              }`}
            >
              {title}
            </h2>
            {dataLabel && (
              <p
                className={`truncate font-medium text-[var(--decisionate-brand-primary-text)] ${
                  exportMode
                    ? "mt-[0.01in] text-[8px]"
                    : "mt-0.5 text-[10px] print:text-[8px]"
                }`}
                title={dataLabel}
              >
                {dataLabel}
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 xl:flex-nowrap">
            {headerControls}

            {status && (
              <span
                className={`rounded-full border border-amber-200 bg-amber-50 font-semibold uppercase tracking-wide text-amber-700 ${
                  exportMode
                    ? "px-[0.04in] py-[0.01in] text-[8px]"
                    : "px-2 py-0.5 text-[10px] print:px-1 print:py-0 print:text-[8px]"
                }`}
              >
                {status}
              </span>
            )}

            {canFullscreen && !exportMode && (
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                title={`View ${title} full screen`}
                aria-label={`View ${title} full screen`}
                className="dashboard-print-hidden inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
              >
                <Maximize2 size={14} />
              </button>
            )}
          </div>
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
              : "mt-1 flex-1 print:mt-1 print:h-32 print:flex-none"
          }`}
        >
          {!isFullscreen && children}
        </div>
      </div>

      {isFullscreen && canFullscreen && !exportMode && (
        <div
          className="dashboard-print-hidden fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/60 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} full screen chart`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsFullscreen(false)
            }
          }}
        >
          <div className="flex h-full w-full max-w-[96rem] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-gray-950 sm:text-lg">
                  {title}
                </h2>
                <p className="mt-1 truncate text-xs text-gray-500 sm:text-sm">
                  {description}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                title="Close full screen chart"
                aria-label="Close full screen chart"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 p-4 sm:p-8">
              <div className="h-full min-h-0 w-full">
                {isFullscreen && (fullscreenChildren ?? children)}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
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
  barOrientation,
}: {
  items: IndustryMixPoint[]
  barLabel: string
  exportMode?: boolean
  chartType?: "bar" | "donut"
  barOrientation?: "horizontal" | "vertical"
}) {
  const useHorizontalBars =
    chartType === "bar" ||
    (chartType === undefined && items.length > 5)
  const useVerticalBars =
    useHorizontalBars && barOrientation === "vertical"
  const barTotalValue = items.reduce(
    (total, item) =>
      total + (item.rawValue ?? item.value),
    0
  )
  const totalPieValue = items.reduce(
    (total, item) => total + item.value,
    0
  )
  const getPiePercentage = (item: IndustryMixPoint) =>
    item.percentage ??
    (totalPieValue > 0
      ? (item.value / totalPieValue) * 100
      : 0)
  const getPieValueLabel = (item: IndustryMixPoint) =>
    item.valueColumn && item.rawValue !== undefined
      ? formatMappedMetricValue(
        item.rawValue,
        item.valueColumn
      )
      : formatInteger(
        item.rawValue ?? item.value
      )
  const getPieLabel = (item: IndustryMixPoint) =>
    `${item.name}: ${getPieValueLabel(item)} (${new Intl.NumberFormat(
      "en-US",
      { maximumFractionDigits: 1 }
    ).format(getPiePercentage(item))}%)`
  const barItems = items.map(item => ({
    ...item,
    value: item.rawValue ?? item.value,
    displayLabel: formatCategoryChartLabel(
      item.rawValue ?? item.value,
      barTotalValue,
      item.valueColumn
    ),
  }))

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
          data={barItems}
          layout={useVerticalBars ? "horizontal" : "vertical"}
          margin={{
            top: 6,
            right: 10,
            bottom: useVerticalBars ? 54 : 6,
            left: 8,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type={useVerticalBars ? "category" : "number"}
            dataKey={useVerticalBars ? "name" : undefined}
            angle={useVerticalBars ? -35 : undefined}
            textAnchor={useVerticalBars ? "end" : undefined}
            height={useVerticalBars ? 54 : undefined}
            tickMargin={useVerticalBars ? 8 : undefined}
            allowDecimals={false}
          />
          <YAxis
            type={useVerticalBars ? "number" : "category"}
            dataKey={useVerticalBars ? undefined : "name"}
            width={useVerticalBars ? undefined : 104}
            tick={{
              fontSize: 11,
            }}
          />
          <Tooltip />
          <Bar
            dataKey="value"
            name={barLabel}
            radius={useVerticalBars ? [6, 6, 0, 0] : [0, 6, 6, 0]}
            isAnimationActive={!exportMode}
          >
            <LabelList
              dataKey="displayLabel"
              position={useVerticalBars ? "top" : "right"}
              fill="#374151"
              fontSize={10}
            />
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
              isAnimationActive={!exportMode}
              animationDuration={700}
              animationEasing="ease-out"
              labelLine={false}
              label={false}
            >
              {items.map(item => (
                <Cell
                  key={item.name}
                  fill={item.color}
                />
              ))}
            </Pie>
            {!exportMode && (
              <Pie
                data={items}
                dataKey="value"
                nameKey="name"
                innerRadius="44%"
                outerRadius="72%"
                paddingAngle={3}
                fill="transparent"
                stroke="none"
                className="pointer-events-none"
                isAnimationActive={false}
                labelLine={false}
                label={({
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
                    {getPieLabel(
                      items.find(item => item.name === name) ?? {
                        name: String(name ?? ""),
                        value: Number(value) || 0,
                        color: "#6b7280",
                      }
                    )}
                  </text>
                )}
              >
                {items.map(item => (
                  <Cell
                    key={item.name}
                    fill="transparent"
                    stroke="none"
                  />
                ))}
              </Pie>
            )}
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
                {getPieLabel(item)}
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
      if (!isInternalSummaryColumn(column)) {
        columnNames.add(column)
      }
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

function getDashboardDateHints(
  hints?: string[]
) {
  return Array.from(
    new Set([
      ...(hints ?? []),
      "date",
      "month",
      "year",
      "time",
      "period",
      "quarter",
      "created",
      "updated",
      "transaction",
    ])
  )
}

function findColumnByHints(
  columns: string[],
  hints: string[],
  rows: DashboardDatasetRow[] = [],
  requireNumeric = false,
  requireNonNumeric = false
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

    return (
      (!requireNumeric || columnHasNumericValues(rows, column)) &&
      (!requireNonNumeric || !columnHasNumericValues(rows, column))
    )
  })
}

function getFirstNonNumericColumn(
  columns: string[],
  rows: DashboardDatasetRow[],
  excludedColumns: string[] = []
) {
  return columns.find(
    column =>
      !excludedColumns.includes(column) &&
      !columnHasNumericValues(rows, column)
  )
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

function getNumericAggregate(
  metric: DashboardDatasetMetric | undefined,
  rows: DashboardDatasetRow[],
  column: string,
  aggregationType: DashboardValueAggregation
) {
  if (rows.length) {
    return aggregateSummaryAwareValues(
      rows,
      column,
      aggregationType
    )
  }

  const datasetValue =
    aggregationType === "sum"
      ? metric?.total
      : aggregationType === "avg"
        ? metric?.average
        : aggregationType === "min"
          ? metric?.min ?? metric?.minimum
        : aggregationType === "max"
          ? metric?.max ?? metric?.maximum
          : metric?.count

  if (
    typeof datasetValue === "number" &&
    Number.isFinite(datasetValue)
  ) {
    return datasetValue
  }

  return 0
}

function getAggregationDetail(
  metric: DashboardDatasetMetric | undefined,
  rowCount: number,
  aggregationType: DashboardValueAggregation
) {
  const labels: Record<DashboardValueAggregation, string> = {
    sum: metric?.total !== undefined
      ? "Dataset total"
      : `Sum from ${formatInteger(rowCount)} rows`,
    avg: metric?.average !== undefined
      ? "Dataset average"
      : `Average from ${formatInteger(rowCount)} rows`,
    min: metric?.min !== undefined || metric?.minimum !== undefined
      ? "Dataset minimum"
      : `Minimum from ${formatInteger(rowCount)} rows`,
    max: metric?.max !== undefined || metric?.maximum !== undefined
      ? "Dataset maximum"
      : `Maximum from ${formatInteger(rowCount)} rows`,
    count: metric?.count !== undefined
      ? "Dataset record count"
      : `Count from ${formatInteger(rowCount)} rows`,
  }

  return labels[aggregationType]
}

function getSalesTrendStatus(
  trendData: IndustryChartPoint[]
) {
  if (trendData.length < 2) {
    return "No recent comparison"
  }

  const previous = trendData[trendData.length - 2]?.value ?? 0
  const latest = trendData[trendData.length - 1]?.value ?? 0

  if (previous === 0) {
    return latest > 0
      ? "New activity in latest period"
      : "No activity in latest period"
  }

  const change = (latest - previous) / Math.abs(previous)

  if (change >= 0.05) {
    return "Tracking above recent trend"
  }

  if (change <= -0.05) {
    return "Below recent trend"
  }

  return "Within recent range"
}

function formatSalesPercentage(value: number) {
  const percentage = Math.abs(value) <= 1
    ? value * 100
    : value

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(percentage)}%`
}

function buildSalesKpiMetrics({
  rows,
  metrics,
  primaryColumn,
  secondaryColumn,
  conversionColumn,
  dealCountColumn,
  aggregationType,
  trendData,
}: {
  rows: DashboardDatasetRow[]
  metrics: DashboardDatasetMetric[]
  primaryColumn?: string
  secondaryColumn?: string
  conversionColumn?: string
  dealCountColumn?: string
  aggregationType: DashboardValueAggregation
  trendData: IndustryChartPoint[]
}): IndustryMetric[] {
  const revenueMetric = metrics.find(
    metric => metric.column === primaryColumn
  )
  const pipelineMetric = metrics.find(
    metric => metric.column === secondaryColumn
  )
  const conversionMetric = metrics.find(
    metric => metric.column === conversionColumn
  )
  const dealCountMetric = metrics.find(
    metric => metric.column === dealCountColumn
  )
  const revenueValue = primaryColumn
    ? getNumericAggregate(
      revenueMetric,
      rows,
      primaryColumn,
      aggregationType
    )
    : 0
  const pipelineValue = secondaryColumn
    ? getNumericAggregate(
      pipelineMetric,
      rows,
      secondaryColumn,
      aggregationType
    )
    : null
  const conversionValue = conversionColumn
    ? getNumericAggregate(
      conversionMetric,
      rows,
      conversionColumn,
      aggregationType
    )
    : null
  const dealCountValue = dealCountColumn
    ? getNumericAggregate(
      dealCountMetric,
      rows,
      dealCountColumn,
      aggregationType
    )
    : rows.length

  return [
    {
      label: "Revenue",
      value: primaryColumn
        ? formatMappedMetricValue(revenueValue, primaryColumn)
        : "Needs mapping",
      detail: primaryColumn
        ? getSalesTrendStatus(trendData)
        : "Map a revenue or bookings value column",
    },
    {
      label: "Deals to Date",
      value: formatInteger(dealCountValue),
      detail: dealCountColumn
        ? `Based on ${formatDashboardLabel(dealCountColumn)}`
        : "Count of rows in the selected period",
    },
    {
      label: "Conversion Rate",
      value: conversionValue === null
        ? "Needs mapping"
        : formatSalesPercentage(conversionValue),
      detail: conversionColumn
        ? `Based on ${formatDashboardLabel(conversionColumn)}`
        : "Map a conversion or win-rate value column",
    },
    {
      label: "Pipeline Value",
      value: pipelineValue === null || !secondaryColumn
        ? "Needs mapping"
        : formatMappedMetricValue(pipelineValue, secondaryColumn),
      detail: secondaryColumn
        ? `Based on ${formatDashboardLabel(secondaryColumn)}`
        : "Map a pipeline or forecast value column",
    },
  ]
}

function buildSalesSignals({
  metrics,
  conversionColumn,
  secondaryColumn,
  operationsData,
}: {
  metrics: IndustryMetric[]
  conversionColumn?: string
  secondaryColumn?: string
  operationsData: IndustryChartPoint[]
}): IndustryDashboardConfig["signals"] {
  const revenueMetric = metrics.find(
    metric => metric.label === "Revenue"
  )
  const conversionMetric = metrics.find(
    metric => metric.label === "Conversion Rate"
  )
  const pipelineMetric = metrics.find(
    metric => metric.label === "Pipeline Value"
  )

  return [
    {
      label: "Revenue",
      value: revenueMetric?.detail ?? "Needs review",
      tone: revenueMetric?.detail === "Below recent trend"
        ? "amber"
        : "green",
    },
    {
      label: "Conversion rate",
      value: conversionColumn
        ? conversionMetric?.value ?? "Mapped"
        : "Needs mapping",
      tone: conversionColumn ? "blue" : "amber",
    },
    {
      label: "Pipeline",
      value: secondaryColumn
        ? pipelineMetric?.value ?? "Mapped"
        : "Needs mapping",
      tone: secondaryColumn ? "green" : "amber",
    },
    {
      label: "Sales stage",
      value: operationsData[0]
        ? `Largest: ${operationsData[0].name}`
        : "Needs mapping",
      tone: operationsData.length > 0 ? "purple" : "amber",
    },
  ]
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
  valueColumn: string,
  aggregationType: DashboardValueAggregation
) {
  const grouped =
    groupRowsByValue(
      rows,
      groupColumn,
      valueColumn,
      true,
      aggregationType
    )

  return grouped.slice(0, 6).map(item => ({
    ...item,
    valueColumn,
  }))
}

function buildMixData(
  rows: DashboardDatasetRow[],
  groupColumn: string,
  valueColumn: string,
  aggregationType: DashboardValueAggregation
) {
  const grouped =
    groupRowsByValue(
      rows,
      groupColumn,
      valueColumn,
      false,
      aggregationType
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
    rawValue: item.value,
    percentage: percentages[index] ?? item.value,
    valueColumn,
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
  includeNegative = false,
  aggregationType: DashboardValueAggregation = "sum"
) {
  const grouped = new Map<
    string,
    {
      name: string
      rows: DashboardDatasetRow[]
    }
  >()

  rows.forEach(row => {
    if (
      isHistoricalSummaryRow(row) &&
      (row[groupColumn] === null ||
        row[groupColumn] === undefined ||
        row[groupColumn] === "")
    ) {
      return
    }

    const groupName = getGroupKey(
      row[groupColumn],
      "Unspecified"
    )
    const groupKey = groupName.toLocaleLowerCase()
    const current =
      grouped.get(groupKey) ?? {
        name: groupName,
        rows: [],
      }

    current.rows.push(row)
    grouped.set(groupKey, current)
  })

  return Array.from(grouped.values())
    .map(item => ({
      name: item.name,
      value: aggregateSummaryAwareValues(
        item.rows,
        valueColumn,
        aggregationType
      ),
    }))
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
  secondaryColumn?: string,
  aggregation: DashboardAggregation = "monthly",
  aggregationType: DashboardValueAggregation = "sum"
) {
  const grouped = new Map<
    string,
    {
      rows: DashboardDatasetRow[]
    }
  >()

  rows.forEach((row, index) => {
    const date =
      row.__periodDate instanceof Date
        ? row.__periodDate
        : parseDashboardDate(
            row[dateColumn]
          )
    const name = date
      ? formatDashboardAggregationLabel(
          getDashboardAggregationBucketDate(
            date,
            aggregation
          ),
          aggregation
        )
      : getGroupKey(
          row[dateColumn],
          `P${index + 1}`
        )
    const current =
      grouped.get(name) ?? {
      rows: [],
    }

    current.rows.push(row)

    grouped.set(name, current)
  })

  return Array.from(grouped.entries())
    .sort(([firstName], [secondName]) =>
      compareDashboardPeriods(
        firstName,
        secondName
      )
    )
    .map(([name, values]) => ({
      name,
      value: Math.round(
        aggregateSummaryAwareValues(
          values.rows,
          primaryColumn,
          aggregationType
        )
      ),
      secondary: secondaryColumn
        ? Math.round(
          aggregateSummaryAwareValues(
            values.rows,
            secondaryColumn,
            aggregationType
          )
        )
        : undefined,
    }))
}

function parseDashboardDate(
  value: DashboardDatasetCell
) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? undefined
      : value
  }

  if (typeof value !== "string" || !value.trim()) {
    return undefined
  }

  const parsed = new Date(
    `${value.trim()}T00:00:00`
  )

  return Number.isNaN(parsed.getTime())
    ? undefined
    : new Date(
        parsed.getFullYear(),
        parsed.getMonth(),
        parsed.getDate()
      )
}

function getDashboardAggregationBucketDate(
  value: Date,
  aggregation: DashboardAggregation
) {
  const date = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate()
  )

  if (aggregation === "monthly") {
    date.setDate(1)
    return date
  }

  if (aggregation === "quarterly") {
    date.setDate(1)
    date.setMonth(
      Math.floor(date.getMonth() / 3) * 3
    )
    return date
  }

  if (aggregation === "weekly") {
    const daysFromMonday =
      (date.getDay() + 6) % 7
    date.setDate(
      date.getDate() - daysFromMonday
    )
  }

  return date
}

function formatDashboardAggregationLabel(
  value: Date,
  aggregation: DashboardAggregation
) {
  const dateKey = [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-")

  return aggregation === "weekly"
    ? `Week of ${dateKey}`
    : aggregation === "quarterly"
      ? `${value.getFullYear()} Q${Math.floor(value.getMonth() / 3) + 1}`
    : aggregation === "monthly"
      ? dateKey.slice(0, 7)
      : dateKey
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

function formatCategoryChartLabel(
  value: number,
  total: number,
  valueColumn?: string
) {
  const percentage =
    total > 0 ? (value / total) * 100 : 0
  const formattedValue = valueColumn
    ? formatMappedMetricValue(value, valueColumn)
    : formatInteger(value)
  const formattedPercentage = new Intl.NumberFormat(
    "en-US",
    { maximumFractionDigits: 1 }
  ).format(percentage)

  return `${formattedValue} (${formattedPercentage}%)`
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
  hotelHospitality: props => (
    <IndustryDashboard
      {...props}
      config={industryDashboardConfigs.hotelHospitality}
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
  constructionPerformance: props => (
    <IndustryDashboard
      {...props}
      config={industryDashboardConfigs.constructionPerformance}
    />
  ),
  lawFirmPerformance: props => (
    <IndustryDashboard
      {...props}
      config={industryDashboardConfigs.lawFirmPerformance}
    />
  ),
}
