
# Decisionate User Manual

**Product:** Decisionate  
**Purpose:** Decision intelligence for growing businesses and agencies  
**Audience:** Business owners, analysts, managers, client users, and internal platform administrators

## 1. What Decisionate Does

Decisionate connects business data to a repeatable decision workflow:

1. Load or connect a dataset.
2. Select the metrics that matter.
3. Explore dashboards, insights, forecasts, and reports.
4. Turn a recommendation into a decision.
5. Record the expected outcome.
6. Record the actual outcome and status later.
7. Capture the lesson learned.
8. Use that historical evidence to improve future recommendations.

Decisionate is designed to help teams make, track, and learn from decisions. It is not intended to replace a general-purpose business-intelligence warehouse or reporting suite.

## 2. Getting Started

### 2.1 Sign in

Use the Decisionate sign-in or sign-up page. The application uses Clerk for browser authentication.

After signing in:

- Complete onboarding if prompted.
- Create or select a workspace.
- Confirm that the active workspace is the one whose data you want to analyze.
- Open **Datasets** and load your first dataset.

### 2.2 Understand the workspace

A workspace is the boundary for:

- Datasets
- Dashboard preferences
- Metric mappings
- Insights
- Forecasts
- Reports
- Decisions
- Alerts
- Members and invitations
- Connections
- Shared dashboard links

Changing the active workspace changes the data and configuration shown throughout the application.

### 2.3 Navigation

The dashboard sidebar is organized by purpose.

**Workspace**

- **Dashboard**: Main metric dashboard.
- **Dashboards**: Selectable general, industry, and decision dashboards.
- **Decisions**: Decision portfolio and decision activity.
- **Action Needed**: Work that needs review or follow-up.

**Analysis**

- **Insights**: AI-assisted analysis of a selected dataset and metric.
- **Forecasts**: Metric projections and model-quality information.
- **Reports**: Structured analysis and reporting.

**Data**

- **Datasets**: Upload, browse, and inspect datasets.
- **Connections**: Configure data-source connections and connector sync. This is owner-only.

**Manage**

- **Alerts**: Configure and operate weekly AI-assisted KPI email reports. Owner-only.
- **Settings**: Manage organization details, members, invitations, and workspace access. Owner-only.
- **Billing**: Manage the workspace subscription through Stripe. Owner-only.

**Internal**

- **Platform Admin**: Internal Decisionate administration. This link appears only for allowlisted platform administrators.

Analysis, Data, and Manage are collapsible navigation groups. Opening one group folds the other collapsible groups.

## 3. Roles and Permissions

Decisionate has workspace roles and a separate platform-admin role.

### 3.1 Workspace roles

| Role | Typical access |
|---|---|
| Owner | Full workspace access, configuration, members, alerts, connections, billing, datasets, analysis, and decisions |
| Member | Analyze data, work with datasets where permitted, create and manage decision workflows; cannot change owner-only workspace configuration |
| Client | Review and analyze the workspace according to the access granted by the owner; configuration and administrative actions are restricted |

Owner-only areas include:

- Organization settings
- Member and invitation management
- Connections and connector credentials
- Alert configuration and email sending
- Billing
- Workspace configuration

The API is the authoritative permission boundary. A link or visible control in the browser does not grant access by itself.

### 3.2 Platform administrators

Platform administrators are internal Decisionate operators. They are not customer workspace owners.

Platform-admin access is controlled by:

- DECISIONATE_PLATFORM_ADMIN_USER_IDS on the API
- NEXT_PUBLIC_PLATFORM_ADMIN_USER_IDS on the web app

Use Clerk user IDs, not email addresses. The API allowlist is authoritative.

## 4. Loading Data

### 4.1 Upload a dataset

1. Open **Data > Datasets**.
2. Choose the upload option.
3. Select a supported file.
4. Give the dataset a useful name when prompted.
5. Wait for processing to finish.
6. Open the dataset details page.

CSV and JSON are supported with the base API dependencies. Parquet and Excel use the same loader but require the appropriate optional reader packages on the API server.

A useful dataset should contain:

