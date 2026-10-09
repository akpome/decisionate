import Link from "next/link"
import { PolicyPage, PolicySection } from "@/components/landing/policy-page"

export const metadata = {
  title: "Privacy Policy",
  description: "How Decisionate handles accounts, workspaces, connected data, AI, retention, and privacy requests."
}

const processors = [
  ["Clerk", "Account authentication, identity information, and sign-in sessions. Decisionate does not store your sign-in password."],
  ["Hosting and storage providers", "Application delivery, databases, files, service logs, and backups. Supported infrastructure includes Railway, Vercel, PostgreSQL, and Cloudflare R2 or Amazon S3; the providers and locations used depend on the deployment."],
  ["OpenAI", "The selected analysis context, aggregate metrics and trends, and bounded decision outcomes or learning notes. User-authored text and category labels can contain personal information."],
  ["Stripe", "Subscription identifiers, checkout, payments, invoices, and billing events. Stripe collects payment-card details through its services; Decisionate does not store full card numbers."],
  ["Resend or the configured email provider", "Recipient details and the contents of requested reports, alerts, invitations, support correspondence, and service emails when email delivery is enabled."],
  ["Sentry, when diagnostics are configured", "Error context and service request metadata. The API disables default personal-information collection, local-variable capture, and request-body capture in its monitoring configuration."],
  ["Optional cache and analytics providers", "Upstash Redis may process temporary cache values and operational counters; BigQuery may process configured analytical data. These providers receive data only when the corresponding service is configured."],
  ["Connected providers", "Authorized imports and provider API requests, including Meta Ads, Google services, accounting, commerce, payment, and CRM connectors selected by a workspace."]
]

