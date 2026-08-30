export const workflowSteps = [
  {
    number: "01",
    label: "Connect",
    description: "Bring in files, analytics, accounting, commerce, marketing, or database data.",
  },
  {
    number: "02",
    label: "Analyze",
    description: "Use business intelligence dashboards to see the measures, patterns and changes that matter.",
  },
  {
    number: "03",
    label: "Forecast",
    description: "Understand what current signals may mean next.",
  },
  {
    number: "04",
    label: "Recommend",
    description: "Turn evidence into a clear next action.",
  },
  {
    number: "05",
    label: "Decide",
    description: "Record the choice, owner, expected result and review date.",
  },
  {
    number: "06",
    label: "Learn",
    description: "Capture outcomes and lessons for better future decisions.",
  },
] as const

export const industryDashboards = [
  {
    name: "General Business",
    description: "A practical view of growth, efficiency and operating health.",
    accent: "#2563eb",
    values: [72, 54, 82, 64, 90],
  },
  {
    name: "Marketing",
    description: "Connect campaign performance to pipeline and revenue decisions.",
    accent: "#db2777",
    values: [48, 76, 60, 88, 68],
  },
  {
    name: "Sales",
    description: "Track funnel movement, conversion and the decisions behind results.",
    accent: "#0f766e",
    values: [38, 64, 78, 58, 84],
  },
  {
    name: "Retail",
    description: "Find the product, channel and period signals shaping demand.",
    accent: "#c2410c",
    values: [82, 62, 74, 48, 88],
  },
  {
    name: "Restaurant",
    description: "Make clearer decisions about covers, sales, labor and margins.",
    accent: "#7c3aed",
    values: [66, 86, 52, 72, 60],
  },
  {
    name: "Hotels & Hospitality",
    description: "Connect occupancy, room revenue, booking channels and guest experience.",
    accent: "#0f766e",
    values: [74, 58, 86, 68, 82],
  },
  {
    name: "Professional Services",
    description: "Connect utilization, delivery, clients and commercial performance.",
    accent: "#475569",
    values: [58, 74, 68, 86, 76],
  },
  {
    name: "Healthcare",
    description: "Bring service demand, capacity, quality and follow-up into view.",
    accent: "#0891b2",
    values: [76, 64, 84, 70, 92],
  },
  {
    name: "Construction",
    description: "Connect project progress, costs, resources and delivery decisions.",
    accent: "#ca8a04",
    values: [52, 78, 66, 88, 60],
  },
  {
    name: "Law Firm",
    description: "Understand matter workload, realization, clients and team capacity.",
    accent: "#334155",
    values: [62, 82, 56, 74, 86],
  },
] as const

export const featureCards = [
  {
    title: "Connect Your Data",
    description: "Start with the files and systems your business already uses.",
    icon: "database",
  },
  {
    title: "Business Intelligence Dashboards",
    description: "Track KPIs, compare periods and explore business performance in clear, practical dashboards.",
    icon: "chart",
  },
  {
    title: "Decision Automation",
    description: "Move from meaningful signals to evidence-backed recommendations and accountable choices.",
    icon: "chart",
  },
  {
    title: "Forecasting",
    description: "Use trends and projections to prepare before a result becomes a surprise.",
    icon: "forecast",
  },
  {
    title: "AI Recommendations",
    description: "Get an evidence-based next step with context you can review.",
    icon: "sparkles",
  },
  {
    title: "Decision Tracking",
    description: "Give every important choice an owner, outcome and review point.",
    icon: "target",
  },
  {
    title: "Outcome Measurement",
    description: "Turn what happened into organizational knowledge for the next decision.",
    icon: "layers",
  },
] as const

export const integrations = [
  { name: "CSV", status: "Available" },
  { name: "Excel", status: "Available" },
  { name: "JSON", status: "Available" },
  { name: "Parquet", status: "Available" },
  { name: "Google Analytics", status: "Available" },
  { name: "Google Drive", status: "Available" },
  { name: "OneDrive", status: "Available" },
  { name: "PostgreSQL", status: "Available" },
  { name: "MySQL", status: "Available" },
  { name: "SQL Server", status: "Available" },
  { name: "Stripe", status: "Available" },
  { name: "Shopify", status: "Available" },
  { name: "QuickBooks", status: "Available" },
  { name: "FreshBooks", status: "Available" },
  { name: "Sage Cloud Accounting", status: "Upcoming" },
  { name: "Xero", status: "Available" },
  { name: "Zoho Books", status: "Upcoming" },
  { name: "HubSpot", status: "Available" },
  { name: "Meta Ads", status: "Available" },
] as const

export const benefits = [
  {
    title: "Save time",
    description: "Move from raw data to a useful next step without rebuilding analysis every week.",
  },
  {
    title: "Reduce risk",
    description: "Make assumptions, ownership, expected outcomes and review dates visible.",
  },
  {
    title: "Improve decisions",
    description: "Give teams a shared evidence trail for the choices that matter most.",
  },
  {
    title: "Increase revenue",
    description: "Find the commercial signals that deserve action before the window closes.",
  },
  {
    title: "Track results",
    description: "Compare what you expected with what actually happened after the decision.",
  },
  {
    title: "Build knowledge",
    description: "Preserve lessons so the organization gets wiser, not just busier.",
  },
] as const

