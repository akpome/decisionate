export const integrationGroups = [
  {
    name: "Analytics & advertising",
    items: [
      { type: "google_analytics", name: "Google Analytics" },
      { type: "google_ads", name: "Google Ads" },
      { type: "google_search_console", name: "Google Search Console" },
      {
        type: "google_business_profile",
        name: "Google Business Profile",
        note: "Pending provider approval"
      },
      { type: "meta_ads", name: "Meta Ads" }
    ]
  },
  {
    name: "Accounting",
    items: [
      { type: "quickbooks", name: "QuickBooks" },
      { type: "freshbooks", name: "FreshBooks" },
      { type: "sage", name: "Sage Cloud Accounting" },
      { type: "xero", name: "Xero" },
      { type: "zoho_books", name: "Zoho Books" }
    ]
  },
  {
    name: "Commerce & payments",
    items: [
      { type: "stripe", name: "Stripe" },
      { type: "shopify", name: "Shopify" },
      { type: "square", name: "Square" },
      { type: "woocommerce", name: "WooCommerce" }
    ]
  },
  {
    name: "CRM",
    items: [
      { type: "hubspot", name: "HubSpot" },
      { type: "salesforce", name: "Salesforce Sales Cloud" }
    ]
  },
  {
    name: "Databases",
    items: [
      { type: "postgresql", name: "PostgreSQL" },
      { type: "mysql", name: "MySQL" },
      { type: "sql_server", name: "SQL Server" }
    ]
  },
  {
    name: "Files",
    items: [
      { type: "csv", name: "CSV" },
      { type: "excel", name: "Excel" },
      { type: "json", name: "JSON" },
      { type: "parquet", name: "Parquet" }
    ]
  }
] as const

export const faqs = [
  {
    question: "What is Decisionate?",
    answer:
      "Decisionate analyzes business performance across datasets. Reports brings selected metrics, relationships and unusual changes together; dashboards inspect individual datasets, Forecasts projects selected time series, and Decisions tracks the actions you choose and their outcomes."
  },
  {
    question: "Which connectors are available?",
    answer:
      "The integrations above reflect the current connector catalog. Sage Cloud Accounting and Zoho Books are supported. Connecting a provider requires an authorized account and any required provider approvals. Google Business Profile is pending provider approval."
  },
  {
    question: "Can I upload files?",
    answer:
      "Yes. Upload CSV, Excel, JSON or Parquet files, then choose metrics and a date column. Filter by selected unique values in a dimension column, such as a channel or product category, where those fields are available. You do not need to connect an external service to get started."
  },
  {
    question: "Can I combine data from more than one dataset?",
    answer:
      "Yes. In Reports, select metrics from two or more datasets, choose each source's date column and dimension filters, and align their time periods. Compare indexed trends on a shared baseline of 100 and set timing directions for individual metric pairs. Relationships show associations, not proof of causation. Creating a report does not automatically record a business action."
  },
  {
    question: "How do AI recommendations and forecasts work?",
    answer:
      "Forecasts use your selected metric, date column, dimension filters and aggregation settings. Reports can include AI-assisted interpretation of analytical summaries and relevant decision history. Neither forecasts nor recommendations guarantee an outcome."
  },
  {
    question: "Do reports and forecasts account for seasonality?",
    answer:
      "Select the seasonal-business setting when recurring seasonal patterns matter. Reports check unusual changes for each selected metric, and seasonal analysis is used only when enough suitable history supports validation. Forecasts also support seasonal analysis. Missing history, holidays and promotions can limit results; a seasonal setting does not guarantee an accurate result."
  },
  {
    question: "What is included in a weekly report?",
    answer:
      "Choose a saved cross-dataset report as the weekly template, then configure recipients and enable delivery in Alerts. Weekly analysis uses the latest complete week and up to three years of available history, retaining the template's metrics, date fields, dimension filters and seasonal setting. It includes metric changes, relationship findings and unusual-change checks. Manual report dates do not restrict the weekly history window."
  },
  {
    question: "What does the free trial include?",
    answer:
      "Start a 30-day Professional or Agency trial without a credit card. Professional supports one business workspace; Agency includes an agency workspace and up to 10 client workspaces. Choose your plan during workspace setup."
  },
  {
    question: "Can an agency manage client workspaces?",
    answer:
      "Yes. Agency owners manage separate client workspaces, branding and access. Client users see the data and actions allowed by their role within their own workspace."
  },
  {
    question: "How long is connector data kept?",
    answer:
      "Where supported, imports start with 90 days and load older available history in background chunks, up to three years. Provider permissions and history limits can reduce coverage. Connector data is kept for three years, then deleted on a rolling basis. Deleting a saved report does not delete its source datasets or linked decisions; see the Privacy Policy for details.",
    link: { href: "/privacy", label: "Privacy Policy" }
  },
  {
    question: "Is there a live demo?",
    answer:
      "Yes. Explore the dashboards without signing in using prepared sample datasets. The public demo is read-only; it does not allow uploads, deletions or creating decisions.",
    link: { href: "/demo", label: "Open the live demo" }
  },
  {
    question: "How can I get help?",
    answer:
      "Contact support@decisionate.ca or use Help & Support in the application. You can report an issue, request a feature or review the product guide."
  }
] as const
