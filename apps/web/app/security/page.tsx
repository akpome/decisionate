import Image from "next/image"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  Database,
  Download,
  Eye,
  FileKey2,
  HardDrive,
  KeyRound,
  LockKeyhole,
  Mail,
  ServerCog,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UsersRound,
  XCircle,
} from "lucide-react"

import { LandingFooter } from "@/components/landing/footer"

export const metadata = {
  title: "Security",
  description:
    "How Decisionate currently handles authentication, workspace isolation, data, connectors, AI processing, deletion, and security requests.",
}

type SecurityCard = {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}

const contents = [
  ["Authentication", "authentication"],
  ["Workspace isolation", "workspace-isolation"],
  ["Data protection", "data-protection"],
  ["AI processing", "ai-processing"],
  ["Operations", "operations"],
  ["Your requests", "your-requests"],
] as const

const securityCards: SecurityCard[] = [
  {
    icon: LockKeyhole,
    title: "Authentication",
    children: (
      <>
        <p>
          The current web application uses Clerk for sign-in, sign-up, and
          browser session management. The web middleware protects the
          dashboard and onboarding routes. Protected API routes require an
          authorization token when the API is configured with its JWKS
          settings.
        </p>
        <p>
          The API resolves the authenticated external identity to an internal
          Decisionate user ID before it resolves workspace access. Decisionate
          does not receive or store a customer password. The current deployment
          still depends on Clerk as its authentication provider; this page does
          not claim that the product is already provider-independent.
        </p>
      </>
    ),
  },
  {
    icon: UserRoundCheck,
    title: "Authorization",
    children: (
      <>
        <p>
          Authentication answers who is signed in. Authorization answers what
          that person can access. The API builds an authentication context with
          the internal user ID, workspace ID, workspace role, and external
          identity. Workspace membership and role checks happen on the API,
          not only in the browser interface.
        </p>
        <p>
          Workspace owners manage configuration and data connections. Member
          access is restricted according to the workspace role. Agency-managed
          client access is an explicit, separately checked path; an agency
          owner does not automatically receive access to a client workspace’s
          data. Platform administration is protected by a separate platform
          admin role.
        </p>
      </>
    ),
  },
  {
    icon: Database,
    title: "Workspace isolation",
    children: (
      <>
        <p>
          Workspace isolation is a core application boundary. Datasets,
          source connections, OAuth credentials, subscriptions, AI usage,
          usage activity, decisions, decision activity, preferences, reports,
          and related analysis records carry workspace ownership where the
          record type requires it.
        </p>
        <p>
          API queries derive the active workspace from the verified
          authentication context and apply workspace filters before returning
          records. Alert configuration, dataset relationships, joined-data
          caches, and decision-learning context are also scoped to the active
          workspace. A workspace ID supplied by a browser is not treated as
          sufficient proof of access.
        </p>
        <p>
          This is an application control, not a certification. We are still
          building the formal security review, automated authorization tests,
          and independent penetration testing that would provide additional
          assurance.
        </p>
      </>
    ),
  },
  {
    icon: FileKey2,
    title: "Connector credentials",
    children: (
      <>
        <p>
          OAuth access and refresh tokens are encrypted with Fernet before
          they are stored when <code>OAUTH_TOKEN_ENCRYPTION_KEY</code> is
          configured. The API decrypts them only when it needs to call the
          connected provider. If the encryption key is absent or invalid, OAuth
          token storage is rejected rather than silently storing a usable token.
        </p>
        <p>
          Provider client IDs, client secrets, API keys, database connection
          URLs, OpenAI credentials, and email credentials are supplied through
          server configuration or platform settings. They are never intended
          to be sent to the browser as usable secrets. Production operators
          must protect environment variables and verify secret handling for
          every configured provider.
        </p>
      </>
    ),
  },
  {
    icon: HardDrive,
    title: "Hosting, databases, and files",
    children: (
      <>
        <p>
          The API uses SQLAlchemy and can run with SQLite for development or a
          PostgreSQL-compatible <code>DATABASE_URL</code> for deployment. Data
          files use the application’s storage abstraction and can be stored on
          the local filesystem or an S3-compatible provider such as Cloudflare
          R2 or Amazon S3. Decisionate does not claim that a particular hosting
          provider is automatically selected or secured by the application.
        </p>
        <p>
          Uploaded and connector data is stored as Parquet where the current
          ingestion path supports it. Connector sync output uses monthly hot
          partitions and yearly historical summary partitions. Storage
          provider access keys belong on the API server and should be managed
          with the provider’s secret-management facilities.
        </p>
        <p>
          Production traffic should be served over HTTPS at the deployment
          edge. Local development uses local configuration and may use HTTP;
          local development behavior is not a production security guarantee.
        </p>
      </>
    ),
  },
  {
    icon: BrainCircuit,
    title: "AI processing",
    children: (
      <>
        <p>
          OpenAI processing occurs only when the AI provider is configured with
          an API key. Decisionate prepares bounded aggregate facts and bounded
          user-authored learning context for analysis. The model is instructed
          to treat supplied values as untrusted data, avoid inventing facts,
          and return structured analysis.
        </p>
        <p>
          Decisionate’s AI request includes the selected analysis context and
          facts needed for that analysis. Historical decision outcomes and
          lessons can be included for the same workspace so recommendations can
          learn from prior evidence. Workspace IDs are included in internal
          cache keys and credit accounting; a workspace’s learning context is
          not intentionally used for another workspace.
        </p>
        <p>
          Customers should avoid putting secrets, passwords, or unnecessary
          personal information into decision notes and source data. AI output
          is advisory and requires human review. Decisionate does not claim
          that AI outputs are error-free or that customer data is excluded from
          the configured AI provider’s processing environment.
        </p>
      </>
    ),
  },
]