- A date or time column for trends.
- One or more numeric metric columns.
- Optional categorical columns such as product, channel, campaign, region, or category.
- Consistent values and units.

### 4.2 Inspect a dataset

Open a dataset from the saved dataset list to view:

- Dataset metadata
- Source information
- Available metrics
- Metric cards
- A metric trend chart
- AI-assisted dataset analysis
- Dataset preview rows
- Dataset-derived insights
- The selected metric

Use the **Metric** selector to focus the page on one metric or return to all metrics. The selection is saved as a workspace preference where supported.

### 4.3 Select metrics

Metric selectors determine which numeric columns are used by a page or chart.

When selecting a metric:

- Choose a numeric measure that represents the question being analyzed.
- Use revenue, orders, conversions, spend, or similar measures for performance analysis.
- Avoid selecting an identifier, free-text field, or category name as a numeric metric.
- Confirm that the selected column has the expected unit and time grain.

If a saved metric no longer exists in the dataset, Decisionate clears the stale selection and lets you choose a valid column.

### 4.4 Select an aggregation

Where the page supports time aggregation, choose:

- **Daily**
- **Weekly**
- **Monthly**
- **Quarterly**

Aggregation controls how rows are grouped along the time axis. A quarterly view groups values into calendar quarters. Changing the aggregation should update the chart and associated summaries.

On dataset-backed dashboards, the selected start date and duration define one shared analysis period. All charts, KPI cards, target snapshots, narratives, and Save PDF output use that same period.

### 4.5 Dataset date range

Where date controls are available, choose the start date and period to analyze, or use the full available dataset. The selected range should be kept consistent when comparing the product dashboard with a shared dashboard.

## 5. Main Dashboard

Open **Workspace > Dashboard**.

The main dashboard is the broadest workspace view. It is intended for a fast read of the most important selected metrics.

Typical controls include:

- Dataset selection
- Metric selection
- Date or period selection
- Daily, weekly, monthly, or quarterly aggregation
- Chart type or display controls where supported
- Targets or comparison settings where supported
- Save PDF
- Share

### 5.1 Select a dataset

Use the dataset selector in the dashboard controls. The selected dataset supplies the available metric columns and chart values.

If no dataset is available:

1. Confirm that the correct workspace is selected.
2. Open **Datasets** and verify that a dataset exists.
3. Return to the dashboard and select it explicitly.
4. Refresh only after confirming that the API is running and reachable.

### 5.2 Select one or more metrics

Use the metric selector to choose the values shown in the main chart. Multiple metrics can be selected for comparison, but use a small number when readability matters.

### 5.3 Read the chart

The dashboard chart is generated from the selected dataset rows and metrics. It is not a hard-coded sample chart.

The chart may show:

- A trend over time
- Multiple selected metric series
- Aggregated values
- Target or progress information
- A concise chart description for accessibility and context

### 5.4 Save a PDF

Use **Save PDF** to create a branded static version of the dashboard. The PDF output is designed to omit the application sidebar and present the dashboard as a report page.

For the best result:

- Select the dataset, metrics, range, and aggregation first.
- Wait for charts to finish rendering.
- Keep chart titles and labels concise.
- Confirm that the selected view is the one you want to distribute.

## 6. Selectable Dashboards

Open **Workspace > Dashboards**.

This page is the dashboard chooser. Selecting a dashboard opens that dashboard automatically.

Dashboard families include:

- General Business Overview
- Decision Performance
- Sales Performance
- Marketing Performance
- Industry-specific dashboards such as restaurant or other customer-industry views

General Business Overview and Decision Performance provide common decision-intelligence views. Industry dashboards use domain-specific chart layouts and data concepts.

### 6.1 Dashboard controls

Depending on the dashboard, controls may include:

- Dataset selector
- Metric selectors
- Date range
- Aggregation
- Metric mapping
- Chart title editing
- Save PDF
- Share
- Stop sharing

The dataset and metric selectors are aligned with the dashboard controls. Use the dataset selector first; the available metric columns then populate the relevant selectors.

### 6.2 Metric mapping

Metric mapping tells an industry dashboard which dataset columns supply named chart inputs.

