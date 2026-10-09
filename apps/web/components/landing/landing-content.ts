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
      "Decisionate brings business data, dashboards and decision tracking into one workspace. Explore performance, record the action you choose, and review the result with the evidence attached."
  },
  {
    question: "Which connectors are available?",
    answer:
      "The integrations above reflect the current connector catalog. Sage Cloud Accounting and Zoho Books are supported. Connecting a provider requires an authorized account and any required provider approvals. Google Business Profile is pending provider approval."
  },
  {
    question: "Can I upload files?",
    answer:
      "Yes. Upload CSV, Excel, JSON or Parquet files, then choose the date and numeric columns you want to analyze. You do not need to connect an external service to get started."
  },
  {
    question: "Can I combine data from more than one dataset?",
    answer:
      "Yes. Join datasets on normalized time periods and compare related metrics in the same workspace. Relationships show associations, not proof that one metric causes another."
  },
  {
    question: "How do AI recommendations and forecasts work?",
    answer:
      "Forecasts use your selected time series and aggregation settings. AI-assisted recommendations use analytical summaries and relevant decision history. Neither forecasts nor recommendations guarantee an outcome."
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
      "Connector data is kept for three years, then deleted. See the Privacy Policy for other retention and deletion commitments.",
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