export const faqs = [
  {
    question: "What is Decisionate?",
    answer: "Decisionate is a decision automation platform for growing businesses and agencies. It connects business data to analysis, forecasts, recommendations, accountable decisions and outcome learning.",
  },
  {
    question: "How does decision automation work?",
    answer: "Decisionate follows a connected workflow: bring in business data, analyze the signals, review a recommendation, create an owned decision, record the outcome and capture the lesson for future recommendations. Decisions remain accountable to your team; the platform supports the decision rather than taking unapproved action.",
  },
  {
    question: "Can I upload files?",
    answer: "Yes. CSV, Excel, JSON and Parquet files can be uploaded. The dataset schema comes from the incoming file, and you can choose the date, dimension and metric columns used for analysis.",
  },
  {
    question: "Which connectors are available?",
    answer: "The current connector set includes Google Analytics, PostgreSQL, MySQL, SQL Server, Stripe, Shopify, QuickBooks, FreshBooks, Sage Cloud Accounting, Xero, Zoho Books, HubSpot and Meta Ads. Connector credentials and provider setup are managed before a workspace runs its first sync.",
  },
  {
    question: "What can I do with the dashboards?",
    answer: "Dashboards provide business intelligence views for performance analysis, including general business, decision, sales, marketing and industry-specific views. You can select datasets and metrics, set date periods, aggregate by day, week, month or quarter, use sum, count, average, minimum or maximum, and compare relevant metrics.",
  },
  {
    question: "Can I combine data from more than one dataset?",
    answer: "Yes. Datasets can be joined on normalized time periods, and related metrics can be analyzed together. The resulting data remains scoped to the active workspace and can support dashboard analysis and decisions.",
  },
  {
    question: "How do AI recommendations and forecasts work?",
    answer: "When AI is configured, Decisionate provides recommendations using bounded analytical summaries, selected metrics and relevant historical decision outcomes. Forecasts use the selected time series and aggregation settings. Recommendations and forecasts are evidence to review, not guarantees or proof of causation.",
  },
  {
    question: "What are alerts used for?",
    answer: "Workspace owners can configure alerts around selected datasets, metrics and optional KPI targets. Alerts can identify meaningful changes and deliver reports or recommendations by email on the configured schedule. Alert data and recipients are isolated by workspace.",
  },
  {
    question: "How does Decisionate learn from decisions?",
    answer: "Each decision can include an owner, action, expected outcome, review details, actual outcome, status and lesson learned. That history becomes bounded evidence that can inform later recommendations while remaining subject to human review.",
  },
  {
    question: "Can I export decisions?",
    answer: "The workspace owner can export the current decision results as CSV for analysis or JSON for complete structured records, including ownership, timestamps, outcomes, notes, lessons and activity history. Export activity is logged. Connector source data is not offered as a separate data export.",
  },
  {
    question: "How are workspaces and permissions organized?",
    answer: "Each workspace is isolated. Professional workspaces support an owner and members. Agency workspaces can manage client workspaces, with agency branding and separate client access. Owners control settings, members, connections and other management actions according to the workspace role model.",
  },
  {
    question: "Can an agency manage client workspaces?",
    answer: "Yes. Agency plans include an agency workspace and client workspaces. Agency owners can create and manage client access, while client users work within their own client workspace and see the access permitted by their role.",
  },
  {
    question: "Is there a live demo?",
    answer: "Yes. The live demo can be opened without signing in and uses prepared demonstration datasets. It is read-only: demo data cannot be uploaded or deleted, and creating decisions is disabled.",
    link: {
      href: "/demo",
      label: "Open the live demo",
    },
  },
  {
    question: "What does the free trial include?",
    answer: "The 30-day free trial provides full access without feature restrictions. Professional is $79 CAD/month or $790 CAD/year. Agency is $199 CAD/month or $1,990 CAD/year and includes up to 10 client workspaces. Additional client workspaces are $20 CAD/month or $200 CAD/year each.",
  },
  {
    question: "What are Decisionate AI credits?",
    answer: "Decisionate AI credits are an application usage allowance, not OpenAI credits or currency. The default allocations are 1,000 for Free, 5,000 for Professional and 25,000 for Agency. Allocations can be adjusted by the platform administrator as usage and provider costs change.",
  },
  {
    question: "Is my data secure?",
    answer: "Workspace access is isolated, management actions are role-protected, connector credentials are handled separately from workspace data, and shared dashboards use controlled links. Review the Security, Privacy and Terms pages for the current controls, processors, AI data handling, retention and deletion commitments.",
  },
  {
    question: "How can I get help?",
    answer: "Use Help & Support inside the application to contact support through the web form, report a bug, request a feature or review the product reference guide. Workspace, account, page and session context are attached automatically to support requests.",
  },
] as const