For example:

- A revenue chart may map to a revenue column.
- A campaign funnel may map to leads, opportunities, or conversions.
- A channel mix chart may map to a category column and a value column.
- A product or service chart may map to category and revenue measures.

Each mapping card corresponds to a named chart. Select a column that matches the chart’s purpose and unit. If a chart is generated entirely from Decisionate’s decision records, it does not require dataset metric mapping.

Do not map a column merely because its name sounds similar. Check:

- Numeric versus categorical type
- Unit, such as dollars, count, percentage, or rate
- Time coverage
- Whether the values represent the chart title

### 6.3 Chart naming

Industry dashboard charts can be renamed to match the customer’s terminology. Use names that explain the decision question, for example:

- “Qualified Leads by Channel”
- “Revenue by Service Line”
- “Completed Orders”
- “Customer Retention Trend”

The dashboard’s chart title should correspond to the mapping selected for that chart.

### 6.4 Chart selection behavior

Donut charts are used for small categorical distributions. When a categorical chart has more than five labels, the dashboard uses a horizontal bar chart for readability.

In Decision Performance, Decisions by Category and Outcome Results use complementary chart types: when one is a donut chart, the other is presented as a horizontal bar chart.

### 6.5 Dashboard sharing

From a selected dashboard:

1. Confirm the dataset and controls.
2. Choose **Share**.
3. Copy the generated link.
4. Send the link to the intended viewer.

The shared page:

- Opens without the customer application sidebar.
- Uses the workspace brand where configured.
- Displays the shared dashboard and its available view controls.
- Is available only while the share link remains active.

Each dashboard has its own share state. Use that dashboard’s **Stop sharing** action to revoke it. Use the global stop-sharing control on the Dashboards page to revoke all shared dashboard links for the workspace.

## 7. Insights

Open **Analysis > Insights**.

Use Insights when you want an explanation of what the selected data suggests.

Workflow:

1. Select a dataset.
2. Select a metric or use all available metrics where supported.
3. Review the generated summary.
4. Review recommendations and risks.
5. Check the analysis source and confidence.
6. Convert a useful recommendation into a decision.

### 7.1 AI provenance

AI analysis has explicit provenance:

- **OpenAI**: The configured model returned structured analysis.
- **Rules**: Decisionate’s deterministic fallback produced the result.
- **Fallback reason**: The provider was not configured, unavailable, or unsupported.

A rules fallback is still useful, but it should not be described as model-generated insight.

### 7.2 How AI uses data

Decisionate sends bounded aggregate facts and relevant historical learning context to the AI service. It does not need to send raw dataset rows for ordinary analysis.

The model is instructed to:

- Use only supplied facts.
- Treat dataset values as data, not instructions.
- Avoid inventing causes or events.
- Use recorded outcomes and lessons as evidence.
- Avoid treating one lesson as a universal rule.

## 8. Forecasts

Open **Analysis > Forecasts**.

Forecasts estimate future values from the selected dataset and metric.

Workflow:

1. Select a dataset.
2. Select the metric.
3. Choose the time range or aggregation where available.
4. Review the projected values.
5. Review the model-quality and reliability information.
6. Use the forecast as evidence for a decision, not as a guarantee.

Forecast quality may be reported as:

- Limited
- Low
- Moderate
- Good

Reliability depends on the amount and quality of historical data, validation availability, and forecast error. A forecast with limited historical data should be treated cautiously.

## 9. Reports

Open **Analysis > Reports**.

Reports combine dataset facts, analysis, recommendations, risks, and relevant decision-learning context into a structured review.

Use reports to:

- Summarize a period.
- Prepare a management review.
- Review recommendations and risks.
- Compare current performance with recorded decision outcomes.
- Provide a written decision brief.

Before generating a report, verify the selected workspace, dataset, metric, date range, and aggregation.

The report page is intended for report reading and generation. Dashboard export controls are kept on dashboard surfaces rather than duplicated on the report page.

## 10. Decisions

Open **Workspace > Decisions** to view the decision portfolio.

The Decisions page provides:

