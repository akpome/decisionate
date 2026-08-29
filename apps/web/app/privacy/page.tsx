import { PolicyPage, PolicySection } from "@/components/landing/policy-page"

export const metadata = {
  title: "Privacy Policy",
  description: "How Decisionate handles account, workspace, connector, analytics, and AI data.",
}

const processors = [
  [
    "Clerk",
    "Sign-in, sign-up, browser sessions, and external identity information when Clerk is the configured authentication provider.",
  ],
  [
    "OpenAI",
    "AI analysis only when an OpenAI provider is configured. The application sends a bounded prompt containing the requested analysis context, aggregate facts, selected metric information, and approved decision-learning context; it is not intended to send the raw dataset file or every source row.",
  ],
  [
    "Stripe",
    "Checkout, subscription status, billing events, and payment processing. Payment-card details are handled by Stripe rather than stored in Decisionate application tables.",
  ],
  [
    "Resend or configured SMTP provider",
    "System emails, support messages, reports, and alerts when email delivery is enabled. A workspace may configure its own SMTP provider for workspace emails.",
  ],
  [
    "Cloudflare R2 or Amazon S3",
    "Parquet files, uploaded data, and connector-ingested objects when remote object storage is configured. Local development may use local storage instead.",
  ],
  [
    "Railway or equivalent API/database provider",
    "API execution, service logs, transactional PostgreSQL records, and database backups in the deployment selected by Decisionate. The exact provider and region must be recorded for each production deployment.",
  ],
  [
    "Vercel or equivalent frontend provider",
    "Frontend hosting and delivery. The provider can receive normal web request metadata and deliver the application; it should not be configured with database or connector secrets.",
  ],
  [
    "Upstash Redis or equivalent cache provider",
    "Optional distributed cache and rate limiting. When enabled, it can receive cache keys, workspace-scoped analysis cache values, and short-lived operational counters.",
  ],
  [
    "BigQuery or equivalent analytics provider",
    "Optional analytical query engine. If enabled, configured analytical tables and derived dataset values are processed there; local DuckDB does not send data to a third party.",
  ],
  [
    "Cloudflare or equivalent DNS/CDN provider",
    "Domain routing, CDN, and security-layer traffic metadata when enabled. Dataset files and application secrets should remain in their configured application storage and secret systems.",
  ],
  [
    "Sentry",
    "Error and performance diagnostics when SENTRY_DSN is configured. Diagnostic events can contain request metadata and error context, so production deployments should review and configure Sentry data scrubbing.",
  ],
  [
    "Connected data providers",
    "A provider such as HubSpot, Shopify, Xero, Zoho Books, Stripe, QuickBooks, FreshBooks, Meta Ads, or another enabled connector may provide source data after the workspace authorizes the connection.",
  ],
]

