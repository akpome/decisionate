"use client"

import Link from "next/link"
import { useUser } from "@clerk/nextjs"
import {
  ArrowRight,
  BookOpen,
  Bug,
  Check,
  CircleHelp,
  Lightbulb,
  LifeBuoy,
  MessageSquarePlus,
  Rocket,
  Send,
  Target,
  X,
} from "lucide-react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"

import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import { ProductGuidance } from "@/features/support/product-guidance"
import { submitSupportRequest } from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"

type SupportRequestType = "support" | "bug" | "feature"

const supportRequestSubjects: Record<SupportRequestType, string> = {
  support: "Decisionate support request",
  bug: "Decisionate bug report",
  feature: "Decisionate feature request",
}
const checklistStorageKey =
  "decisionate:getting-started-checklist"

const gettingStartedItems = [
  {
    id: "dataset",
    title: "Load a dataset",
    description: "Upload a CSV or connect a supported data source.",
    href: "/dashboard/datasets",
    action: "Open datasets",
  },
  {
    id: "metrics",
    title: "Choose metrics and filters",
    description: "Choose measures, then open Filters for date and dimension columns.",
    href: "/dashboard",
    action: "Open dashboard",
  },
  {
    id: "analysis",
    title: "Compare datasets in Analysis",
    description: "Connect selected metrics across sources to answer a business question.",
    href: "/dashboard/reports",
    action: "Open reports",
  },
  {
    id: "decision",
    title: "Create an accountable decision",
    description: "Turn a recommendation into a decision with an expected outcome.",
    href: "/dashboard/decisions",
    action: "Open decisions",
  },
  {
    id: "learning",
    title: "Record the result and lesson",
    description: "Capture what happened so future recommendations improve.",
    href: "/dashboard/decisions",
    action: "Open decisions",
  },
] as const

const faqItems = [
  {
    question: "What is Decisionate for?",
    answer:
      "Decisionate brings evidence from different business datasets together to support decisions, outcomes, and lessons learned. Use cross-dataset reports to explore how activity in one source relates to results in another; dashboards provide supporting KPIs and charts.",
  },
  {
    question: "Where are dashboard date and dimension filters?",
    answer:
      "Open Filters beside the other dashboard controls. Date column is preselected from the dataset; change it when another date field better fits the question. Choose a Dimension column, add one or more Unique values from the dropdown, and use Search values to find options. Closing Filters keeps your selections applied. Clear the dimension filter to return to all rows.",
  },
  {
    question: "What is the default dashboard period?",
    answer:
      "New and reset dashboard views use 1 year. Available dashboard periods are 1 month, 1 quarter, 6 months, 1 year, 2 years, and 3 years. The 5-year and All options have been removed; older saved views using either fall back to 1 year. Other valid saved periods are preserved. Reports and Forecasts have their own date controls.",
  },
  {
    question: "Where have Insights and dashboard Analysis moved?",
    answer:
      "Analysis is the on-demand workspace, with Multi dataset report opening by default and Single dataset report available separately. Weekly Reports has a separate page with independent settings. Use the sidebar to move between these workflows, not tabs inside the pages. Old Insights links redirect to Analysis. Dashboard Analysis controls and their panels have been removed; use dashboards for charts and KPIs and Forecasts for forward-looking estimates.",
  },
  {
    question: "Why can a year-long report have insufficient relationship evidence?",
    answer:
      "The default minimum is 52 matched historical observations after grouping and filtering, with daily grouping by default, not simply 52 calendar days selected in the form. A year of monthly source data provides only 12 observations; daily grouping does not manufacture more. Different date ranges, missing periods, dimension filters, constant values, and lag tests can reduce usable evidence further. Choose more overlapping source history or a finer grouping only when the source really contains observations at that frequency.",
  },
  {
    question: "How much connector history is imported?",
    answer:
      "Initial connector ingestion requests the latest 90 days first, then backfills up to three years of available history in background chunks. Provider permissions and available source history can limit coverage. Imports longer than 90 days are chunked, and connector data older than the rolling three-year retention window is deleted. Review connection progress before treating a partial import as complete history.",
  },
  {
    question: "Why do I need to select metrics?",
    answer:
      "Metrics tell Decisionate which columns represent the measures you want to analyze. Industry dashboards can use automatic mapping or the manual mapping controls when column names differ from the expected names.",
  },
  {
    question: "How do recommendations become decisions?",
    answer:
      "Review the evidence, then open Decisions to create a decision. Select a saved cross-dataset report to retain its business question, selected metrics, and findings. A report's Decision draft link opens the decision workflow; previewing or saving a report does not itself record a business action. Rename the generated decision name to describe the action.",
  },
  {
    question: "How does Decisionate learn from outcomes?",
    answer:
      "After a decision is made, record the actual outcome, outcome status, and lesson learned. That evidence is included in later recommendation context for the same workspace and dataset.",
  },
  {
    question: "Why should I archive instead of deleting a decision?",
    answer:
      "Archiving preserves the decision trail and its learning evidence. Permanent deletion is limited to archived records and removes the decision itself while retaining an audit entry in Recent Decision Activity.",
  },
  {
    question: "Who can change workspace configuration?",
    answer:
      "Workspace owners manage settings, members, alerts, connections, and billing. Other workspace members can analyze data and create decisions according to their access level.",
  },
] as const

type ReferenceChapter = {
  id: string
  title: string
  summary: string
  howTos: {
    title: string
    steps: string[]
  }[]
  notes: string[]
}