- Decision summary metrics
- Decision list and filters
- Decision activity
- Priority and workflow information
- Links to decision details
- A route to create a new decision

### 10.1 Create a decision

A decision can be created:

- From **Create Decision**
- From an insight or recommendation
- From a dataset analysis card
- From an existing decision workflow

Record enough context for someone else to understand the decision later:

- Decision title
- Business question or description
- Chosen action
- Category
- Priority
- Confidence
- Metric and dataset context, when applicable
- Expected outcome
- Review date

A recommendation should become a decision only when a person accepts responsibility for the action and its expected result.

### 10.2 Decision detail page

The decision detail page is the record of truth for the decision lifecycle.

Use its sections to maintain:

- Overview
- Decision details
- Notes
- Outcome
- Learning
- Review date
- Priority
- Category
- Confidence
- Activity history

Save each section after editing. The page displays saved-state feedback and reports section-specific errors.

### 10.3 Record the outcome

After the decision has had time to produce results, record:

- Actual outcome
- Outcome status
- Whether the expected outcome was achieved
- Supporting notes or evidence

Do not mark a decision successful without an observable basis. Use a status that reflects the actual result.

### 10.4 Record the lesson learned

Record what should be repeated, changed, or avoided next time. A useful lesson includes:

- What happened
- Which assumption was correct or incorrect
- What evidence supports the lesson
- What future decision should do differently

### 10.5 Learning loop

Decisionate includes historical decision-learning context in future AI analysis when available.

The loop is:

1. A recommendation is generated.
2. A user converts it into a decision.
3. The user records the expected outcome.
4. The actual outcome and status are recorded later.
5. A lesson is recorded.
6. Future analysis receives bounded historical evidence and can use it to refine recommendations.

Historical evidence informs recommendations; it does not automatically prove that a future action will succeed.

## 11. Action Needed

Open **Workspace > Action Needed**.

Use this page as the operational follow-up view for decisions and analysis that require attention. Review overdue or pending decision work, outcome updates, and follow-up actions.

A practical routine is:

- Review Action Needed at the start of a planning cycle.
- Open each decision that is due for review.
- Update the actual outcome.
- Add the lesson learned.
- Create a follow-up decision when the evidence warrants it.

## 12. Alerts and Weekly AI Reports

Open **Manage > Alerts**. This area is owner-only.

Alerts can produce weekly KPI email digests containing:

- Dataset-derived KPI information
- AI-assisted summary
- Recommendations
- Risks
- Historical decision-learning context
- Delivery status and history

### 12.1 Configure alerts

An owner should:

1. Open **Alerts**.
2. Select the workspace and relevant dataset settings.
3. Configure recipients and the reporting schedule.
4. Preview the digest.
5. Send a test email.
6. Enable the recurring schedule after the test succeeds.

### 12.2 Verify delivery

Use:

- Digest preview
- Send-test action
- Delivery history
- Failed delivery details

For reliable scheduled delivery, the API must have SMTP settings and an external scheduler must call the due-report runner.

Alerts use the same AI provenance model as Insights. If OpenAI is unavailable, the digest remains explicitly labeled as rules-based fallback output.

## 13. Data Connections

Open **Data > Connections**. This area is owner-only.

Connections can represent:

- Google Drive
- OneDrive
- Shopify
- QuickBooks
- FreshBooks
- Xero
- Google Analytics

### 13.1 OAuth connections

For a provider with OAuth support:

1. Open Connections.
2. Select **Connect with OAuth**.
3. Complete the provider authorization flow.
4. Return to Decisionate.
5. Confirm that the connection is listed.

OAuth credentials are stored server-side in encrypted form. Raw access and refresh tokens are not returned to the web application.

### 13.2 Google Analytics sync

Google Analytics is the first connector with a dataset adapter and automated sync path.

Requirements:

- Google Analytics Data API package
- Google authentication package
- Server-side service-account credentials
- Viewer access for the service account to the GA4 property
- A connection containing the GA4 property ID

Owners can run a manual sync and enable an hourly or daily schedule.

### 13.3 Connector limitations

