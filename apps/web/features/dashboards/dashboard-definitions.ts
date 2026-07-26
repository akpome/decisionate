export type DashboardComponentKey =
  | "generalBusiness"
  | "marketingPerformance"
  | "salesPerformance"
  | "decisionPerformance"
  | "retailPerformance"
  | "restaurantPerformance"
  | "professionalServices"
  | "healthcarePractice"
  | "realEstate"
  | "nonprofitPerformance"

export type DashboardPreviewTone =
  | "blue"
  | "green"
  | "purple"
  | "orange"
  | "teal"
  | "amber"

export type DashboardDataBasis =
  | "dataset"
  | "decision-records"

export type DashboardDefinition = {
  key: string
  name: string
  category: string
  description: string
  highlights: string[]
  dataBasis: DashboardDataBasis
  previewTone: DashboardPreviewTone
  previewLayout: "overview" | "funnel" | "decision"
  componentKey: DashboardComponentKey
}

export const defaultDashboardKey = "general-business"

export const dashboardDefinitions: DashboardDefinition[] = [
  {
    key: defaultDashboardKey,
    name: "General Business Overview",
    category: "Executive",
    description:
      "Business KPIs, forecasts, alerts and recommendations.",
    highlights: [
      "Business KPIs",
      "Forecasts",
      "Recommendations",
    ],
    dataBasis: "dataset",
    previewTone: "blue",
    previewLayout: "overview",
    componentKey: "generalBusiness",
  },
  {
    key: "marketing-performance",
    name: "Marketing Performance",
    category: "Growth",
    description:
      "Campaign performance, ROI and lead funnel visibility.",
    highlights: [
      "Campaigns",
      "ROI",
      "Lead Funnel",
    ],
    dataBasis: "dataset",
    previewTone: "green",
    previewLayout: "funnel",
    componentKey: "marketingPerformance",
  },
  {
    key: "sales-performance",
    name: "Sales Performance",
    category: "Revenue",
    description:
      "Pipeline health, bookings, conversion and forecast risk.",
    highlights: [
      "Pipeline",
      "Bookings",
      "Forecast",
    ],
    dataBasis: "dataset",
    previewTone: "orange",
    previewLayout: "funnel",
    componentKey: "salesPerformance",
  },
  {
    key: "decision-performance",
    name: "Decision Performance",
    category: "Operations",
    description:
      "Decision success, reviews and lessons learned.",
    highlights: [
      "Decision Success",
      "Reviews",
      "Lessons Learned",
    ],
    dataBasis: "decision-records",
    previewTone: "purple",
    previewLayout: "decision",
    componentKey: "decisionPerformance",
  },
  {
    key: "retail-performance",
    name: "Retail Performance",
    category: "Industry",
    description:
      "Sales, inventory movement, margins and store performance.",
    highlights: [
      "Sales Mix",
      "Inventory",
      "Margins",
    ],
    dataBasis: "dataset",
    previewTone: "teal",
    previewLayout: "overview",
    componentKey: "retailPerformance",
  },
  {
    key: "restaurant-performance",
    name: "Restaurant Performance",
    category: "Industry",
    description:
      "Table turns, menu performance, labor and food cost signals.",
    highlights: [
      "Menu Mix",
      "Labor",
      "Food Cost",
    ],
    dataBasis: "dataset",
    previewTone: "orange",
    previewLayout: "funnel",
    componentKey: "restaurantPerformance",
  },
  {
    key: "professional-services",
    name: "Professional Services",
    category: "Industry",
    description:
      "Utilization, pipeline, delivery health and client profitability.",
    highlights: [
      "Utilization",
      "Pipeline",
      "Client Margin",
    ],
    dataBasis: "dataset",
    previewTone: "purple",
    previewLayout: "decision",
    componentKey: "professionalServices",
  },
  {
    key: "healthcare-practice",
    name: "Healthcare Practice",
    category: "Industry",
    description:
      "Appointments, capacity, revenue cycle and patient growth.",
    highlights: [
      "Appointments",
      "Capacity",
      "Revenue Cycle",
    ],
    dataBasis: "dataset",
    previewTone: "teal",
    previewLayout: "overview",
    componentKey: "healthcarePractice",
  },
  {
    key: "real-estate",
    name: "Real Estate",
    category: "Industry",
    description:
      "Pipeline, closings, lead sources and agent productivity.",
    highlights: [
      "Pipeline",
      "Closings",
      "Lead Sources",
    ],
    dataBasis: "dataset",
    previewTone: "amber",
    previewLayout: "funnel",
    componentKey: "realEstate",
  },
  {
    key: "nonprofit-performance",
    name: "Nonprofit Performance",
    category: "Industry",
    description:
      "Donations, programs, grants and operating sustainability.",
    highlights: [
      "Donations",
      "Programs",
      "Grants",
    ],
    dataBasis: "dataset",
    previewTone: "green",
    previewLayout: "overview",
    componentKey: "nonprofitPerformance",
  },
]

export const dashboardCategoryOrder = [
  "Executive",
  "Revenue",
  "Growth",
  "Operations",
  "Industry",
]

const groupedSingleDashboardCategories = [
  "Executive",
  "Revenue",
  "Growth",
  "Operations",
]

const dashboardCategories = [
  ...dashboardCategoryOrder,
  ...dashboardDefinitions
    .map(dashboard => dashboard.category)
    .filter(
      (category, index, categories) =>
        !dashboardCategoryOrder.includes(category) &&
        categories.indexOf(category) === index
    ),
]

const dashboardGroupsByCategory =
  dashboardCategories
    .map(category => ({
      category,
      dashboards:
        dashboardDefinitions.filter(
          dashboard =>
            dashboard.category === category
        ),
    }))
    .filter(group => group.dashboards.length > 0)

const coreDashboardGroup = {
  category: "Core Dashboards",
  dashboards:
    dashboardGroupsByCategory
      .filter(
        group =>
          groupedSingleDashboardCategories.includes(
            group.category
          ) && group.dashboards.length === 1
      )
      .flatMap(group => group.dashboards),
}

export const dashboardGroups = [
  ...(coreDashboardGroup.dashboards.length > 0
    ? [coreDashboardGroup]
    : []),
  ...dashboardGroupsByCategory.filter(
    group =>
      !(
        groupedSingleDashboardCategories.includes(
          group.category
        ) && group.dashboards.length === 1
      )
  ),
]

export const dashboardKeys =
  dashboardDefinitions.map(
    dashboard => dashboard.key
  )

const dashboardKeySet =
  new Set(dashboardKeys)

export function isDashboardKey(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    dashboardKeySet.has(value)
  )
}

export function getDashboardDefinition(
  key: string | null | undefined
) {
  return (
    dashboardDefinitions.find(
      dashboard => dashboard.key === key
    ) ?? dashboardDefinitions[0]
  )
}

export function dashboardUsesDatasetMetricMapping(
  componentKey: DashboardComponentKey
) {
  return ![
    "generalBusiness",
    "decisionPerformance",
  ].includes(componentKey)
}