export default function PrivacyPage() {
  return (
    <PolicyPage
      eyebrow="Privacy"
      title="Privacy Policy"
      description="What information we handle, why we use it, how long we keep it, and how to request access, correction, or deletion."
      updated="October 8, 2026"
    >
      <PolicySection title="1. Scope and responsibility">
        <p>
          This policy covers the Decisionate website, web application, and related
          services (&quot;Decisionate&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
          We handle account and service information to operate Decisionate.
          Workspace owners control the business data they import, their members,
          connections, and sharing choices. They are responsible for having the
          authority and any required consent to provide information about other people.
        </p>
        <p>
          Our privacy contact is <a href="mailto:support@decisionate.ca">support@decisionate.ca</a>.
          Questions about information imported by your employer or another business
          may also need to be directed to that workspace owner.
        </p>
      </PolicySection>

      <PolicySection title="2. Information we handle">
        <ul className="list-disc space-y-2 pl-6">
          <li>Account information: name, email address, authentication identifiers, session information, and internal user identifiers.</li>
          <li>Workspace information: business and onboarding details, members and roles, invitations, agency-client relationships, branding, preferences, and access records.</li>
          <li>Business information: uploaded files, authorized connector records, dataset columns and metrics, dashboards, forecasts, relationships, alerts, reports, decisions, notes, outcomes, and lessons.</li>
          <li>Connection information: provider and account identifiers, configuration, authorization scopes, and credentials needed to import authorized data.</li>
          <li>Service information: request metadata, usage and AI-credit records, billing identifiers, delivery status, activity history, errors, and support messages.</li>
        </ul>
      </PolicySection>

      <PolicySection title="3. Why we use information">
        <p>
          We use information to authenticate accounts, enforce permissions, import
          and analyze authorized data, display dashboards, track decisions and
          outcomes, deliver requested reports and alerts, and provide support.
          We also use relevant service records to operate billing and AI,
          prevent abuse, investigate failures, and maintain reliability.
          We do not use a connection as authorization to access unrelated accounts
          or to publish a workspace&apos;s data.
        </p>
      </PolicySection>

      <PolicySection title="4. Connected providers and Meta Ads">
        <p>
          A connection requires authorization from a person with the relevant
          provider permissions. The imported information depends on the provider,
          selected account, resource, and granted permissions. Meta Ads imports
          can include ad-account and campaign identifiers, names, and performance
          metrics such as spend, impressions, clicks, and conversions. Decisionate
          uses these records for reporting and analysis, not to create or edit
          advertising campaigns on your behalf. Provider approvals may be required.
        </p>
        <p>
          Removing a connection removes its stored authorization credentials and
          prevents future syncs through that connection. It does not automatically
          delete datasets already imported. An authorized user can delete those
          datasets separately, or request workspace deletion. You can also revoke
          authorization through the connected provider. Revocation and deletion
          in Decisionate do not delete the provider&apos;s original records.
        </p>
      </PolicySection>

      <PolicySection title="5. Workspace access and public sharing">
        <p>
          The API checks identity, workspace membership, and role permissions for
          private data. Agency management of a client workspace does not by itself
          grant permission to read the client&apos;s data. Platform administration
          is a separate permission.
        </p>
        <p>
          If you enable a public dashboard share, anyone with a valid share link
          can view the information exposed by that link without signing in.
          Share links should be treated as confidential and can be revoked by an
          authorized user. The public live demo and recorded walkthrough use
          prepared sample data, not customer workspace data. Demo sample files
          are public and may be cached by browsers and hosting infrastructure.
        </p>
      </PolicySection>

      <PolicySection title="6. AI processing">
        <p>
          For a requested AI analysis, Decisionate prepares bounded facts,
          selected metric or relationship context, aggregate values and trends,
          and relevant decision outcomes or learning notes from the same workspace.
          This context is sent to the configured AI provider. The analysis request
          is not an upload of the raw dataset file or every source row.
        </p>
        <p>
          Text, labels, and notes included in that context may contain personal
          information. Do not include passwords, API keys, or unnecessary sensitive
          information. Outputs are decision support and require human review;
          they do not automatically execute business actions. Provider processing
          and retention terms also apply when you use AI.
        </p>
      </PolicySection>

      <PolicySection title="7. Service providers and transfers">
        <p>
          The following providers or categories can receive information for the
          stated purposes. Contact our privacy team for the
          active provider and processing-location details relevant to your workspace.
        </p>
        <div className="overflow-x-auto border border-neutral-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-4 py-3 font-semibold">Provider</th>
                <th className="px-4 py-3 font-semibold">Purpose and information</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {processors.map(([provider, purpose]) => (
                <tr key={provider} className="align-top">
                  <td className="px-4 py-3 font-medium">{provider}</td>
                  <td className="px-4 py-3 text-neutral-600">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Providers may process information outside your country. Their processing
          locations, safeguards, and retention practices depend on the configured
          service. We may also disclose information when required by law or to
          address a security incident or misuse, subject to applicable requirements.
        </p>
      </PolicySection>

      <PolicySection title="8. Cookies and browser storage">
        <p>
          Authentication uses session cookies and related provider mechanisms.
          Local browser storage remembers preferences such as language, theme,
          and selected workspace. Browser caches and the application&apos;s offline
          shell may keep static resources and public demo samples. These functions
          support sign-in and the application experience. Sign out on shared
          devices and use browser controls to clear stored information when needed.
        </p>
      </PolicySection>

      <PolicySection title="9. Retention and deletion">
        <p>
          Connector data is kept for three years, then deleted. The retention
          window is the current calendar month and the preceding 35 months.
          Sync and scheduled maintenance remove expired connector records and
          partitions from live analytical storage. Records without a usable source
          date are aged using their ingestion partition month. This rule does not
          automatically delete manually uploaded datasets, decisions, account
          information, or workspace configuration.
        </p>
        <p>
          Where a trial or paid subscription expires, analytical dataset storage
          becomes eligible for deletion 89 days after the subscription end date.
          If a subscription is cancelled, the cancellation deadline is 90 days
          after the recorded cancellation date; the earlier applicable deadline
          applies. Scheduled lifecycle processing removes analytical files,
          dataset records, related analyses, joins, and share records, including
          client workspaces governed by an expired agency plan. Renewing after
          deletion does not restore deleted data. This purge does not remove
          connection settings or credentials; remove the connection separately
          when you no longer want those retained.
        </p>
        <p>
          Authorized workspace deletion removes supported live workspace records
          and data files. Account, billing, security, and support records may need
          to be retained for their service purpose, legal obligations, or disputes.
          Backups, replicas, and storage versioning can have separate retention
          cycles. Deleting live data is not a promise of immediate erasure of every
          backup copy, and provider source records remain subject to the provider&apos;s terms.
        </p>
      </PolicySection>

      <PolicySection title="10. Product exports and individual privacy rights">
        <p>
          Available exports of Decisionate-generated outputs follow workspace
          permissions; supported decision exports are restricted to workspace
          owners. Decisionate does not provide raw connector rows or Parquet files
          as a separate source-data download service. Use the connected provider
          for source exports.
        </p>
        <p>
          These product restrictions do not limit an individual&apos;s rights under
          applicable privacy law. You can contact us to request access to or
          correction of your personal information, ask about its use or disclosure,
          request deletion, or withdraw consent where applicable. You do not have
          to be a workspace owner to request your own personal information.
          We verify identity or authority, protect other people&apos;s information,
          and explain any lawful exception or retention requirement.
        </p>
        <p>
          Where PIPEDA applies, access requests are generally answered within
          30 calendar days, subject to permitted extensions and exceptions.
          You may raise an unresolved concern with the applicable privacy authority.
          See the <a href="https://www.priv.gc.ca/en/privacy-topics/accessing-personal-information/obligations-for-organizations/02_05_d_54_ati_02/">Office of the Privacy Commissioner of Canada&apos;s access guidance</a>.
        </p>
      </PolicySection>

      <PolicySection title="11. Security, updates, and contact">
        <p>
          We use application access checks and protected credential storage;
          deployment safeguards and their limits are described on our
          {" "}<Link href="/security">Security page</Link>. No service can promise
          absolute security. We update this policy as the product and its data
          practices change and show the update date above.
        </p>
        <p>
          Send privacy, deletion, access, correction, or security requests to
          {" "}<a href="mailto:support@decisionate.ca">support@decisionate.ca</a>.
          Include the relevant account or workspace and a short description.
          Do not email passwords, access tokens, full payment-card details, or
          unnecessary copies of personal information.
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