OAuth authorization does not automatically mean that automated dataset sync is available. Providers without a completed adapter are explicitly marked unsupported for automated sync until their provider-specific data extraction and mapping are implemented.

## 14. Settings and Workspace Administration

Open **Manage > Settings**. This area is owner-only.

Use Settings to:

- View and update organization details
- Review members
- Add or update members
- Send invitations
- Assign member or client roles
- Remove members where permitted
- Review workspace access

The organization owner cannot be demoted through the ordinary member role controls.

## 15. Billing

Open **Manage > Billing**. This area is owner-only.

Billing uses Stripe Checkout and the Stripe customer portal.

Typical workflow:

1. Open Billing.
2. Review the current subscription status.
3. Start Checkout when a plan is available.
4. Use the customer portal for subscription management.
5. Wait for signed Stripe webhook events to update subscription state.

Billing requires server-side Stripe configuration:

- STRIPE_SECRET_KEY
- STRIPE_PRICE_ID
- STRIPE_WEBHOOK_SECRET
- DECISIONATE_WEB_APP_URL

Billing status is updated from signed webhook events, not from an untrusted browser response.

## 16. Platform Admin Portal

Open /platform-admin. This is an internal admin surface, not a customer feature.

The portal provides operational visibility into:

- Organizations
- Users
- Members
- Datasets
- Decisions
- Recommendations
- Evaluated outcomes
- Recorded lessons
- Alert deliveries
- Failed alert deliveries
- AI readiness
- Analytics readiness
- Alert-service readiness
- Platform-admin audit events

### 16.1 Grant access

Add the Clerk user ID to:

~~~env
DECISIONATE_PLATFORM_ADMIN_USER_IDS=user_abc
~~~

For the navigation link, also set:

~~~env
NEXT_PUBLIC_PLATFORM_ADMIN_USER_IDS=user_abc
~~~

Restart the API and web app after changing environment variables. The API uses the server-side allowlist as the final authority.

### 16.2 AI provider configuration

The AI provider is configured on the API server, not from the platform-admin page:

~~~env
AI_PROVIDER=your-provider
AI_API_KEY=your-provider-key
AI_MODEL=your-model
AI_API_URL=https://your-provider.example/v1/chat/completions
~~~

The platform-admin page displays AI configuration status and model information, but it does not manage or reveal the secret key.

Never place the AI key in the web app environment or expose it to browser code.

## 17. Sharing and Branding

Shared dashboards are public-view pages backed by a workspace share token.

A shared dashboard:

- Excludes the customer sidebar and account controls.
- Uses the configured workspace brand where available.
- Preserves the selected dashboard configuration.
- Provides its own chart and aggregation presentation.
- Can be revoked by the dashboard owner.

If a share link has been stopped, the recipient must receive a newly generated link. Stopping all sharing revokes every active shared dashboard link for the workspace.

## 18. Configuration Reference

### 18.1 API environment

The main API configuration is in apps/api/.env.

Important values:

~~~env
DATABASE_URL=sqlite:///./decisionate.db
DATASET_UPLOAD_DIR=uploads
CORS_ALLOWED_ORIGINS=http://localhost:3000

AI_PROVIDER=
AI_API_KEY=
AI_MODEL=
AI_API_URL=

SMTP_HOST=
SMTP_PORT=587
SMTP_FROM_EMAIL=
SMTP_USERNAME=
SMTP_PASSWORD=

ALERTS_SCHEDULER_SECRET=

STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
DECISIONATE_WEB_APP_URL=http://localhost:3000

DECISIONATE_PLATFORM_ADMIN_USER_IDS=
~~~

### 18.2 Web environment

The web app uses apps/web/.env.local for browser-visible configuration:

~~~env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_ENABLE_API_BEARER_AUTH=false
NEXT_PUBLIC_PLATFORM_ADMIN_USER_IDS=
~~~

Only values intended for browser use belong in NEXT_PUBLIC_* variables. Do not put private API keys there.

### 18.3 Start the local application

Start the API:

~~~bash
cd /home/akpome/decisionate/apps/api
.venv/bin/python -m uvicorn app.main:app --reload --port 8000 --env-file .env
~~~

