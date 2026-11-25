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
        note: "Google API access required"
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
      { type: "lightspeed", name: "Lightspeed Retail (R-Series)" },
      { type: "lightspeed_x", name: "Lightspeed Retail (X-Series)" },
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
      "Use Business Analysis to compare metrics, check ad returns and profitability, or assess a change you made. Dashboards help you monitor performance, Forecasts shows what might come next, and Decisions keeps track of what you tried and what happened."
  },
  {
    question: "Which connectors are available?",
    answer:
      "See Connections for the providers you can add to your workspace. To connect, sign in with an account that has access to the data you want to import. Some providers, including Google Business Profile, also require API approval."
  },
  {
    question: "Can I upload files?",
    answer:
      "Yes. Upload CSV, Excel, JSON or Parquet files, then choose metrics and a date column. Filter by selected unique values in a dimension column, such as a channel or product category, where those fields are available. You do not need to connect an external service to get started."
  },
  {
    question: "Can I combine data from more than one dataset?",
    answer:
      "Yes. In Business Analysis, choose Compare metrics, then Multi-dataset report. Select metrics from two or more datasets, choose each source's date column and dimension filters, and align their time periods. Indexed trends use a shared baseline of 100. Turn on relationship analysis to check timing for individual metric pairs. Relationships show associations, not proof of causation. Creating a report does not automatically record a business action."
  },
  {
    question: "Can I compare products, locations or channels side by side?",
    answer:
      "Yes. In General Business Overview, open Edit dashboard and choose Compare Groups. Pick one metric, then check the values from one column you want to compare. For example, compare sales for two locations on the same chart. Use Select Metrics instead to track several measures for the same group."
  },
  {
    question: "Can I share a dashboard without giving workspace access?",
    answer:
      "Yes. Email a read-only link from Select Metrics or Compare Groups. Recipients see the chosen view without changing settings or signing in. You can stop one link without affecting the others. Anyone who receives a forwarded link can still view it until you stop it."
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
      "The report covers the last complete week, with up to three years of available history for comparison. It shows what changed in your chosen metrics and flags unusual results when those checks are on. Preview and save it in Weekly Reports. By default, the owner gets it by email when there is enough data. Use Scheduled email to add recipients or pause delivery."
  },
  {
    question: "What does the free trial include?",
    answer:
      "Start a 30-day Professional or Agency trial without a credit card. Professional supports one business workspace; Agency includes an agency workspace and up to 10 client workspaces. Choose your plan during workspace setup."
  },
  {
    question: "Can I set up a branded portal for my business?",
    answer:
      "Yes. Professional includes a branded decisionate.app portal for one business workspace. In Settings, switch between Workspace branding and Hosted portal settings. Agency adds separate client workspaces. If a trial ends without a paid plan, its hosted address is released; that does not delete the workspace."
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
    question: "Do workspaces expire after three years?",
    answer:
      "No. The rolling three-year limit applies to data, not the workspace. Uploaded files expire from the upload date, and saved reports and decisions expire from their record dates. Export anything you need before expiry.",
    link: { href: "/privacy", label: "Privacy Policy" }
  },
  {
    question: "Can I delete my workspace?",
    answer:
      "Workspace owners can start permanent deletion from Settings. Export what you need first, cancel any active paid subscription, and remove or unlink managed client workspaces. See the Privacy Policy for details and how to make a personal information request.",
    link: { href: "/privacy", label: "Privacy Policy" }
  },
  {
    question: "Is there a live demo?",
    answer:
      "Yes. Explore dashboards, compare sample ad returns, and see the decision those numbers could support. The demo is read-only and uses sample data; it does not change a workspace or place ads.",
    link: { href: "/demo", label: "Open the live demo" }
  },
  {
    question: "How can I get help?",
    answer:
      "Open Help & Support for step-by-step guides. Ask Decisionate answers product questions from approved guidance, not your account data. For account-specific help, contact support@decisionate.ca."
  }
] as const