function SecurityCard({ icon: Icon, title, children }: SecurityCard) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Icon size={19} aria-hidden="true" />
        </span>
        <h3 className="text-lg font-bold text-slate-950">{title}</h3>
      </div>
      <div className="mt-5 space-y-4 text-sm leading-7 text-slate-600">
        {children}
      </div>
    </article>
  )
}

function StatusItem({
  confirmed,
  children,
}: {
  confirmed: boolean
  children: React.ReactNode
}) {
  const Icon = confirmed ? CheckCircle2 : XCircle

  return (
    <li className="flex items-start gap-3 text-sm leading-6 text-slate-700">
      <Icon
        size={18}
        className={confirmed ? "mt-0.5 shrink-0 text-emerald-600" : "mt-0.5 shrink-0 text-slate-400"}
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  )
}

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Decisionate home">
            <Image
              src="/icons/decisionate-icon.svg"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <span className="flex flex-col leading-none">
              <span className="text-[17px] font-bold tracking-tight">Decisionate</span>
              <span className="mt-1 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Decisions from data
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <Link href="/" className="hidden px-2 py-2 text-sm font-semibold text-slate-600 hover:text-slate-950 sm:inline-flex">
              Home
            </Link>
            <Link href="/sign-in" className="px-2 py-2 text-sm font-semibold text-slate-700 hover:text-slate-950">
              Sign In
            </Link>
            <Link href="/sign-up" className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-slate-200 bg-slate-950 text-white">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
                <ShieldCheck size={15} aria-hidden="true" />
                Security at Decisionate
              </div>
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
                Clear controls. Clear limits. No invented assurances.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                This page explains how the current Decisionate application
                handles authentication, workspace isolation, data, connectors,
                AI processing, operations, deletion, and security requests.
                It describes the product as it exists today, not a future
                certification or a promise about controls that have not been
                verified.
              </p>
              <p className="mt-7 text-sm font-semibold text-cyan-200">
                Last reviewed: August 12, 2026
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[1fr_1.4fr] lg:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
                Current security posture
              </p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
                What customers can rely on today
              </h2>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-950">
              <div className="flex items-start gap-3">
                <AlertTriangle size={19} className="mt-1 shrink-0 text-amber-700" aria-hidden="true" />
                <div>
                  <p className="font-bold">Decisionate is not claiming SOC 2 or ISO certification.</p>
                  <p className="mt-1">
                    The product is being prepared for controlled customer use.
                    Formal certification, independent penetration testing,
                    documented employee access reviews, a production backup
                    program, and a contractual incident-response SLA are not
                    claimed by this page.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[220px_1fr] lg:py-20">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              On this page
            </p>
            <nav className="mt-4 grid gap-2 text-sm" aria-label="Security page sections">
              {contents.map(([label, id]) => (
                <a key={id} href={`#${id}`} className="rounded-lg px-3 py-2 font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-950">
                  {label}
                </a>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 space-y-16">
            <section id="authentication" className="scroll-mt-24">
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">01 / Identity</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Authentication and sessions</h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Sign-in is handled by the configured authentication provider;
                  the current deployment uses Clerk. The browser and API have
                  separate responsibilities, and the API does not trust a
                  workspace selector or user header by itself.
                </p>
              </div>
              <div className="mt-8 grid gap-5 md:grid-cols-2">
                {securityCards.slice(0, 2).map(card => <SecurityCard key={card.title} {...card} />)}
              </div>
            </section>

            <section id="workspace-isolation" className="scroll-mt-24">
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">02 / Authorization</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Workspace isolation is the primary boundary</h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Decisionate is a multi-tenant application. A customer’s
                  workspace is the boundary around its data, decisions,
                  relationships, alerts, and learning context.
                </p>
              </div>
              <div className="mt-8">
                <SecurityCard {...securityCards[2]} />
              </div>
              <div className="mt-5 grid gap-5 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <UsersRound className="text-blue-700" size={20} aria-hidden="true" />
                  <h3 className="mt-4 font-bold text-slate-950">Role checks</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Owners, members, client users, and managed agency access are resolved by the API.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <Eye className="text-blue-700" size={20} aria-hidden="true" />
                  <h3 className="mt-4 font-bold text-slate-950">Scoped analysis</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">AI context, relationships, joined data, and alerts are built for the active workspace.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <ServerCog className="text-blue-700" size={20} aria-hidden="true" />
                  <h3 className="mt-4 font-bold text-slate-950">Server enforcement</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">The API applies authorization before protected records are returned or changed.</p>
                </div>
              </div>
            </section>

            <section id="data-protection" className="scroll-mt-24">
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">03 / Data</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Encryption, storage, and credentials</h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Protection depends on both application controls and the
                  infrastructure configuration selected for deployment. The
                  following statements distinguish those two layers.
                </p>
              </div>
              <div className="mt-8 grid gap-5 md:grid-cols-2">
                {securityCards.slice(3, 5).map(card => <SecurityCard key={card.title} {...card} />)}
              </div>
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-950 p-6 text-sm leading-7 text-slate-300">
                <div className="flex items-start gap-3">
                  <KeyRound size={19} className="mt-1 shrink-0 text-cyan-300" aria-hidden="true" />
                  <div>
                    <p className="font-bold text-white">Production configuration matters</p>
                    <p className="mt-1">
                      A secure deployment must configure HTTPS, protected
                      database and object-storage credentials, a strong OAuth
                      token encryption key, restricted server access, and
                      provider backups. The source code provides configuration
                      points; it cannot make an unsafe deployment safe by
                      itself.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section id="ai-processing" className="scroll-mt-24">
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">04 / AI</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">AI processing and decision learning</h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Decisionate is a decision-intelligence product, so AI
                  processing is part of the security boundary rather than an
                  unrelated add-on.
                </p>
              </div>
              <div className="mt-8">
                <SecurityCard {...securityCards[5]} />
              </div>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">What is sent</p>
                  <ul className="mt-4 space-y-3">
                    <StatusItem confirmed>Bounded aggregate facts for the selected analysis.</StatusItem>
                    <StatusItem confirmed>Relevant, bounded decision outcomes and lessons from the same workspace.</StatusItem>
                    <StatusItem confirmed>Analysis context required to produce a summary, recommendation, risk, or confidence value.</StatusItem>
                  </ul>
                </div>
                <div className="rounded-xl border border-slate-200 p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">What is not promised</p>
                  <ul className="mt-4 space-y-3">
                    <StatusItem confirmed={false}>AI output is not guaranteed to be accurate, complete, or suitable without review.</StatusItem>
                    <StatusItem confirmed={false}>Decisionate does not claim that customer data never leaves the configured AI provider.</StatusItem>
                    <StatusItem confirmed={false}>Customers should not submit passwords, secrets, or unnecessary personal data as analysis notes.</StatusItem>
                  </ul>
                </div>
              </div>
            </section>

            <section id="operations" className="scroll-mt-24">
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">05 / Operations</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Backups, access, subprocessors, and incidents</h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  These operational controls require honest separation between
                  what the application implements and what the production
                  operator must configure and continuously verify.
                </p>
              </div>
              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3"><Database size={20} className="text-blue-700" aria-hidden="true" /><h3 className="font-bold text-slate-950">Backups and recovery</h3></div>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    The application supports configurable database and object
                    storage providers, but it does not itself provide a
                    managed backup service or prove that a restore has been
                    tested. Before production use, the operator must enable
                    database backups, object-storage versioning or backups as
                    appropriate, retention, access controls, and restore tests.
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3"><ServerCog size={20} className="text-blue-700" aria-hidden="true" /><h3 className="font-bold text-slate-950">Operational access</h3></div>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    A separate platform-admin role exists for product
                    operations, usage review, email settings, credit settings,
                    audit events, and controlled workspace or user operations.
                    No public employee access policy or completed access-review
                    program is claimed yet. Production access should be limited
                    to named operators, logged, reviewed, and removed when no
                    longer needed.
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3"><Mail size={20} className="text-blue-700" aria-hidden="true" /><h3 className="font-bold text-slate-950">Subprocessors</h3></div>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    The application can use Clerk for authentication, OpenAI
                    for configured AI analysis, Stripe for billing, Resend or
                    SMTP for email, and an S3-compatible provider for files.
                    Actual use depends on deployment configuration. This is not
                    a complete contractual subprocessor list; customers should
                    request the current deployment-specific list before
                    onboarding regulated or sensitive data.
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3"><AlertTriangle size={20} className="text-blue-700" aria-hidden="true" /><h3 className="font-bold text-slate-950">Incident reporting</h3></div>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    Report suspected unauthorized access, workspace isolation
                    issues, exposed credentials, or data loss to
                    <a className="font-semibold text-blue-700 hover:text-blue-800" href="mailto:support@decisionate.ca?subject=Decisionate%20security%20incident"> support@decisionate.ca</a>
                    with “Security incident” in the subject. Include the
                    affected workspace, approximate time, route or connector,
                    and evidence that is safe to share. Do not email passwords,
                    API keys, OAuth tokens, or full customer exports.
                  </p>
                </article>
              </div>
            </section>

            <section id="your-requests" className="scroll-mt-24">
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">06 / Customer control</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Deletion and export requests</h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Customers can request help with their data, but the current
                  product should not be described as having a complete
                  self-service portability workflow.
                </p>
              </div>
              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <Trash2 size={20} className="text-blue-700" aria-hidden="true" />
                  <h3 className="mt-4 font-bold text-slate-950">Deletion</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    Workspace owners and authorized platform administrators can
                    delete supported workspace records through the application.
                    Dataset and connector file cleanup is handled through the
                    configured storage abstraction. Because backups, provider
                    retention, and object versioning depend on deployment, a
                    deletion request is not currently a promise of immediate
                    erasure from every backup or provider replica. After a plan
                    expires, the live analytical dataset storage is retained
                    for 89 days after plan expiry, or 90 days after
                    cancellation, whichever comes first, and then removed by
                    the billing lifecycle job. This includes agency client
                    workspaces governed by the expired agency plan.
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <Download size={20} className="text-blue-700" aria-hidden="true" />
                  <h3 className="mt-4 font-bold text-slate-950">Export</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    A general customer-facing export package is not currently
                    claimed as a completed feature. To request an export,
                    contact support with the workspace name, requested tables
                    or files, date range, and destination instructions. Support
                    will confirm what can be exported from the current
                    deployment before any data is transferred.
                  </p>
                </article>
              </div>
              <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-6">
                <div className="flex items-start gap-3">
                  <CircleHelp size={20} className="mt-1 shrink-0 text-blue-700" aria-hidden="true" />
                  <div className="text-sm leading-7 text-blue-950">
                    <p className="font-bold">Request deletion, export, or a security review</p>
                    <p className="mt-1">
                      Email <a className="font-semibold underline" href="mailto:support@decisionate.ca">support@decisionate.ca</a>.
                      Include only the minimum information needed to identify
                      the request. We will confirm the requester’s authority
                      before releasing or deleting workspace data.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="border-t border-slate-200 pt-10">
              <div className="flex items-start gap-3">
                <ShieldCheck size={22} className="mt-1 shrink-0 text-blue-700" aria-hidden="true" />
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-950">Security is a continuing release requirement</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                    Before broad launch, Decisionate still needs a production
                    backup and restore runbook, a deployment-specific
                    subprocessor register, formal access reviews, automated
                    cross-workspace authorization tests, incident procedures,
                    and an independent security assessment. This page will be
                    updated when those controls are implemented and verified.
                  </p>
                  <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-800">
                    Return to Decisionate
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  )
}