Start the web app using the repository’s normal development command from apps/web.

The web app defaults to http://localhost:8000 for the API. Change NEXT_PUBLIC_API_URL if the API runs elsewhere.

## 19. Troubleshooting

### “API service is unavailable”

Check:

- The API process is running.
- The API URL in apps/web/.env.local is correct.
- The API port is reachable from the browser.
- CORS includes the web origin.
- The API was restarted after environment changes.

### “No datasets available”

Check:

- The correct workspace is active.
- A dataset was uploaded to that workspace.
- The Datasets page can load successfully.
- The selected dataset was not deleted.
- The API request is reaching /datasets/.

### “Platform admin access required”

Check:

- You used the Clerk user ID, not the email.
- The ID is in DECISIONATE_PLATFORM_ADMIN_USER_IDS.
- The API was restarted with --env-file .env.
- The web app was restarted after changing NEXT_PUBLIC_PLATFORM_ADMIN_USER_IDS.
- The browser is signed in as the allowlisted Clerk user.

### “Rules fallback active”

This means the configured AI provider is not being used. Check:

~~~env
AI_PROVIDER=your-provider
AI_API_KEY=your-provider-key
AI_MODEL=your-model
AI_API_URL=https://your-provider.example/v1/chat/completions
~~~

Then restart the API. The fallback is intentional and clearly labeled; it is not proof that the AI provider is configured.

### Billing timeout or unavailable billing service

Check:

- The API is running and reachable.
- The signed-in user is the workspace owner.
- Stripe server variables are configured.
- The Stripe webhook endpoint is reachable in the deployed environment.
- The API logs for the specific billing request.

### Shared dashboard does not load

Check:

- The link is complete and has its token.
- The dashboard owner has not stopped sharing it.
- The dataset still exists.
- The deployed API allows the web origin through CORS.
- The shared URL points to the correct deployed web app.

### A chart is empty

Check:

- A dataset is selected.
- The selected metric exists in the dataset.
- The metric contains numeric values.
- The date column contains parseable dates.
- The chosen range contains rows.
- Industry-dashboard mappings point to the correct columns.

## 20. Recommended Operating Routine

### Daily or weekly analysis

1. Select the active workspace.
2. Confirm the dataset and date range.
3. Review the main dashboard.
4. Open Insights for material changes.
5. Review Forecasts when planning forward.
6. Generate a report for the management record.
7. Create a decision for an action that requires ownership.
8. Add an expected outcome and review date.

### Decision review

1. Open Action Needed.
2. Review decisions reaching their review date.
3. Record actual outcomes and statuses.
4. Add lessons learned.
5. Confirm that future recommendations have relevant historical evidence.

### Owner administration

1. Review Settings for members and invitations.
2. Review Connections and sync health.
3. Review Alerts and delivery history.
4. Review Billing status.
5. Review the platform-admin portal if you are an internal operator.

## 21. Data and Security Practices

- Keep API secrets server-side.
- Do not place OpenAI, Stripe, SMTP, OAuth, or service-account credentials in the web app.
- Do not commit .env files.
- Use managed secret storage in production.
- Rotate credentials when a secret may have been exposed.
- Keep workspace data scoped to the active workspace.
- Share only dashboard links intended for the recipient.
- Revoke links that no longer need to be public.
- Treat AI output as decision support requiring human review.
- Record evidence and lessons instead of relying on memory.

## 22. MVP Boundaries

The MVP is strongest when used for:

- Structured dataset analysis
- Metric-driven dashboards
- AI-assisted insights and forecasts
- Recommendation-to-decision workflows
- Outcome and lesson tracking
- Future recommendations informed by historical evidence
- Owner-controlled alerts and workspace administration
- Branded dashboard sharing

The following require additional provider setup or continued implementation:

- Production OpenAI access
- Production SMTP and scheduled email delivery
- Stripe account, price, and webhook configuration
- OAuth client credentials
- Automated adapters for OAuth providers other than Google Analytics
- Production analytics warehouse configuration where DuckDB is not sufficient

Always verify provider readiness before treating a feature as production-ready.