const referenceChapters: ReferenceChapter[] = [
  {
    id: "reference-orientation",
    title: "1. Decisionate fundamentals",
    summary:
      "Decisionate is a cross-dataset decision-intelligence workspace. The product loop is Data -> Analysis -> Recommendation -> Decision -> Outcome -> Learning. Reports connect evidence across sources; the decision record captures what the business chose and whether it worked.",
    howTos: [
      {
        title: "Start with a business question",
        steps: [
          "Write the decision you need to make in plain language, such as whether to increase campaign spend, change pricing, or address a sales bottleneck.",
          "Identify the outcome measure and the related measures from other datasets, such as advertising spend in a marketing source and orders or revenue in a commerce source.",
          "Choose the period and aggregation that match the question. A daily operational question should not be answered with a yearly total unless that is intentional.",
          "Use Analysis to analyze the selected evidence across datasets. Use dashboards, forecasts, saved relationships, and alerts as supporting context, then record the action and expected outcome in Decisions.",
        ],
      },
      {
        title: "Use the decision loop consistently",
        steps: [
          "Observe the selected data and its date range.",
          "Interpret the movement using analysis features and, where configured, AI-assisted recommendations.",
          "Decide by recording the action, owner, metric, expected result, and review date.",
          "Learn by recording the actual outcome, status, and lesson learned after the review date or when evidence is available.",
        ],
      },
    ],
    notes: [
      "Decisionate outputs are decision-support evidence. They do not replace business judgment or approval processes.",
      "A chart can show movement, but a decision record is where accountability, action, and learning are retained.",
    ],
  },
  {
    id: "reference-account-workspaces",
    title: "2. Accounts, workspaces, and access",
    summary:
      "A workspace is the isolation boundary for datasets, connections, dashboards, reports, forecasts, alerts, relationships, decisions, and AI context. Agencies can manage an agency workspace and may be granted access to specific client workspaces.",
    howTos: [
      {
        title: "Create your first workspace",
        steps: [
          "Sign in and open the onboarding or workspace setup page.",
          "Choose Professional for a single business workspace or Agency for an agency that manages client workspaces.",
          "Enter the organization or workspace name and submit the setup form.",
          "After setup, open the dashboard and confirm that the organization name and branding are correct.",
        ],
      },
      {
        title: "Understand the main roles",
        steps: [
          "Workspace owners manage workspace configuration, members, branding, billing, connections, and data permissions available to the workspace.",
          "Workspace members can analyze permitted data and create or work with decisions according to the permissions assigned to them. Members do not see the Manage group or configuration links.",
          "Client workspace owners manage the client workspace and can grant approved agency-owner access where that workflow is enabled.",
          "Client users have the same client-workspace data and analysis access as the client owner. Only the client owner can grant the agency owner access to client data.",
          "An agency owner may switch to an authorized client workspace. In that client context, the agency owner can use the permitted analysis and decision features but does not get the client Data group for adding datasets or connection parameters.",
        ],
      },
      {
        title: "Switch workspaces safely",
        steps: [
          "Use the workspace selector in the application shell only when your account has an authorized workspace context.",
          "Confirm the workspace name and branding in the shell before reviewing data or making a decision.",
          "Treat every dataset, alert, relationship, and decision as belonging to the active workspace. Do not use a saved link from another workspace as a substitute for selecting the correct workspace.",
          "Client owners normally work in their own isolated client workspace and do not use an agency workspace switcher.",
        ],
      },
    ],
    notes: [
      "Workspace access is enforced by the API as well as the navigation. Hiding a link is not the security boundary.",
      "If a workspace or user appears to have the wrong access, stop creating or changing data and contact support. The request includes the active workspace and authenticated account context automatically.",
    ],
  },
  {
    id: "reference-data-ingestion",
    title: "3. Load and manage data",
    summary:
      "Datasets are the evidence layer for dashboards and analysis. You can upload supported files or configure a connector when that connector is available and correctly configured for the deployment.",
    howTos: [
      {
        title: "Upload a file",
        steps: [
          "Open Data -> Datasets.",
          "Choose the file upload control and select a supported CSV, JSON, Excel, or Parquet file.",
          "Use a header row with stable column names. Include a date or timestamp column when you need trends, periods, forecasts, relationships, or time-based alerts.",
          "Wait for the upload and processing status to complete before opening the dataset details page.",
          "Open dataset details to inspect row count, columns, detected metrics, dimensions, and the available date range.",
        ],
      },
      {
        title: "Configure a connector",
        steps: [
          "Open Data -> Connections and review the connector catalog. The status shown in the application is the authority for whether a source is available in the current deployment.",
          "Choose from the accounting, commerce, payment, CRM, advertising, analytics, or database sources actually offered by the catalog. Connector availability and required fields can differ by deployment; do not assume every provider is enabled.",
          "Select a connector and provide only the fields requested by that connector, such as an account, property, company, shop, tenant, or object identifier.",
          "Use read-only or minimum-scope credentials wherever the provider supports them.",
          "Run the connection or pull test if the connector exposes one. Resolve provider authentication, permission, identifier, and server-configuration errors before enabling scheduled sync.",
          "Choose the dataset name and sync settings, then perform a manual pull before relying on scheduled ingestion.",
        ],
      },
      {
        title: "Understand initial history and large imports",
        steps: [
          "The initial connector import requests the latest 90 days first so recent data can become available before the historical backfill completes.",
          "The worker then backfills up to a rolling three years of available source history in checkpointed chunks. Background history chunks are at most 30 days, and provider limits or permissions can reduce the history returned.",
          "Manual date ranges longer than 90 days are also split into chunks. Choose a range within the supported three-year history rather than submitting repeated overlapping full imports.",
          "Review connection progress and dataset coverage while the backfill is running. A recent dataset appearing does not mean all historical chunks are complete.",
          "Connector data older than the rolling three-year retention boundary is deleted. This connector policy is separate from uploaded-file and subscription retention rules.",
        ],
      },
      {
        title: "Enable scheduled and incremental sync",
        steps: [
          "Open the configured connection and enable automatic sync when the source should be refreshed without manual intervention.",
          "Choose the sync time using the workspace or user local-time control when it is available.",
          "Use incremental sync when the provider supports a date or cursor window so each run retrieves new or changed records rather than rebuilding the entire history.",
          "Review the resulting dataset after the first scheduled run. Check the latest period, row count, columns, and connector status.",
          "If a scheduled run fails, inspect the connection status and alert or delivery logs before changing credentials.",
        ],
      },
    ],
    notes: [
      "Connector schemas follow the incoming source data; do not assume that two providers expose identical columns.",
      "Google Drive and OneDrive are file-storage services rather than trend-data connectors in the connection workflow. Use the supported file-import path when available.",
      "Connector data remains source-provider data. Decisionate-generated decisions and supported outputs are separate from the original provider export.",
    ],
  },
  {
    id: "reference-dataset-details",
    title: "4. Dataset details, metrics, and periods",
    summary:
      "Dataset details is where you confirm what the source actually contains. Metric selectors should be based on the detected dataset columns rather than on a fixed schema.",
    howTos: [
      {
        title: "Inspect a dataset",
        steps: [
          "Open Data -> Datasets and select a dataset, or open dataset details from a dashboard selector.",
          "Review the detected date column and date range before interpreting a chart.",
          "Review numeric columns that can be used as measures and non-numeric columns that can be used as dimensions, categories, stages, channels, products, or segments.",
          "Use the metric selector on the page when you need to focus analysis on a particular numeric column.",
          "If a metric is not available, inspect the source column type and values. A numeric-looking field may have been ingested as text because of mixed or invalid values.",
        ],
      },
      {
        title: "Set time scope and aggregation",
        steps: [
          "Choose the start date or period control shown on the page.",
          "Choose the grouping period: daily, weekly, monthly, or quarterly where the page supports it.",
          "Choose the value aggregation in the order provided by the control: Sum, Count, Average, Minimum, or Maximum.",
          "Wait for the charts and KPI values to refresh. A changed control should apply to the charts and KPIs in that dashboard or analysis page.",
          "When comparing pages or a shared view, confirm that the same date, period, and aggregation selections were applied to the shared page.",
        ],
      },
      {
        title: "Choose dimensions for category analysis",
        steps: [
          "Use a non-numeric column such as channel, source, product, service, stage, or customer segment for category labels.",
          "Use a numeric column for the value being measured, such as revenue, spend, orders, leads, or countable records.",
          "For a funnel, use the stage or status column for the stages and the numeric measure for the values.",
          "If a chart shows arbitrary category labels, return to the mapping controls and select a non-numeric column from the actual dataset.",
        ],
      },
    ],
    notes: [
      "A metric name is a source column name. It is not a universal Decisionate field and can differ between connectors.",
      "The selected period and aggregation affect interpretation. Always include them when communicating a chart finding.",
    ],
  },
  {
    id: "reference-dashboards",
    title: "5. Dashboards and chart controls",
    summary:
      "Dashboards provide charts, KPIs, and targets for decision work. Dataset dashboards have a Filters control alongside their other toolbar controls. Analysis is the analysis workspace; dashboards no longer have an Analysis panel.",
    howTos: [
      {
        title: "Open and configure a dashboard",
        steps: [
          "Open Dashboards and choose the business or industry dashboard appropriate to your question, including Auto Repair Shop Performance when available. Decision Performance uses decision records rather than dataset date and dimension selectors.",
          "Select a dataset on General Business Overview, or open Dataset in an industry dashboard. Dataset and metric choices are saved for the dashboard where you are working.",
          "Choose the target metric on General Business Overview. Use Edit dashboard to change metric selections, targets, or industry chart mappings where available.",
          "Open Filters beside Edit dashboard, Dataset, or Compare data to choose the Date column and Dimension column. The selectors are aligned horizontally when space permits and stack on narrow screens.",
          "Set the start date, Period, Group by, and Aggregate in the chart controls or industry Dataset panel. New views and Reset view or Reset range use 1 year; other supported saved periods remain in place.",
          "Use the chart action controls to expand a chart, save a PDF, or share the dashboard when those controls are available.",
        ],
      },
      {
        title: "Filter a dashboard by dimension values",
        steps: [
          "Open Filters. Keep the preselected Date column or choose another detected date field; changing it clears the old start-date selection.",
          "Leave Dimension column on All rows for an unfiltered view, or choose a source field such as region, channel, product, or customer segment.",
          "Choose one or more Unique values from the dropdown. Use Search values to find additional options; selected values appear below the controls and can be removed individually.",
          "Choose at least one value after selecting a dimension. An empty value selection is not treated as all rows. Review loading, no-match, or retry messages before interpreting the charts.",
          "Close Filters to make more room for charts. The selected date and dimension values remain applied. Use Clear dimension filter to return to all rows.",
        ],
      },
      {
        title: "Map metrics in an industry dashboard",
        steps: [
          "Open Edit dashboard and identify the chart name first. The mapping card names the chart whose source columns it controls.",
          "Select the numeric value column for a trend, KPI, bar, or funnel value axis.",
          "Select the non-numeric category, channel, product, service, stage, or status column where the chart requires labels.",
          "Leave mappings empty when automatic detection correctly identifies the source columns.",
          "Review the chart after mapping. A mapping without a corresponding chart should not be created or retained.",
        ],
      },
      {
        title: "Set targets and inspect chart detail",
        steps: [
          "Open Edit dashboard on General Business Overview to set optional metric targets in Metrics & Targets.",
          "Use the chart expand action to open a larger view when the chart is mapped and the action is available.",
          "For a horizontal bar chart opened in a modal, use the expanded vertical presentation to compare category values more easily.",
          "Use the chart legend or direct labels to verify which dataset column each visual encoding represents.",
        ],
      },
    ],
    notes: [
      "Dashboard Period offers 1 month, 1 quarter, 6 months, 1 year, 2 years, and 3 years. The 5-year and All periods are no longer selectable; saved views using them reopen at 1 year.",
      "Closing Filters does not clear its settings. Read the active dimension label and chart date labels before comparing dashboards or exports.",
      "Dashboards are not the entire product. Their purpose is to make evidence understandable before a decision is recorded.",
      "The available chart types depend on the dashboard definition, source columns, data cardinality, and selected mappings.",
    ],
  },
  {
    id: "reference-joins",
    title: "6. Joining datasets",
    summary:
      "Joins combine datasets for dashboard analysis when their dates or periods can be normalized. The result can expose metrics and columns from both sources while remaining scoped to the active workspace.",
    howTos: [
      {
        title: "Create a joined analysis",
        steps: [
          "Open Compare data on a dataset dashboard with at least two available source datasets.",
          "Choose the datasets, source metrics, and date columns used for normalization. Each source has its own dimension filter; choose its Unique values before joining if you need a segment-specific comparison.",
          "Review the source selections and choose Join selected data. Decisionate normalizes the selected date columns into comparable periods.",
          "Check whether the normalized source periods actually overlap before interpreting joined values.",
          "Review the joined metric selector and chart mappings. Metrics from both datasets should be available where the dashboard supports them.",
        ],
      },
      {
        title: "Reset a joined analysis",
        steps: [
          "Use Reset joined data after a join has been created.",
          "This releases the joined analysis context. Review the restored dataset and metric selections before continuing.",
          "Re-select the original dataset or metric if the dashboard asks for a new selection after reset.",
        ],
      },
    ],
    notes: [
      "A join is an analysis operation, not proof that one source caused movement in another.",
      "A join can fail when normalized periods do not overlap or when the date columns contain incompatible or invalid values.",
      "Use Analysis for multi-metric, multi-dataset analysis and saved report snapshots. Use Relationships for a saved two-metric monitor instead of repeatedly rebuilding an ad hoc dashboard join.",
    ],
  },
  {
    id: "reference-analysis",
    title: "7. Analysis, reports, and forecasts",
    summary:
      "Analysis contains single- and multi-dataset analysis: choose metrics, dates, and dimension filters, review the findings, and save a report snapshot. Multi dataset report opens by default. Forecasts remains a separate forward-looking workflow; old Insights links redirect to Analysis.",
    howTos: [
      {
        title: "Analyze metrics and findings",
        steps: [
          "Open Analysis in the sidebar. Multi dataset report opens by default; Single dataset report uses the same analysis engine for one source. Use Build analysis and Analysis preview to move between setup and results.",
          "For Single dataset report, choose one Dataset from the dropdown in Dataset and metrics. Only its metrics, Date column and Dimension column are shown. Choose Unique values to filter that source. Changing the dataset clears the previous metrics, filters and date choices; removing every metric does not clear the chosen dataset.",
          "Select the approved metrics needed to answer your business question. Multi dataset reports require metrics from at least two datasets.",
          "Under Datasets and metrics, review each source's preselected Date column. If needed, choose its Dimension column and add Unique values from the dropdown; Search values narrows the available choices.",
          "New multi dataset reports open with Explore relationships. Relationship analysis is expanded, with the correlation method, Minimum matching days/weeks/months/quarters, delay and metric-pair controls. Assess a decision is a separate optional analysis type; saved reports retain their original type.",
          "Set Start, End and Group results by. Business has seasonal activity is under Unusual changes and applies to those checks, not to correlation. Missing history cannot be replaced by a wider date selection.",
          "Choose Assess a decision to review an existing decision, or open the decision and choose Assess business impact. Its action and outcome metric are reused. The outcome Date column is beside Outcome metric, preselected from the saved evidence. The default period comes from the decision's saved evidence, or its outcome data when no evidence period exists; a matching previous assessment preserves its period. Enter the actual implementation date, then choose one unaffected comparison dataset and its result. The comparison Date column is beside Dimension column and one Unique value. Comparison changes preserve the period; optional history and grouping changes in Analysis are under Analysis settings. Weekly Reports keeps its dates and grouping automatic, without that section. Minimum history requirements appear beside assessment readiness. Non-overlapping dates are blocked. The comparison provides the baseline for normal ups and downs; earlier records determine whether an extra yearly adjustment is supported, without a seasonal-business checkbox. Explain why the comparison was unaffected and check for other major changes. Save assessment to decision attaches the result to that same decision, without creating another decision or overwriting its recorded outcome or lessons.",
          "Timing from earlier analysis reuses reliable driver-to-outcome timing from the decision's original saved correlation. It must pass separate earlier-history checks, end before implementation, and match the outcome's date, aggregation, dimension filter and timezone. Choose the relevant earlier relationship if more than one qualifies; no arbitrary numeric delay is requested. Unknown timing does not become an assumed zero delay. The actual implementation date stays fixed, and early results count in the total. Early and later estimates are shown separately. Weekly impact needs at least 52 complete weeks before implementation and 8 complete later weeks after the timing reference date; daily needs 90 before and 28 later, monthly 24 before and 6 later. Too little later history says Waiting for enough results. These are model-based estimates, not a guaranteed causal delay. Weekly emails retain the timing and phase results.",
          "Improvement target is optional. Minimum worthwhile improvement uses the outcome metric's units: a total for values that can be added, or an average per period for other metrics. The estimated range is compared with the target. Costs, profit and break-even are not calculated.",
          "Choose Preview analysis and wait for the queued analysis to finish. Review metric movements, anomaly findings, relationship evidence, coverage, and limitations together in Analysis preview.",
          "Business-change reports lead with a calculated answer: the change appears to have helped, worked against your goal, or remains unclear. A failed comparison produces no impact amount. The range and checks are explained in ordinary language; model-based evidence is not a randomized test or a guarantee of cause and effect.",
          "Exploratory report interpretation is requested automatically for each new preview. If the AI provider is unavailable or AI credits are exhausted, the report shows clearly labeled deterministic baseline rules instead. Business-change answers are calculated directly and do not need an external AI response. Opening a saved snapshot does not rerun AI.",
          "Treat recommendations as prompts for review. Create decisions from the Decisions page after confirming the source data and business context.",
        ],
      },
      {
        title: "Set relationship timing and historical coverage",
        steps: [
          "Choose Spearman (rank-based) or Pearson (straight-line) in Relationship analysis. Minimum matching periods defaults to 52 and counts usable matched observations after grouping and filtering, not the number of dates entered.",
          "Analysis and Relationships share the same new-analysis defaults: Spearman, daily grouping, sum aggregation where applicable, 52 minimum historical observations, a maximum lag of 12 grouped periods, and same-period comparison. Valid deliberately saved settings are retained, including a saved 24-observation minimum or weekly grouping.",
          "Delay to check is always visible above Metric pairs. Set Timing to test to Same period only or Check whether a named metric comes first. That direction is a hypothesis to check. Only directed pairs test positive delays, up to Maximum delay; all pairs include the same-period comparison.",
          "Remove relationship pairs you do not want to analyze. Restore them from Removed pairs when needed. These choices are saved with the report and weekly template; removing a pair does not remove its metrics from KPI or anomaly analysis.",
          "Maximum delay names the unit selected in Group results by and is limited to 12. A lag of 2 means two daily, weekly, monthly, or quarterly periods, depending on that setting. A directional timing test also includes lag zero.",
          "With metrics from three or more datasets, configure every relevant pair independently. A metric can follow one source and lead another; there is no single global middle-metric direction.",
          "If evidence is insufficient, check real overlapping source dates, selected date columns, missing or constant values, dimension filters, and the observations left after lagging. Twelve monthly observations do not meet the default minimum of 52; a wider form date range cannot create missing source history. The 52-observation minimum must still be met after lagging, so positive-lag tests need additional history.",
        ],
      },
      {
        title: "Read the combined chart",
        steps: [
          "In Analysis preview or the weekly Report preview, use Indexed metric comparison to compare selected metrics on one chart. Each line is identified by its dataset and metric, using distinct colors and, where needed, line styles.",
          "Switch between Indexed and Actual beside the chart title. Actual shows original values and units on one numeric scale; different units are not directly comparable. This display choice does not rerun the analysis or change saved evidence.",
          "The chart uses the displayed shared positive baseline date as 100. An index of 120 means 20 percent above that metric's baseline value, not 120 orders or 120 currency units.",
          "Use the metric cards and tooltip for original values and units. Read coverage and baseline warnings; metrics without a usable positive baseline cannot be plotted on the indexed scale.",
          "Compare movement without treating equal index levels as equal business quantities or proof that one metric caused another.",
          "The business impact chart opens in Actual. Its Indexed view uses the same estimated baseline for both actual and without-change lines, so their estimated difference is preserved. Changing After the change to Full history does not change that baseline.",
        ],
      },
      {
        title: "Review anomaly findings",
        steps: [
          "Open Analysis in the sidebar, select metrics and dates, and enable Business has seasonal activity when appropriate. Preview the analysis to assess every selected metric with the shared anomaly engine. Weekly Reports checks the completed week as a whole and each day separately, with its own settings.",
          "Review any anomaly finding alongside the underlying chart and time periods. Confirm that the finding is not caused by an incomplete connector sync, a date change, a join, or a source-schema change.",
          "The seasonal setting requests validation of repeating patterns; it does not force seasonal adjustment when history is insufficient. Read any limited-history or trend-only warning, and consider promotions or holidays that are not automatically known to the model.",
          "Record the business response as a decision when action is needed. Include the suspected cause, the expected result, and the date on which the result will be reviewed.",
          "After the review period, record the actual outcome and lesson learned so the evidence can be used in later recommendation context.",
        ],
      },
      {
        title: "Generate a forecast",
        steps: [
          "Open Analysis -> Forecasts and select a dataset.",
          "Select the metric and review the preselected Date column beside Dimension column. To forecast a segment, choose its dimension field and add one or more Unique values; use Search values to find options or clear the filter for all rows.",
          "Set the history date range, period, grouping, and aggregation. These are forecast controls, not the dashboard's 1-year default period policy.",
          "Enable Business has seasonal activity only when recurring calendar patterns are relevant. Seasonal forecasting validates candidate patterns against past history; review the seasonal basis, fallback, and coverage warnings instead of assuming the checkbox guarantees a seasonal model.",
          "Review the historical series, forecast horizon, confidence information, and any model or fallback status shown by the page.",
          "Check whether the forecast is based on enough comparable periods and whether the source has gaps or recent ingestion delays.",
          "Use the forecast recommendation as decision evidence, then record the expected outcome and review date in a decision.",
        ],
      },
      {
        title: "Build a report",
        steps: [
          "Open Analysis in the sidebar and configure the selected datasets and metrics in Build analysis.",
          "Rename the report to suit your analysis, enter a business question, and preview the findings. Save snapshot stores the generated report; reopening a snapshot preserves its analysis.",
          "Analysis report names are unique starting labels, not descriptions of the business question. Weekly reports default to Weekly Business Report. Custom names are kept; edit a report name to describe its purpose.",
          "Changing metric, date, dimension, seasonal, or timing settings requires a fresh preview before saving the changed analysis.",
          "Use the report as a review package. Reports are not a replacement for recording the business decision and expected outcome.",
        ],
      },
      {
        title: "Set up or remove weekly report settings",
        steps: [
          "Open Weekly Reports in the sidebar. In Report setup, select source metrics, date columns, dimension filters, business question, relationship pairs and the seasonal-business setting. Choose Preview report. Previewing does not save or change the existing weekly setup.",
          "Each workspace has one current weekly report. After a successful preview, choose Save changes to replace it and its setup for future weeks. A different name does not create another active report. Changing the setup requires another preview before saving. These settings remain independent of Analysis.",
          "Weekly history contains sent reports and previously saved legacy reports. Opening history does not change the current setup. Replacing the current report keeps previously sent reports and decision evidence unchanged.",
          "Open Delivery settings to review recipients, schedule, and sending preferences in Alerts. Saving a weekly report does not itself enable delivery or change recipients.",
          "Weekly reports assess the latest completed week with up to a rolling three years of available history, including unusual changes in the selected metrics. Manual Start and End dates are for the generated snapshot and do not fix the weekly reporting window.",
          "The last completed Monday-Sunday is analyzed daily and as a whole week, while earlier relationship history is grouped into complete weeks ending before that report week. Totals cover the full week and compare with the preceding week. Whole-week assessment compares each selected metric with its normal weekly range; Daily changes checks individual dates. These can differ: daily ups and downs may cancel out, or small daily changes may add up to an unusual week. Incomplete weeks are not scored against complete historical weeks. The weekly page has automatic dates, 52 minimum matched weeks by default and a maximum lag of 12 weeks. Analysis settings remain independent.",
          "After previewing and saving the current weekly report, Send report now emails it only to the workspace owner. Sending does not save unsaved changes. This one-time action works while scheduled delivery is paused and does not change scheduled recipients or mark the scheduled email as already sent.",
          "Copy selection to Weekly Reports copies a saved business analysis into an editable weekly configuration. Non-weekly timing resets to same-period so daily lags are not interpreted as weeks. Preview, then save before using it. Delivery settings manages recipients and the sending switch.",
          "Use Remove weekly settings to pause delivery and clear its configuration while keeping saved snapshots and linked decisions.",
        ],
      },
      {
        title: "Delete a saved report",
        steps: [
          "Choose the saved report from Saved reports and use Delete saved report when your workspace permissions allow it.",
          "Read the confirmation before deleting. Linked decisions and datasets are kept. Deleting a saved snapshot does not remove independent weekly settings or change delivery.",
          "To clear weekly settings and pause delivery while retaining snapshots, use Remove weekly settings on the Weekly Reports page.",
        ],
      },
    ],
    notes: [
      "AI availability depends on the platform provider configuration, model availability, and Decisionate AI credit balance.",
      "When AI is unavailable, the application can show deterministic or rules-based analysis where that feature supports a fallback. Read the analysis source and confidence indicators.",
    ],
  },
  {
    id: "reference-relationships-alerts",
    title: "8. Relationships and alerts",
    summary:
      "Relationships describe observed association between metrics from different datasets. Alerts use selected dataset metrics, optional KPI targets, saved relationships, and recommendations to produce scheduled notification digests.",
    howTos: [
      {
        title: "Create a cross-source relationship",
        steps: [
          "Open Analysis -> Relationships.",
          "Choose the left and right datasets, date columns, and metrics. Each side has an independent Dimension column filter with Unique values and Search values; choose at least one value for any selected dimension.",
          "The defaults match Analysis: Spearman, daily Group by, Sum aggregation, 52 Minimum historical observations, Maximum lag 12, and Same-period comparison only. Verify actual overlapping dates after applying filters to each source.",
          "Choose Relationship direction using the named metric that leads, or keep Same-period comparison only. Maximum lag appears only for a directional timing search and tests zero through that limit. Either metric can lead; labels and dimension filters keep their original dataset identities. The maximum is 12 grouped periods for every grouping.",
          "The old fixed-lag editor is removed. Existing saved fixed-lag monitors keep their original timing and show it as Saved fixed lag until you explicitly choose a new direction. Saved observation thresholds and grouping are not replaced by the new defaults.",
          "The selected observation minimum is enforced after filtering, grouping and lagging. Too few matched observations produce insufficient data, not a usable correlation. Custom observation and lag settings are saved with the monitor and reused during scheduled evaluation.",
          "Review the strength, direction, matched periods, best observed delay, stability or credibility, and the plain-language explanation.",
          "Save the relationship only when the source columns, period, and interpretation are meaningful for the workspace.",
        ],
      },
      {
        title: "Configure an alert metric and optional KPI target",
        steps: [
          "Open Analysis -> Alerts and review the dataset metrics loaded into the KPI focus list.",
          "Select each metric that should shape the alert digest. The metric key includes its dataset so identical column names from different datasets remain separate.",
          "For a selected metric, enter an optional numeric KPI target. Leave it blank when the metric has no benchmark.",
          "Select any saved relationships that should shape cross-source analysis.",
          "Save the analysis selection. Targets appear in the digest and email as benchmark context and are included in the AI analysis context.",
        ],
      },
      {
        title: "Configure and verify alert delivery",
        steps: [
          "Open Analysis -> Alerts and configure notification recipients and schedule alongside the KPI setup. Email transport is managed centrally by a platform administrator.",
          "Confirm that the selected alert metrics and relationships belong to the active workspace.",
          "Use the test delivery action where available and inspect the delivery status or history.",
          "Enable the schedule only after confirming recipients and platform email readiness.",
          "If a relationship is deleted, remove it from the alert selection. A deleted relationship should not remain an active alert focus.",
        ],
      },
    ],
    notes: [
      "A relationship reports association, not proven causation.",
      "Relationships saves a two-metric monitor. For multiple metrics across multiple datasets, use Multi dataset report in Analysis. The retired advanced relationship explorer has been removed.",
      "The current KPI target is a digest and AI benchmark; it does not by itself create a separate threshold-triggered alert.",
      "Alerts are workspace-scoped. A workspace must not receive another workspace's datasets, targets, relationships, recipients, or recommendations.",
    ],
  },
  {
    id: "reference-decisions",
    title: "9. Decisions, outcomes, and learning",
    summary:
      "The decision record is the central accountability object. It connects evidence to an action, an owner, an expected outcome, an actual result, and a reusable lesson.",
    howTos: [
      {
        title: "Create a decision from scratch",
        steps: [
          "Open Decisions and choose Create decision. Select a saved report as evidence, or choose a dataset for a manual decision.",
          "For report evidence, review only the selected report metrics and choose an available outcome metric. For a manual decision, choose the dataset and optional metric offered by that workflow.",
          "Replace the unique generated decision name with a concise title that states the choice, not just the observation. The name is a label, not a reason to overwrite another decision.",
          "Complete Action with the concrete action, scope, owner responsibility, and timing. For example, state what will change and for how long.",
          "Complete Expected outcome with a measurable success condition, target, review date, or hypothesis.",
          "Set priority, category, confidence, review date, and owner fields available on the form, then create the decision.",
        ],
      },
      {
        title: "Continue a report-linked decision",
        steps: [
          "Open a saved report and look under Decisions and outcomes for its linked active decisions or an available Decision draft link.",
          "Decision draft opens the decision workflow with that report's evidence. Review its selected metrics, record a concrete action and expected outcome, add reasoning and a review date where required, then explicitly save the decision.",
          "An earlier draft is not a completed decision. Continue the existing record when it represents the same action; updating a decision edits that record instead of requiring another decision with the same name.",
          "Use Manage decisions for the central Decisions page. Archived decisions remain in the report's separate archived-history section rather than being presented as active actions.",
        ],
      },
      {
        title: "Use a decision template",
        steps: [
          "Open decision creation and choose a template instead of Start from scratch.",
          "Select the dataset and metric before editing the generated content when possible.",
          "Confirm that the title, action, description, and expected outcome refer to the selected metric.",
          "Replace generic text with the actual action, amount, segment, time period, accountable owner, and measurable outcome.",
          "Save the decision only after reviewing every generated field. A template is a starting structure, not a final business decision.",
        ],
      },
      {
        title: "Record the result and lesson",
        steps: [
          "Open the decision when the review date arrives or when the outcome is known.",
          "Record the actual outcome using concrete values, observations, and the period measured.",
          "Set the outcome status to Successful, Partially Successful, or Unsuccessful when the evidence supports a classification.",
          "Write the lesson learned: what should be repeated, changed, tested next, or avoided.",
          "Save the outcome and learning fields. Review the activity history to confirm who changed the record and when.",
        ],
      },
      {
        title: "Work through Action Needed",
        steps: [
          "Open Decisions -> Action Needed to focus on decisions that require follow-up, an outcome update, or an owner action.",
          "Open each item and confirm the owner, expected outcome, review date, and current status before taking action.",
          "Update the decision record when the action is complete or when new evidence changes the expected result.",
          "Record the actual outcome and lesson learned so the item leaves the follow-up loop with an auditable result.",
        ],
      },
      {
        title: "Archive, delete, and export decisions",
        steps: [
          "Archive a decision when it should leave the active portfolio but remain available for history and learning.",
          "Only the decision owner or a workspace owner can archive or delete a decision under the workspace permissions.",
          "Use permanent deletion only when the record should no longer be retained. Deletion is deliberate and should be treated as irreversible.",
          "Workspace owners can export filtered decisions as CSV for analysis or JSON for complete structured records, including supported outcome and activity details.",
          "Export only the current filtered scope and store the file according to the workspace's governance requirements.",
        ],
      },
    ],
    notes: [
      "A metric selection identifies the evidence target; it does not automatically define the action. The Action field must state what the business will do.",
      "Historical outcomes and lessons are used as context for future decision-support recommendations within the authorized workspace scope.",
      "Recent Decision Activity identifies the actor and change type so the decision trail can be reviewed.",
    ],
  },
  {
    id: "reference-sharing-exports",
    title: "10. Sharing, PDFs, and exports",
    summary:
      "Dashboard sharing is designed for review by people who receive a share link. Decision exports are a separate owner-only governance feature.",
    howTos: [
      {
        title: "Share a dashboard",
        steps: [
          "Open Dashboards and select the dashboard you want to share.",
          "Confirm the dataset, metrics, mappings, period, aggregation, chart names, and visual state before sharing.",
          "Choose Share and copy the generated link only after the share status confirms it is active.",
          "Open the link in a private browser session to verify that the shared page shows the intended workspace branding, charts, controls, date range, and selected metrics.",
          "Use the dashboard's own Stop sharing control to disable that dashboard link. Use the global stop-sharing action from the dashboards page when all links for the workspace must be stopped.",
        ],
      },
      {
        title: "Save a dashboard PDF",
        steps: [
          "Open the desired dashboard and select Save PDF.",
          "Check the print preview for the branded title, chart labels, legends, chart proportions, and page breaks.",
          "Confirm that navigation and interactive-only controls are excluded from the saved page.",
          "Save the PDF as a review artifact and remember that it is a snapshot, not a live dashboard.",
        ],
      },
      {
        title: "Export decision records",
        steps: [
          "Open Decisions and apply the filters needed for the export.",
          "Choose CSV for tabular analysis or JSON for the complete structured record.",
          "Confirm that the current filters represent the records you intend to export.",
          "Keep the export activity within the workspace governance process. Connector source data is not treated as a Decisionate connector-file download.",
        ],
      },
    ],
    notes: [
      "A share link can expose the dashboard content permitted by that link. Stop sharing when the review is complete.",
      "Sharing dashboards does not grant the recipient workspace configuration, connector, member-management, or billing access.",
    ],
  },
  {
    id: "reference-settings-billing-admin",
    title: "11. Settings, billing, and platform administration",
    summary:
      "Settings control the workspace. Billing controls the workspace subscription. Platform administration is a separate operator function and is not a customer workspace feature.",
    howTos: [
      {
        title: "Configure workspace settings",
        steps: [
          "Open Manage -> Settings as a workspace owner.",
          "Review workspace name, organization details, branding, logo, and report display name.",
          "Manage agency members, client workspace access, one client owner and one client user per client workspace, invitations, ownership assignments, and invitation revocation where those controls are available to your plan and role.",
          "Configure workspace alert recipients and schedule in Analysis -> Alerts. The email provider is managed centrally by the platform.",
          "Save one section at a time and verify the resulting workspace name, branding, and access behavior in a fresh page load.",
        ],
      },
      {
        title: "Review billing and subscription status",
        steps: [
          "Open Manage -> Billing as the workspace owner.",
          "Review the current plan, trial or subscription status, renewal or expiration information, included workspace allowance, and included Decisionate AI credits shown by the page.",
          "For an Agency plan, review included client workspaces and any additional client-workspace allowance shown by the billing implementation.",
          "Use the billing action provided by the page for checkout, plan change, or cancellation. Do not place payment-card details in datasets or support messages.",
          "After cancellation or expiration, review the displayed access and retention status and contact support for an authority-verified data request.",
        ],
      },
      {
        title: "Use the platform admin portal",
        steps: [
          "Use the platform-admin route only with an authorized platform-admin account.",
          "Review workspace, user, usage, AI-credit, alert-delivery, audit, email, and billing information available to your assigned admin permissions.",
          "Create or manage evaluation workspaces and invitations only when you are authorized to do so.",
          "Use the search and CSV download functions for audit and performance review where available.",
          "Treat platform-admin deletion as destructive: verify the workspace, users, and confirmation details before approving a deletion.",
        ],
      },
    ],
    notes: [
      "Workspace owners and platform administrators are different roles. A workspace owner does not automatically become a platform administrator.",
      "Decisionate AI credits are internal usage units. They are not a one-to-one statement of OpenAI tokens or OpenAI billing credits.",
    ],
  },
  {
    id: "reference-ai-data-security",
    title: "12. AI, storage, retention, and security",
    summary:
      "AI and analytics operate on authorized workspace evidence. Read the Security, Privacy, and Terms pages for the deployment-specific legal and security statements; this section explains the operational workflow.",
    howTos: [
      {
        title: "Understand the AI analysis path",
        steps: [
          "The user selects report metrics, source date columns, dimension filters, analysis settings, or a forecast or decision context.",
          "Changing dashboard charts or opening Filters does not request the removed dashboard AI Analysis panel. Open Analysis when you need interpretation of the selected evidence.",
          "Decisionate computes or retrieves the permitted data summary and supporting evidence for that workspace.",
          "Where the AI provider is configured and credits are available, the application sends the configured analysis context to the AI service and receives a structured summary, recommendations, risks, and confidence information.",
          "Where the provider is unavailable or unsupported, the feature may use a deterministic fallback when one is implemented for that page.",
          "The user reviews the result and decides whether to create a decision. AI does not execute business actions automatically.",
        ],
      },
      {
        title: "Manage historical decision learning",
        steps: [
          "Record outcomes and lessons in the decision detail page instead of leaving the result only in an email or external note.",
          "Keep the lesson specific: describe the action, evidence, result, confounding factors, and what should change next time.",
          "Future recommendation context uses authorized historical decision evidence for the relevant workspace, dataset, metric, or decision scope.",
          "Review the AI source and learning-context indicators before treating a recommendation as informed by historical evidence.",
        ],
      },
      {
        title: "Understand data storage and retention",
        steps: [
          "Uploaded and connector data are handled through the configured storage and analytics providers of the deployment.",
          "Connector ingestion imports recent data first, backfills older history in checkpointed chunks, and can use partitioned and summarized storage paths so analysis does not require an unbounded single file.",
          "Historical summaries preserve analytical aggregates and relevant low-cardinality grouping dimensions; row-level detail removed by summarization cannot be recovered from the summary.",
          "Connector datasets use a rolling three-year retention window, with older connector data deleted. Read subscription-expiry retention, uploaded-file retention, backups, and provider policies together with the current Privacy and Terms pages.",
          "Request deletion or export through an authorized support request when self-service behavior does not cover the required scope.",
        ],
      },
    ],
    notes: [
      "Never send passwords, API keys, full payment-card details, or secrets in a support form.",
      "Review the public Security page for the current claims about hosting, encryption, workspace isolation, backups, subprocessors, and deletion.",
      "A workspace boundary is expected to protect datasets, decisions, alerts, relationships, and AI context from crossing into another workspace.",
    ],
  },
  {
    id: "reference-troubleshooting",
    title: "13. Troubleshooting and support diagnostics",
    summary:
      "Most failures can be narrowed down by identifying whether the issue is authentication, workspace access, dataset loading, provider configuration, analysis availability, or email delivery.",
    howTos: [
      {
        title: "The page says no datasets are available",
        steps: [
          "Confirm the workspace name in the application shell. You may be viewing an isolated workspace that has no datasets yet.",
          "Open Data -> Datasets and check whether the dataset appears there.",
          "If the dataset is missing, confirm that the upload or connector pull completed successfully and that you have access to the active workspace.",
          "If the dataset appears in the selector but the page still shows an empty state, refresh once and report the page URL, workspace, and dataset name through Help & Support.",
        ],
      },
      {
        title: "The API or analysis service is unavailable",
        steps: [
          "Capture the exact error message and the page where it occurred.",
          "Check whether other pages load. If all pages fail, the backend or authentication session may be unavailable.",
          "If only one connector or analysis fails, check that provider credentials, environment configuration, and required identifiers are valid.",
          "Retry once after confirming the session is still signed in. Do not repeatedly submit a connector pull if the provider may be rate limiting it.",
          "Send support the route, connector name, exact error, and safe reproduction details. The request includes the timestamp, active workspace, and session context automatically. Never include secrets.",
        ],
      },
      {
        title: "Dashboard filters or expected analysis are missing",
        steps: [
          "On a dataset dashboard, open Filters beside the toolbar controls to reveal Date column and Dimension column. The panel starts closed; this does not mean filtering has been removed.",
          "If a dimension is selected, choose at least one Unique value. Clear dimension filter restores all rows; closing the Filters panel does not clear it.",
          "If filtering is loading or failed, use the visible status or Retry filtered dashboard control. Do not interpret previous or unfiltered figures as a successful filtered result.",
          "Dashboard Analysis panels and a separate Insights workspace are no longer part of this workflow. Open Analysis for single- or multi-dataset analysis, or Forecasts for projections.",
          "For a period change, new or reset dashboards use 1 year, while other supported saved periods remain. Saved 5-year or All selections reopen as 1 year.",
        ],
      },
      {
        title: "A shared dashboard is stale or different",
        steps: [
          "Confirm the share link is still active and that the dashboard owner has not stopped sharing it.",
          "Compare dataset, metric, date range, period, aggregation, mappings, joins, and chart names between the owner dashboard and the shared page.",
          "Refresh the owner dashboard and save the intended state before generating a new share link or PDF.",
          "If only the shared page is wrong, send support both the owner route and the shared URL without exposing private credentials.",
        ],
      },
    ],
    notes: [
      "A browser refresh can resolve a stale client state, but it cannot repair a missing backend permission or provider credential.",
      "Support requests are most useful when they include the exact error and reproducible steps. The page URL, timestamp, active workspace, authenticated account, request type, and browser context are attached automatically.",
    ],
  },
]