export default function PrivacyPage() {
  return (
    <PolicyPage
      eyebrow="Privacy"
      title="Privacy Policy"
      description="This page explains what Decisionate handles, why it handles it, which processors may receive it, and how a workspace owner can request access, export, or deletion."
      updated="August 14, 2026"
    >
      <PolicySection title="1. What this policy covers">
        <p>
          This policy applies to the Decisionate web application and related
          services operated by Decisionate Inc. (&quot;Decisionate&quot;, &quot;we&quot;, &quot;us&quot;,
          or &quot;our&quot;) under the Decisionate brand. It describes the application
          as currently built and does not claim controls that are only planned.
          Customers remain responsible for their own notices and legal basis
          when they import personal information about their staff, customers,
          leads, or contacts.
        </p>
      </PolicySection>

      <PolicySection title="2. Information we handle">
        <ul className="list-disc space-y-2 pl-6">
          <li>Account and identity data such as name, email address, external authentication identifier, and internal Decisionate user identifier.</li>
          <li>Workspace data such as workspace name, members, roles, invitations, branding, preferences, subscriptions, and access records.</li>
          <li>Business data such as uploaded files, connector data, dataset columns and metrics, reports, forecasts, relationships, alerts, decisions, expected and actual outcomes, and lessons learned.</li>
          <li>Operational data such as usage events, AI-credit consumption, delivery status, audit activity, error context, and service configuration.</li>
          <li>Billing data needed to identify a subscription and process webhooks. Stripe handles payment-card details through its checkout and billing services.</li>
        </ul>
      </PolicySection>

      <PolicySection title="3. Why we use it">
        <ul className="list-disc space-y-2 pl-6">
          <li>To authenticate users and enforce workspace and role permissions.</li>
          <li>To ingest, store, normalize, aggregate, query, and display authorized data.</li>
          <li>To generate requested dashboards, insights, forecasts, reports, recommendations, and alerts.</li>
          <li>To connect recommendation evidence to decisions, outcomes, lessons learned, and future decision-support context.</li>
          <li>To meter AI usage, operate subscriptions, send requested email, prevent abuse, debug failures, and improve reliability.</li>
        </ul>
      </PolicySection>

      <PolicySection title="4. Workspace isolation">
        <p>
          Workspace isolation is an authorization boundary. The API derives
          the active workspace from verified authentication and membership
          context, then applies workspace filters to datasets, connections,
          decisions, alerts, relationships, joined-data caches, AI usage, and
          learning context. A workspace identifier supplied by the browser is
          not by itself permission to read another workspace.
        </p>
        <p>
          Customers should report any suspected cross-workspace exposure
          immediately to{" "}
          <a className="font-semibold text-blue-700 underline" href="mailto:support@decisionate.ca">
            support@decisionate.ca
          </a>
          .
        </p>
      </PolicySection>

      <PolicySection title="5. AI data flow">
        <p>
          AI is optional and provider configuration controls whether an AI
          request is made. Before a request, Decisionate computes the selected
          analysis context and bounded facts. The intended request contains the
          analysis instructions, metric or relationship context, aggregate
          values and trends, and relevant decision-learning evidence. Raw
          uploaded files and unbounded source rows are not the intended AI
          payload.
        </p>
        <p>
          Decisionate does not use OpenAI output as an automatic business
          action. A user reviews recommendations and can create a decision,
          record outcomes, and add lessons. Those approved records can become
          bounded evidence for later recommendations in the same workspace.
          Do not place secrets, passwords, API keys, or unnecessary personal
          information in decision notes or dataset columns used for AI analysis.
        </p>
      </PolicySection>

      <PolicySection title="6. Third-party processors">
        <p>
          The following processors or provider categories may receive customer
          information in the situations described below. The active list for a
          deployment depends on its environment configuration and which
          connectors or features a workspace uses.
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-bold">Provider</th>
                <th className="px-4 py-3 font-bold">Purpose and data path</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {processors.map(([provider, purpose]) => (
                <tr key={provider} className="align-top">
                  <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-950">{provider}</td>
                  <td className="px-4 py-4 text-slate-600">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          This register is not a claim that every provider is active in every
          deployment. It should be reviewed whenever infrastructure,
          connectors, authentication, email, analytics, or AI providers change.
        </p>
      </PolicySection>

      <PolicySection title="7. Credentials and security">
        <p>
          OAuth credentials are encrypted by the application when the required
          encryption key is configured. Platform and workspace SMTP secrets are
          also protected through the application secret-encryption path. HTTPS,
          managed database access, remote object-storage controls, provider
          account permissions, backups, and Sentry scrubbing remain deployment
          responsibilities and must be configured before production use.
        </p>
        <p>
          Connector credentials should be read-only or minimum-scope wherever
          the provider supports it. Database connectors validate that imported
          SQL is a single read query, but that validation is not a substitute
          for a read-only database role.
        </p>
      </PolicySection>

      <PolicySection title="8. Retention, deletion, and export">
        <p>
          Connector-ingested data is subject to a fixed five-year retention
          rule. Decisionate retains the current month and the preceding 59
          calendar months of connector data. When a connector dataset is
          synchronized or the connector maintenance job runs, monthly hot
          partitions and historical yearly or statistical summary partitions
          older than that window are removed from live storage. This is an
          application policy, not a customer-selectable setting, and it applies
          to connector data and its derived Parquet summaries. Records without
          a source date are retained and aged by their connector ingestion
          partition month.
        </p>
        <p>
          This automatic rule does not delete the connector configuration,
          workspace membership, decisions, reports, or manually uploaded
          datasets. Deleting a connector or workspace can trigger broader
          deletion workflows. Data retained by a connected provider is subject
          to that provider&apos;s retention terms. Backups and provider retention
          can outlast deletion from live application storage, so a deletion
          request may require the applicable backup cycle to expire before all
          copies are removed.
        </p>
        <p>
          If a paid plan or time-limited trial expires, Decisionate keeps the
          workspace&apos;s analytical dataset storage available for 89 days after
          the subscription end date. If the subscription is cancelled, the
          same storage is deleted 90 days after the cancellation date, or at
          the earlier applicable deadline. After that point, the scheduled
          billing lifecycle job deletes the workspace&apos;s hot and historical
          Parquet data, uploaded analytical files, dataset records, joins, and
          shares. This applies to an agency workspace and its client
          workspaces. A later renewal does not restore data that has already
          been deleted.
          Connector connection settings and credentials are not deleted by
          this data purge and may be removed separately by an authorized
          workspace administrator.
        </p>
        <p>
          Connector data is treated as read-only analytical input, with the
          connected provider remaining the source of truth. Decisionate does
          not offer raw connector rows or connector Parquet files as customer
          downloads. Customers should use the connected provider for source
          data export. Decisionate-generated decisions, reports, insights,
          forecasts, recommendations, alerts, and decision history may be
          exported in supported formats only by the owner of the relevant
          workspace, including a client-workspace owner. Members and agency
          users with managed access to a client workspace cannot export these
          records. Export requests use the active workspace permissions and
          are recorded in workspace activity history.
        </p>
        <p>
          An authorized workspace owner can request deletion or export by
          emailing{" "}
          <a className="font-semibold text-blue-700 underline" href="mailto:support@decisionate.ca">
            support@decisionate.ca
          </a>
          . We will verify authority, identify the relevant workspace, explain
          what the current deployment can provide, and confirm any backup or
          provider-retention limitation before completing the request.
        </p>
      </PolicySection>

      <PolicySection title="9. International transfers and updates">
        <p>
          Providers may process information in countries other than the
          customer&apos;s country. Customers should review the terms and privacy
          information of the providers they authorize. We may update this
          policy when the product, providers, or legal requirements change and
          will show the effective date at the top of the page.
        </p>
      </PolicySection>

      <PolicySection title="10. Contact">
        <p>
          For a privacy question, access request, deletion request, export
          request, security report, or beta support request, contact{" "}
          <a className="font-semibold text-blue-700 underline" href="mailto:support@decisionate.ca">
            support@decisionate.ca
          </a>
          . Please do not email passwords, API keys, or full payment-card
          details.
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
