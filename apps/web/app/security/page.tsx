import Link from "next/link"
import { PolicyPage, PolicySection } from "@/components/landing/policy-page"

export const metadata = {
  title: "Security",
  description: "Decisionate's implemented access controls, credential protection, production safeguards, retention, and security reporting."
}

export default function SecurityPage() {
  return (
    <PolicyPage
      eyebrow="Trust"
      title="Security"
      description="The application controls in place today, their limits, and how to report a concern."
      updated="October 8, 2026"
    >
      <PolicySection title="1. Accounts and authentication">
        <p>
          The web application uses Clerk for account authentication and session
          management. Decisionate does not store your sign-in password. Protected
          API requests verify authentication tokens and resolve the signed-in
          identity before checking workspace access. Browser controls are not the
          sole authorization boundary.
        </p>
        <p>
          Protect your account, use the security options available from your
          identity provider, and sign out on shared devices. Report suspected
          account misuse to support promptly.
        </p>
      </PolicySection>

      <PolicySection title="2. Workspace isolation and permissions">
        <p>
          Private datasets, connections, decisions, analysis, preferences, and
          related records are checked against the active workspace and the user&apos;s
          membership and role. A workspace ID supplied by a browser is not permission
          to access that workspace. Agency-managed client workspaces have separate
          access checks, and platform administration requires a separate role.
        </p>
        <p>
          Owners control member access and sharing. An intentionally enabled public
          dashboard link is an exception to private sign-in: anyone with a valid
          link can view its shared information. Revoke links that are no longer
          needed. The public live demo and recorded walkthrough contain prepared
          sample data, not customer workspace records.
        </p>
      </PolicySection>

      <PolicySection title="3. Connector credentials and imports">
        <p>
          In production mode, stored OAuth access and refresh tokens use
          application-level Fernet encryption. Sensitive connector configuration and platform email secrets
          use the supported secret-protection paths. Usable credentials are excluded
          from normal connection responses. Production mode requires a valid
          secret-encryption key and fails startup when required protection is missing.
        </p>
        <p>
          Use minimum-scope provider permissions and read-only database accounts
          where supported. Database imports validate read queries; that validation
          does not replace a properly restricted database account. Connector imports
          are analytical inputs, not authorization to edit provider source records.
          Removing a connection removes its stored credentials but does not delete
          datasets already imported through it.
        </p>
      </PolicySection>

      <PolicySection title="4. Production safeguards and storage">
        <p>
          In production mode, the API validates required token-verification settings,
          encryption-key configuration, HTTPS application and API URLs, explicit
          allowed web origins, PostgreSQL, remote S3-compatible object storage,
          and error-monitoring configuration. It refuses to start if those checks
          fail. Development configurations are not production guarantees.
        </p>
        <p>
          Dataset files use configured object storage and database records use
          the configured database. Provider access controls, encryption of database
          volumes or backups, region selection, and backup recovery depend on the
          deployment and provider settings. We do not claim end-to-end encryption
          of analytical data or immediate erasure from every backup.
        </p>
      </PolicySection>

      <PolicySection title="5. Optional AI and payments">
        <p>
          AI services run only when configured and enabled. Analysis sends bounded
          aggregate facts, selected context, and relevant user-authored decision
          learning to the configured provider. Such text can contain personal
          information, so avoid secrets and unnecessary sensitive details.
          Outputs require human review and do not automatically execute business actions.
        </p>
        <p>
          Payments and credit purchases are optional enabled services. Stripe
          handles supported checkout and payment-card information; full card numbers
          are not stored in Decisionate. Payment and subscription updates use
          verified provider events rather than trusting a browser success message.
        </p>
      </PolicySection>

      <PolicySection title="6. Monitoring and verification">
        <p>
          The application includes request-size controls, rate limiting, background
          ingestion jobs, operational checks, and workspace activity records for
          supported actions. API error monitoring disables default personal-information
          collection, local-variable capture, and request-body capture. Error context
          and operational metadata may still be processed for diagnosis.
        </p>
        <p>
          Automated tests cover authentication, workspace permissions, credential
          protection, retention, and production configuration. These checks are
          not a security certification, an independent penetration-test report, or
          a guarantee that no vulnerability exists. Security also depends on
          deployment settings, provider access, and ongoing operational review.
        </p>
      </PolicySection>

      <PolicySection title="7. Retention and deletion">
        <p>
          Connector data is kept for three years, then deleted. The current month
          and preceding 35 months form the live retention window, enforced during
          sync and scheduled maintenance. This rule does not automatically delete
          manually uploaded datasets, decisions, or account settings.
        </p>
        <p>
          After trial or subscription expiry, analytical dataset storage becomes
          eligible for deletion 89 days after the subscription end date, or 90 days
          after a recorded cancellation, whichever applicable deadline is earlier.
          Scheduled lifecycle processing removes dataset files and associated
          records, analyses, joins, and shares, including governed agency client
          workspaces. Connection settings and credentials are not removed by that
          analytical purge. Renewal does not restore deleted data.
        </p>
        <p>
          Authorized workspace deletion removes supported live workspace records
          and files. Backups, replicas, provider source records, and records needed
          for legal or service purposes can have different retention cycles.
          Details are in the <Link href="/privacy">Privacy Policy</Link> and
          {" "}<Link href="/terms">Terms of Service</Link>.
        </p>
      </PolicySection>

      <PolicySection title="8. Exports and privacy requests">
        <p>
          Available product exports follow workspace permissions; supported decision
          exports are restricted to workspace owners. Raw connector rows and files
          are not offered as a separate source-data download service. Product
          permissions do not limit an individual&apos;s applicable right to access,
          correct, or request deletion of their personal information.
        </p>
        <p>
          Contact support for a privacy request or for deployment-specific provider,
          location, or security information. We verify identity and authority before
          releasing or deleting information and protect other people&apos;s data.
        </p>
      </PolicySection>

      <PolicySection title="9. Reporting a security concern">
        <p>
          Email <a href="mailto:support@decisionate.ca?subject=Decisionate%20security%20concern">support@decisionate.ca</a>
          {" "}with the affected feature, approximate time, and a description of the
          issue. Include only the minimum evidence needed; do not send passwords,
          access tokens, full payment-card details, or unnecessary customer records.
          Do not access other users&apos; data or disrupt the service while investigating.
        </p>
        <p>
          We review reported concerns and communicate about relevant remediation
          and privacy obligations. This page does not promise a fixed incident
          response time or an uptime service-level agreement.
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
