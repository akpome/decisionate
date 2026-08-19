import { PolicyPage, PolicySection } from "@/components/landing/policy-page"

export const metadata = {
  title: "Terms of Service",
  description: "Plain-English terms for using Decisionate.",
}

export default function TermsPage() {
  return (
    <PolicyPage
      eyebrow="Legal"
      title="Terms of Service"
      description="These terms explain the basic rules for using Decisionate, including workspaces, customer data, AI-assisted features, connectors, billing, and deletion."
      updated="August 12, 2026"
    >
      <PolicySection title="1. Using Decisionate">
        <p>
          Decisionate Inc. (&quot;Decisionate&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) provides
          a decision-intelligence application. It helps teams connect data,
          analyze business performance, create and track decisions, and learn
          from outcomes. By creating an account or using the service, you agree
          to these terms and to use the service lawfully.
        </p>
        <p>
          You must provide accurate account information, protect your sign-in
          credentials, and tell us promptly if you believe an account or
          workspace has been used without permission.
        </p>
      </PolicySection>

      <PolicySection title="2. Workspaces and permissions">
        <p>
          A workspace is an isolated customer environment. The person or
          organization responsible for a workspace controls its members,
          connections, datasets, decisions, alerts, and other configuration.
          Workspace owners are responsible for choosing appropriate members
          and permissions and for ensuring that invited users are authorized.
        </p>
        <p>
          Agency workspaces may manage client workspaces under the product
          rules shown in the application. An agency does not receive automatic
          access to a client workspace&apos;s data merely because it created that
          workspace; client access permissions and application authorization
          checks apply.
        </p>
      </PolicySection>

      <PolicySection title="3. Customer data and connectors">
        <p>
          You retain your rights to data that you upload, connect, or create in
          your workspace. You give Decisionate the limited rights needed to
          host, transform, query, display, analyze, back up, and deliver that
          data as part of the service.
        </p>
        <p>
          You are responsible for having the authority to provide connected
          data and for complying with the terms of the connected provider.
          Connector credentials must use the minimum permissions that support
          the intended import. Do not provide credentials for data you are not
          authorized to access.
        </p>
        <p>
          Connector data is provided to Decisionate for read-only analysis and
          remains subject to the connected provider&apos;s terms. Decisionate is
          not a replacement source-data export service and does not promise a
          raw download of connector rows or connector files. Supported
          Decisionate-generated outputs, including decisions, reports,
          insights, forecasts, recommendations, alerts, and decision history,
          may be exported only by the owner of the active workspace, including
          a client-workspace owner. Members and agency users with managed
          access to a client workspace cannot export these records. Export
          access is enforced by workspace permissions and export activity may
          be recorded.
        </p>
      </PolicySection>

      <PolicySection title="4. AI-assisted features">
        <p>
          Insights, forecasts, recommendations, reports, alerts, and decision
          learning are decision-support features. They can be incomplete,
          inaccurate, delayed, or unsuitable for a particular decision. You
          remain responsible for reviewing source data, assumptions, outputs,
          and consequences before acting.
        </p>
        <p>
          Do not use Decisionate as the sole basis for emergency, medical,
          legal, employment, credit, safety-critical, or otherwise regulated
          decisions unless you have appropriate human review and regulatory
          controls outside the service.
        </p>
      </PolicySection>

      <PolicySection title="5. Acceptable use">
        <p>You may not:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>access another workspace or account without authorization;</li>
          <li>probe, bypass, or interfere with access controls or rate limits;</li>
          <li>upload malware, unlawful content, or data you have no right to use;</li>
          <li>reverse engineer or abuse the service to build a competing service;</li>
          <li>use automated access in a way that materially harms availability; or</li>
          <li>misrepresent AI output as verified fact without appropriate review.</li>
        </ul>
      </PolicySection>

      <PolicySection title="6. Trials, subscriptions, and payment">
        <p>
          Trial and subscription terms, workspace limits, included AI credits,
          and prices are shown at checkout or on the applicable pricing page.
          Subscriptions renew until cancelled. Taxes, payment processing, and
          refunds are handled according to the checkout terms and applicable
          law. Stripe may process payment details on our behalf; Decisionate
          does not ask you to place full card details in a dataset or support
          message.
        </p>
        <p>
          We may restrict features when a subscription expires, payment fails,
          or a workspace exceeds an applicable limit. We will not use a billing
          restriction to grant access to another customer&apos;s workspace.
        </p>
      </PolicySection>

      <PolicySection title="7. Availability and changes">
        <p>
          We work to keep Decisionate available, but the service may be
          interrupted for maintenance, provider failures, connector failures,
          security events, or circumstances outside our control. Connector
          freshness and alert timing depend on the connected provider and
          configured background jobs.
        </p>
        <p>
          We may change or discontinue features. Material changes to these
          terms will be reflected by updating this page or providing notice
          where required.
        </p>
      </PolicySection>

      <PolicySection title="8. Suspension, termination, and deletion">
        <p>
          We may suspend access when reasonably necessary to protect customers,
          investigate abuse, comply with law, or address a security risk. You
          may stop using the service or ask an authorized workspace owner to
          delete a workspace.
        </p>
        <p>
          Workspace deletion removes supported live database records and
          configured dataset or connector objects. Backups, provider retention,
          and object-storage versioning may delay complete removal from backup
          copies. Contact support for a deletion, export, or retention request;
          we will verify authority before acting.
        </p>
        <p>
          When a paid plan or trial expires, analytical dataset storage is
          retained for 89 days after the subscription end date. If a
          subscription is cancelled, the same storage may be permanently
          deleted 90 days after the cancellation date, or at the earlier
          applicable deadline. This includes hot and historical analytical
          files, dataset records, joins, and shares for the expired workspace
          and any client workspaces governed by its agency plan. Renewing after
          deletion does not restore that data.
        </p>
      </PolicySection>

      <PolicySection title="9. Intellectual property and disclaimers">
        <p>
          Decisionate and its software, branding, and documentation remain our
          property or the property of our licensors. Except for the limited
          rights needed to use the service, these terms do not transfer that
          property to you.
        </p>
        <p>
          To the extent permitted by law, the service is provided as available
          without a promise that every result will be complete, accurate,
          uninterrupted, or fit for a particular purpose. AI output is not a
          professional opinion or a guarantee of an outcome.
        </p>
      </PolicySection>

      <PolicySection title="10. Contact">
        <p>
          For questions about these terms, account access, a bug, a security
          issue, or a data request, email{" "}
          <a className="font-semibold text-blue-700 underline" href="mailto:support@decisionate.ca">
            support@decisionate.ca
          </a>
          . Include the workspace name and a short description, but do not send
          passwords, API keys, or full payment-card details.
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
