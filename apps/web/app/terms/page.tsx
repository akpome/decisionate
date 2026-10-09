import Link from "next/link"
import { PolicyPage, PolicySection } from "@/components/landing/policy-page"

export const metadata = {
  title: "Terms of Service",
  description: "Terms for Decisionate workspaces, connectors, trials, optional AI and billing, renewal, and deletion."
}

export default function TermsPage() {
  return (
    <PolicyPage
      eyebrow="Legal"
      title="Terms of Service"
      description="The rules for using Decisionate, including your data, workspace permissions, optional paid services, and retention."
      updated="October 8, 2026"
    >
      <PolicySection title="1. Using Decisionate">
        <p>
          These terms apply to the Decisionate website, web application, and
          related services (&quot;Decisionate&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
          Decisionate helps businesses and agencies connect data, analyze
          performance, record decisions, and review outcomes. By creating an
          account or using the service, you agree to these terms. If you act for
          an organization, you must have authority to do so.
        </p>
        <p>
          Provide accurate account information, protect your sign-in credentials,
          and report suspected unauthorized use. Information handling is described
          in our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </PolicySection>

      <PolicySection title="2. Workspaces and access">
        <p>
          Workspace owners manage membership, roles, connections, data, and
          sharing settings. Members can act only within their permissions.
          Agency and client workspaces remain separate; creating or managing a
          client workspace does not automatically grant access to its private data.
          Owners are responsible for choosing appropriate permissions and removing
          access that is no longer needed.
        </p>
        <p>
          A valid public dashboard share link allows its holder to view the shared
          information without signing in. Only share information you are authorized
          to disclose, protect the link, and revoke it when no longer needed.
          The public live demo uses prepared sample data and does not allow uploads,
          dataset deletion, or creation of decisions.
        </p>
      </PolicySection>

      <PolicySection title="3. Your data and connected providers">
        <p>
          You retain your rights to information you upload, connect, or create.
          You grant Decisionate the limited permission needed to host, process,
          analyze, display, back up, and deliver it as part of the service.
          You must have the authority and any required consent to provide it.
        </p>
        <p>
          Connections require an authorized provider account, suitable permissions,
          and any required provider approvals. Imports are for read-only analysis;
          Decisionate does not use them to change the connected provider&apos;s source
          records. Provider terms, API limits, outages, authorization expiry, and
          configured sync schedules can affect availability and freshness.
          A supported connector does not guarantee approval or access to every account.
        </p>
        <p>
          Use minimum-scope credentials where supported. Removing a connection
          stops future imports through it and removes its stored credentials, but
          does not automatically delete previously imported datasets or source
          records held by the provider. Remove datasets separately when needed.
        </p>
      </PolicySection>

      <PolicySection title="4. Analysis and optional AI">
        <p>
          Dashboards, forecasts, relationships, recommendations, and alerts are
          decision-support tools, not guarantees. Results can be incomplete,
          inaccurate, delayed, or unsuitable for a particular purpose. Associations
          between metrics do not establish causation. Review the source data,
          assumptions, and consequences before acting.
        </p>
        <p>
          AI-assisted analysis is available only when AI services are configured
          and enabled. It may process aggregate facts and relevant, bounded
          decision-learning context through an external provider as explained in
          the Privacy Policy. AI output does not automatically execute business
          actions. Do not include secrets or unnecessary sensitive information.
          Decisionate is not a substitute for professional or regulated advice.
        </p>
      </PolicySection>

      <PolicySection title="5. Trials and optional paid subscriptions">
        <p>
          Decisionate offers a 30-day trial with the workspace limits shown during
          setup. Starting a trial without a payment method does not authorize a
          charge or automatically create a paid subscription. After expiry, a
          workspace may need a paid plan to continue where billing is enabled.
        </p>
        <p>
          Paid subscriptions and AI-credit purchases are available only when
          billing and the relevant services are enabled. Pricing, billing currency,
          interval, limits, taxes, and the amount you authorize are shown in the
          application and checkout. Do not complete checkout if those details
          are incorrect. Stripe processes supported online payments; do not send
          payment-card details to support or store them in a dataset.
        </p>
      </PolicySection>

      <PolicySection title="6. Monthly and annual renewal">
        <p>
          An authorized paid subscription renews automatically each month or year,
          according to the interval selected at checkout, until cancelled.
          Use the subscription management option in Billing to review invoices,
          change payment details, or turn off renewal. If cancellation is scheduled
          for the end of the current paid period, access continues until the
          displayed end date unless another restriction applies.
        </p>
        <p>
          Expired trials, unpaid renewals, and cancelled subscriptions can restrict
          workspace access. Any available payment grace period and restoration
          status are shown in Billing. A checkout redirect is not proof of a
          completed payment; access depends on verified payment and subscription
          status. Renewal does not restore data already deleted under the retention rules.
        </p>
        <p>
          AI credits are service-usage units, not cash or a transferable currency.
          Where purchases are enabled, Billing shows the pack size, price, and
          balance. A credit purchase is separate from a subscription payment and
          does not enable otherwise unavailable services. Contact support about
          billing errors or refund requests; applicable legal rights are not limited
          by these terms.
        </p>
      </PolicySection>

      <PolicySection title="7. Retention, deletion, and exports">
        <p>
          Connector data is kept for three years, then deleted from live analytical
          storage through sync and maintenance processing. The window includes the
          current calendar month and the preceding 35 months. This connector rule
          does not automatically delete manually uploaded datasets, decisions, or
          workspace configuration.
        </p>
        <p>
          After a trial or subscription expires, analytical dataset storage becomes
          eligible for deletion 89 days after the subscription end date. Cancellation
          also sets a deadline of 90 days after the recorded cancellation date;
          the earlier applicable deadline applies. The scheduled lifecycle job
          removes analytical files, dataset records, related analyses, joins, and
          shares, including client workspaces governed by an expired agency plan.
          Connection settings and credentials are not removed by this analytical
          purge; delete the connection separately. Deleted data cannot be recovered
          simply by renewing.
        </p>
        <p>
          Authorized workspace deletion removes supported live records and files.
          Backups, replicas, provider source records, and records required for legal
          or service purposes can have different retention periods. Available
          exports follow workspace permissions; supported decision exports are
          restricted to workspace owners. Decisionate does not offer raw connector
          rows or files as a separate source-data download service. These product
          limits do not restrict individual privacy rights described in the Privacy Policy.
        </p>
      </PolicySection>

      <PolicySection title="8. Acceptable use and service availability">
        <p>
          Do not access information without permission, bypass access controls,
          upload unlawful or malicious content, misuse credentials, or interfere
          with availability or rate limits. We may restrict access to investigate
          misuse, protect users, comply with law, or address a security risk.
        </p>
        <p>
          Maintenance, provider failures, and background processing can interrupt
          service or delay imports and alerts. No uninterrupted availability or
          guaranteed analytical outcome is promised. We may change features or
          these terms, updating this page and providing notice where required.
          You may stop using the service and request authorized deletion.
        </p>
      </PolicySection>

      <PolicySection title="9. Intellectual property and limitations">
        <p>
          Decisionate&apos;s software, branding, and documentation remain ours or
          our licensors&apos;, apart from your rights in your own data. These terms
          grant only the rights needed to use the service. To the extent permitted
          by law, the service is provided as available, without a guarantee that
          every result will be complete, accurate, or suitable for your purpose.
          Nothing here excludes rights or obligations that cannot lawfully be excluded.
        </p>
      </PolicySection>

      <PolicySection title="10. Contact">
        <p>
          For account, billing, legal, or data questions, email
          {" "}<a href="mailto:support@decisionate.ca">support@decisionate.ca</a>.
          Include the workspace and a short description, not passwords, API keys,
          access tokens, or full payment-card details.
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