export default function HelpSupportPage() {
  const { user } = useUser()
  const { activeWorkspaceId } = useActiveWorkspace(user?.id)
  const [completedItems, setCompletedItems] =
    useState<Record<string, boolean>>({})
  const [supportFormOpen, setSupportFormOpen] =
    useState(false)
  const [supportRequestType, setSupportRequestType] =
    useState<SupportRequestType>("support")
  const [supportRequesterEmail, setSupportRequesterEmail] =
    useState("")
  const [supportSubject, setSupportSubject] =
    useState(supportRequestSubjects.support)
  const [supportMessage, setSupportMessage] =
    useState("")
  const [supportSubmitting, setSupportSubmitting] =
    useState(false)
  const [supportFormError, setSupportFormError] =
    useState("")
  const [supportFormSuccess, setSupportFormSuccess] =
    useState("")
  const supportFormRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    if (supportFormOpen) {
      supportFormRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })
      supportFormRef.current?.querySelector("textarea")?.focus({ preventScroll: true })
    }
  }, [supportFormOpen])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(
          checklistStorageKey
        )

        if (saved) {
          const parsed = JSON.parse(saved)

          if (parsed && typeof parsed === "object") {
            setCompletedItems(
              parsed as Record<string, boolean>
            )
          }
        }
      } catch {
        // The checklist is a convenience and should never block support access.
      }
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  const completedCount = useMemo(
    () =>
      gettingStartedItems.filter(
        item => completedItems[item.id]
      ).length,
    [completedItems]
  )

  function toggleChecklistItem(id: string) {
    setCompletedItems(current => {
      const next = {
        ...current,
        [id]: !current[id],
      }

      try {
        window.localStorage.setItem(
          checklistStorageKey,
          JSON.stringify(next)
        )
      } catch {
        // Keep the checklist usable when browser storage is unavailable.
      }

      return next
    })
  }

  function openSupportForm(
    requestType: SupportRequestType
  ) {
    const accountEmail =
      user?.primaryEmailAddress?.emailAddress ?? ""

    if (accountEmail && !supportRequesterEmail) {
      setSupportRequesterEmail(accountEmail)
    }

    setSupportRequestType(requestType)
    setSupportSubject(
      supportRequestSubjects[requestType]
    )
    setSupportFormError("")
    setSupportFormSuccess("")
    setSupportFormOpen(true)
  }

  async function handleSupportSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()

    if (!user?.id) {
      setSupportFormError(
        "Your workspace session is still loading. Please try again shortly."
      )
      return
    }

    try {
      setSupportSubmitting(true)
      setSupportFormError("")
      setSupportFormSuccess("")

      const response = await submitSupportRequest(
        {
          request_type: supportRequestType,
          requester_email: supportRequesterEmail,
          subject: supportSubject,
          message: supportMessage,
          page_url: window.location.href,
        },
        user.id,
        activeWorkspaceId,
        supportRequesterEmail
      )

      setSupportFormSuccess(response.message)
      setSupportMessage("")
    } catch (error) {
      setSupportFormError(
        error instanceof Error
          ? error.message
          : "Unable to send your support message."
      )
    } finally {
      setSupportSubmitting(false)
    }
  }

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Support"
        title="Help & Support"
        description="A concise guide to getting value from Decisionate, resolving issues, and turning evidence into better decisions."
      />

      <ProductGuidance
        key={`${user?.id ?? ""}:${activeWorkspaceId}`}
        userId={user?.id ?? ""}
        workspaceId={activeWorkspaceId}
        onContactSupport={message => {
          openSupportForm("support")
          if (message) setSupportMessage(message)
        }}
      />

      <section
        id="quick-start"
        className="rounded-2xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-5 sm:p-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[var(--decisionate-brand-primary-text)]">
              <Rocket size={20} aria-hidden="true" />
              <h2 className="text-lg font-semibold">Getting Started</h2>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Follow the decision loop from data to learning. Your progress is saved in this browser.
            </p>
          </div>

          <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700">
            {completedCount} of {gettingStartedItems.length} complete
          </span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-5">
          {gettingStartedItems.map(item => {
            const complete = Boolean(completedItems[item.id])

            return (
              <div
                key={item.id}
                className={`flex min-h-44 flex-col rounded-xl border bg-white p-4 ${
                  complete
                    ? "border-green-200"
                    : "border-gray-200"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleChecklistItem(item.id)}
                  title={`${complete ? "Mark" : "Mark as"} ${item.title.toLowerCase()} ${complete ? "incomplete" : "complete"}`}
                  aria-label={`${complete ? "Mark" : "Mark as"} ${item.title.toLowerCase()} ${complete ? "incomplete" : "complete"}`}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                    complete
                      ? "border-green-500 bg-green-500 text-white"
                      : "border-gray-300 bg-white text-transparent hover:border-[var(--decisionate-brand-primary)]"
                  }`}
                >
                  <Check size={16} aria-hidden="true" />
                </button>

                <p className="mt-3 text-sm font-semibold text-gray-900">
                  {item.title}
                </p>
                <p className="mt-1 flex-1 text-xs leading-5 text-gray-500">
                  {item.description}
                </p>

                  <Link
                    href={item.id === "decision" ? "/dashboard/decisions" : item.href}
                    title={item.description}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--decisionate-brand-primary-text)] hover:underline"
                  >
                    {item.id === "decision" ? "View decisions" : item.action}
                    <ArrowRight size={13} aria-hidden="true" />
                  </Link>
              </div>
            )
          })}
        </div>
      </section>

      <section
        id="support-actions"
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <button
            type="button"
            onClick={() => openSupportForm("support")}
            title="Open the support message form"
            className="group rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:shadow-md"
          >
            <LifeBuoy
              size={21}
              className="text-[var(--decisionate-brand-primary-text)]"
              aria-hidden="true"
            />
            <span className="mt-4 block text-base font-semibold text-gray-900">
              Contact Support
            </span>
            <span className="mt-1 block text-sm leading-6 text-gray-500">
              Send the issue details; workspace, account, page, and session context are attached automatically.
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--decisionate-brand-primary-text)]">
              Open support form
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => openSupportForm("bug")}
            title="Open the bug report form"
            className="group rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-red-200 hover:shadow-md"
          >
            <Bug size={21} className="text-red-600" aria-hidden="true" />
            <span className="mt-4 block text-base font-semibold text-gray-900">
              Report a Bug
            </span>
            <span className="mt-1 block text-sm leading-6 text-gray-500">
              Include the error message, URL, browser, and steps that led to the problem.
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-red-700">
              Open bug form
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => openSupportForm("feature")}
            title="Open the feature request form"
            className="group rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-amber-200 hover:shadow-md"
          >
            <MessageSquarePlus size={21} className="text-amber-600" aria-hidden="true" />
            <span className="mt-4 block text-base font-semibold text-gray-900">
              Request a Feature
            </span>
            <span className="mt-1 block text-sm leading-6 text-gray-500">
              Describe the decision workflow, users, and outcome the feature should improve.
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-amber-700">
              Open feature form
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </button>
        </div>

        {supportFormOpen && (
          <form
            ref={supportFormRef}
            onSubmit={handleSupportSubmit}
            className="scroll-mt-24 rounded-2xl border border-[var(--decisionate-brand-primary-ring)] bg-white p-5 shadow-sm sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
                  Support message
                </p>
                <h2 className="mt-1 text-lg font-semibold text-gray-900">
                  Send a message to Decisionate support
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Your signed-in account, workspace, current page, and request context are included automatically. Use a different reply email only when needed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSupportFormOpen(false)}
                title="Close support form"
                aria-label="Close support form"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-gray-700">
                <span>Request type</span>
                <select
                  value={supportRequestType}
                  onChange={event => {
                    const value = event.target.value as SupportRequestType
                    setSupportRequestType(value)
                    setSupportSubject(supportRequestSubjects[value])
                  }}
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                >
                  <option value="support">Support</option>
                  <option value="bug">Bug report</option>
                  <option value="feature">Feature request</option>
                </select>
              </label>

              <label className="space-y-1 text-sm font-medium text-gray-700">
                <span>Reply email</span>
                <input
                  type="email"
                  required
                  value={supportRequesterEmail}
                  onChange={event => setSupportRequesterEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                />
              </label>

              <label className="space-y-1 text-sm font-medium text-gray-700 sm:col-span-2">
                <span>Subject</span>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={supportSubject}
                  onChange={event => setSupportSubject(event.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                />
              </label>

              <label className="space-y-1 text-sm font-medium text-gray-700 sm:col-span-2">
                <span>Message</span>
                <textarea
                  required
                  maxLength={10000}
                  rows={6}
                  value={supportMessage}
                  onChange={event => setSupportMessage(event.target.value)}
                  placeholder="Tell us what happened, what you expected, and what would help."
                  className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                />
              </label>
            </div>

            {supportFormError && (
              <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {supportFormError}
              </p>
            )}
            {supportFormSuccess && (
              <p role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {supportFormSuccess}
              </p>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={supportSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send size={16} aria-hidden="true" />
                {supportSubmitting ? "Sending..." : "Send message"}
              </button>
            </div>
          </form>
        )}
      </section>

      <section
        id="decision-loop"
        className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            title="Decision intelligence workflow"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
          >
            <Target size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              The Decisionate workflow
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              Keep the focus on decisions: use data as evidence, recommendations as prompts, and outcomes as learning.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-4">
          {[
            ["1", "Observe", "Load data and select the metrics and period that frame the question."],
            ["2", "Interpret", "Compare selected metrics across datasets in Analysis; use forecasts, relationships, and alerts for context."],
            ["3", "Decide", "Record the chosen action, expected outcome, owner, and review date."],
            ["4", "Learn", "Capture what happened and what to repeat or avoid next time."],
          ].map(([number, title, description]) => (
            <div key={number} className="border-l-2 border-gray-200 pl-4">
              <span className="text-xs font-bold text-[var(--decisionate-brand-primary-text)]">
                {number}
              </span>
              <h3 className="mt-1 text-sm font-semibold text-gray-900">
                {title}
              </h3>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="faq"
        className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-center gap-2">
          <CircleHelp
            size={20}
            className="text-[var(--decisionate-brand-primary-text)]"
            aria-hidden="true"
          />
          <h2 className="text-lg font-semibold text-gray-900">
            Frequently Asked Questions
          </h2>
        </div>

        <div className="mt-4 divide-y divide-gray-100">
          {faqItems.map(item => (
            <details key={item.question} className="group py-4">
              <summary className="cursor-pointer list-none pr-6 text-sm font-semibold text-gray-900 marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {item.question}
                  <ArrowRight
                    size={16}
                    className="shrink-0 text-gray-400 transition group-open:rotate-90"
                    aria-hidden="true"
                  />
                </span>
              </summary>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-600">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section
        id="reference-guide"
        className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            title="Decisionate reference guide"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
          >
            <BookOpen size={20} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
              Platform reference
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-900">
              Decisionate user manual
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
              Use this guide as the operating reference for the platform. Each chapter explains the purpose of a feature, the normal workflow, and the checks that prevent misleading analysis.
            </p>
          </div>
        </div>

        <nav
          aria-label="User manual contents"
          className="mt-5 rounded-xl border border-gray-100 bg-gray-50 p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Contents
          </p>
          <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {referenceChapters.map(chapter => (
              <a
                key={chapter.id}
                href={`#${chapter.id}`}
                className="text-sm font-medium text-[var(--decisionate-brand-primary-text)] hover:underline"
              >
                {chapter.title}
              </a>
            ))}
          </div>
        </nav>

        <div className="mt-5 space-y-3">
          {referenceChapters.map(chapter => (
            <details
              key={chapter.id}
              id={chapter.id}
              className="group scroll-mt-6 rounded-xl border border-gray-200 bg-white"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-4 marker:hidden sm:px-5">
                <span>
                  <span className="block text-base font-semibold text-gray-900">
                    {chapter.title}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-gray-500">
                    {chapter.summary}
                  </span>
                </span>
                <ArrowRight
                  size={17}
                  className="mt-1 shrink-0 text-gray-400 transition group-open:rotate-90"
                  aria-hidden="true"
                />
              </summary>

              <div className="border-t border-gray-100 px-4 py-4 sm:px-5">
                <div className="space-y-5">
                  {chapter.howTos.map(howTo => (
                    <div key={howTo.title}>
                      <h3 className="text-sm font-semibold text-gray-900">
                        {howTo.title}
                      </h3>
                      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-600">
                        {howTo.steps.map(step => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    Important notes
                  </p>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-amber-900">
                    {chapter.notes.map(note => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>

                <a
                  href="#reference-guide"
                  className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--decisionate-brand-primary-text)] hover:underline"
                >
                  Back to contents
                  <ArrowRight size={13} aria-hidden="true" />
                </a>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section
        id="guides"
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        <Link
          href="#reference-account-workspaces"
          title="Open workspace setup guidance"
          className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:shadow-md"
        >
          <BookOpen
            size={21}
            className="mt-0.5 text-[var(--decisionate-brand-primary-text)]"
            aria-hidden="true"
          />
          <span>
            <span className="block text-sm font-semibold text-gray-900">
              Workspace setup guidance
            </span>
            <span className="mt-1 block text-sm leading-6 text-gray-500">
              Review workspace roles, access, and switching without leaving the current workspace.
            </span>
          </span>
        </Link>

        <a
          href="#quick-start"
          title="Open the Decisionate quick-start checklist"
          className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:shadow-md"
        >
          <Lightbulb
            size={21}
            className="mt-0.5 text-amber-600"
            aria-hidden="true"
          />
          <span>
            <span className="block text-sm font-semibold text-gray-900">
              Quick-start guide
            </span>
            <span className="mt-1 block text-sm leading-6 text-gray-500">
              Jump back to the five-step checklist for the shortest path from data to learning.
            </span>
          </span>
        </a>

        <div className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <LifeBuoy
            size={21}
            className="mt-0.5 text-[var(--decisionate-brand-primary-text)]"
            aria-hidden="true"
          />
          <span>
            <span className="block text-sm font-semibold text-gray-900">
              Security and legal reference
            </span>
            <span className="mt-1 block text-sm leading-6 text-gray-500">
              Review the current statements for security practices, privacy, and service terms.
            </span>
            <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-[var(--decisionate-brand-primary-text)]">
              <Link href="/security" className="hover:underline">
                Security
              </Link>
              <Link href="/privacy" className="hover:underline">
                Privacy
              </Link>
              <Link href="/terms" className="hover:underline">
                Terms
              </Link>
            </span>
          </span>
        </div>
      </section>

      <p className="flex items-center gap-2 text-xs text-gray-400">
        <LifeBuoy size={14} aria-hidden="true" />
        Workspace, account, page, request type, and session context are included automatically. Add a decision or dataset name only when relevant to your request.
      </p>
    </div>
  )
}
