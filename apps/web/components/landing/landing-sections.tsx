"use client"

import Link from "next/link"
import {
  ArrowRight,
  BarChart3,
  Check,
  Database,
  Plus,
  Target,
  Users
} from "lucide-react"
import { useState } from "react"
import { useLandingText } from "@/app/use-decisionate-language"
import { dashboardDefinitions } from "@/features/dashboards/dashboard-definitions"
import { faqs, integrationGroups } from "./landing-content"

export function FeaturesSection() {
  const { t } = useLandingText()
  const features = [
    {
      icon: Database,
      title: "One place for the numbers",
      description:
        "Sync your business systems or upload a file. Keep datasets, dates and metrics together instead of rebuilding a report every week."
    },
    {
      icon: BarChart3,
      title: "A view you can question",
      description:
        "Compare metrics, change the period, group the data and switch between actual and indexed values. Follow the evidence before choosing an action."
    },
    {
      icon: Target,
      title: "A decision you can follow up",
      description:
        "Link the action to its dataset. Record the expected result, set a review date, and capture the outcome and lesson."
    }
  ]
  return (
    <section className="landing-section border-y border-neutral-200 bg-neutral-50">
      <div className="landing-container">
        <h2 className="landing-heading max-w-2xl">
          {t("Keep the evidence close to the action.")}
        </h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {features.map((item) => (
            <div key={item.title} className="border-t border-neutral-300 pt-5">
              <item.icon
                size={22}
                className="landing-brand-text"
                aria-hidden="true"
              />
              <h3 className="mt-5 text-lg font-semibold">{t(item.title)}</h3>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                {t(item.description)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function IndustryDashboardsSection() {
  const { t } = useLandingText()
  const [audience, setAudience] = useState<"business" | "agency">("business")
  return (
    <section id="industries" className="landing-section bg-white">
      <div className="landing-container grid gap-10 lg:grid-cols-2">
        <div>
          <p className="landing-eyebrow">{t("Your workspace, your context")}</p>
          <h2 className="landing-heading mt-3">
            {t("Built around the work you do.")}
          </h2>
          <div
            role="group"
            aria-label={t("Workspace type")}
            className="mt-7 inline-flex max-w-full gap-1 rounded-md border border-neutral-200 p-1"
          >
            {(["business", "agency"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={audience === option}
                onClick={() => setAudience(option)}
                className={`rounded px-3 py-2 text-sm font-medium ${audience === option ? "landing-brand-selected" : "text-neutral-600 hover:bg-neutral-100"}`}
              >
                {t(
                  option === "business"
                    ? "For your business"
                    : "For your agency"
                )}
              </button>
            ))}
          </div>
          <p className="mt-5 max-w-lg text-base leading-7 text-neutral-600">
            {t(
              audience === "business"
                ? "Bring your team into one workspace, choose the dashboards that fit your business, and keep important decisions visible."
                : "Manage your agency and client workspaces separately. Give clients their own view, with your branding and role-based access."
            )}
          </p>
          <Link
            href="/sign-up"
            className="landing-brand-link mt-5 inline-flex items-center gap-2 text-sm font-semibold"
          >
            {t("Start trial")}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div>
          <p className="mb-4 text-xs font-semibold text-neutral-500">
            {t("Explore a dashboard")}
          </p>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {dashboardDefinitions
              .filter((item) => item.key !== "decision-performance")
              .map((item) => (
                <Link
                  key={item.key}
                  href={`/demo?dashboard=${item.key}`}
                  className="group flex min-w-0 items-start justify-between gap-2 border-t border-neutral-200 py-3 text-sm leading-5 text-neutral-700 hover:text-blue-700"
                >
                  <span>{t(item.name.replace(" Performance", ""))}</span>
                  <ArrowRight
                    size={14}
                    className="mt-0.5 shrink-0 text-neutral-400 group-hover:text-blue-700"
                    aria-hidden="true"
                  />
                </Link>
              ))}
          </div>
        </div>
      </div>
    </section>
  )
}

const integrationIcons = [
  BarChart3,
  Database,
  Database,
  Users,
  Database,
  Database
]

export function IntegrationsSection() {
  const { t } = useLandingText()
  return (
    <section
      id="integrations"
      className="landing-section border-y border-neutral-200 bg-neutral-50"
    >
      <div className="landing-container">
        <p className="landing-eyebrow">{t("Connections")}</p>
        <h2 className="landing-heading mt-3">
          {t("Work with the systems you already use.")}
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-neutral-600">
          {t(
            "Accounting, commerce, marketing and CRM data, alongside databases and files. Choose the source that fits the question."
          )}
        </p>
        <div className="mt-9 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {integrationGroups.map((group, index) => {
            const Icon = integrationIcons[index]
            return (
              <div
                key={group.name}
                className="border-t border-neutral-300 pt-4"
              >
                <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-950">
                  <Icon
                    size={16}
                    className="landing-brand-text"
                    aria-hidden="true"
                  />
                  {t(group.name)}
                </h3>
                <ul className="mt-4 space-y-3">
                  {group.items.map((item) => (
                    <li
                      key={item.type}
                      data-connector={item.type}
                      className="text-sm text-neutral-600"
                    >
                      {item.name}
                      {"note" in item && (
                        <span className="mt-1 block text-xs text-amber-800">
                          {t(item.note)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {group.name === "Files" && (
                  <p className="mt-4 text-xs leading-6 text-neutral-500">
                    {t(
                      "Import signed file links from Google Drive or OneDrive."
                    )}
                  </p>
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-8 border-t border-neutral-200 pt-5 text-xs leading-6 text-neutral-500">
          {t(
            "Provider authorization and any required approvals apply. Connector data is kept for three years, then deleted."
          )}
        </p>
      </div>
    </section>
  )
}

export function PricingSection() {
  const { t } = useLandingText()
  const [annual, setAnnual] = useState(false)
  const plans = [
    {
      name: "Professional",
      description: "For a business managing its own workspace.",
      monthly: 79,
      yearly: 790,
      items: [
        "1 business workspace",
        "Unlimited datasets",
        "All industry dashboards",
        "Decision management and outcome tracking",
        "5,000 AI credits/month or 60,000/year"
      ]
    },
    {
      name: "Agency",
      description: "For an agency working across client businesses.",
      monthly: 199,
      yearly: 1990,
      items: [
        "Agency workspace and 10 client workspaces",
        "Separate client access",
        "Agency branding and client portal",
        "All Professional features",
        "25,000 AI credits/month or 300,000/year"
      ]
    }
  ]
  return (
    <section id="pricing" className="landing-section bg-white">
      <div className="landing-container">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="landing-eyebrow">{t("Pricing")}</p>
            <h2 className="landing-heading mt-3">
              {t("Start with 30 days to make it yours.")}
            </h2>
            <p className="mt-4 text-sm text-neutral-600">
              {t(
                "No credit card required. Choose your plan during workspace setup."
              )}
            </p>
          </div>
          <div
            role="group"
            aria-label={t("Billing frequency")}
            className="inline-flex w-fit max-w-full gap-1 rounded-md border border-neutral-200 p-1"
          >
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={annual === value}
                onClick={() => setAnnual(value)}
                className={`rounded px-4 py-2 text-sm font-medium ${annual === value ? "landing-brand-selected" : "text-neutral-600"}`}
              >
                {t(value ? "Annual" : "Monthly")}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-9 grid gap-5 md:grid-cols-2">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className="flex min-w-0 flex-col rounded-lg border border-neutral-200 p-6 sm:p-8"
            >
              <h3 className="text-xl font-semibold">{t(plan.name)}</h3>
              <p className="mt-3 text-sm leading-6 text-neutral-600">
                {t(plan.description)}
              </p>
              <div className="mt-6 flex flex-wrap items-baseline gap-2">
                <span className="text-4xl font-semibold tabular-nums">
                  $
                  {(annual ? plan.yearly : plan.monthly).toLocaleString(
                    "en-CA"
                  )}
                </span>
                <span className="text-sm text-neutral-500">
                  {t(annual ? "CAD / year" : "CAD / month")}
                </span>
              </div>
              <p className="landing-brand-text mt-2 min-h-5 text-xs">
                {annual
                  ? t("Two months less than monthly billing.")
                  : t("Billed monthly.")}
              </p>
              <ul className="my-7 space-y-3">
                {plan.items.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 text-sm leading-6 text-neutral-700"
                  >
                    <Check
                      size={16}
                      className="landing-brand-text mt-1 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{t(item)}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/sign-up"
                className="landing-button landing-button-primary mt-auto w-fit"
              >
                {t("Start trial")}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
        <div className="mt-6 grid gap-4 border-t border-neutral-200 pt-5 text-xs leading-6 text-neutral-500 sm:grid-cols-2">
          <p>
            {t(
              "Additional client workspaces: $20 CAD/month or $200 CAD/year each, including 2,500 AI credits/month or 30,000/year."
            )}
          </p>
          <p>
            {t(
              "Subscriptions are billed monthly or annually. Purchase additional AI credits from Billing."
            )}
          </p>
        </div>
      </div>
    </section>
  )
}

export function FAQSection() {
  const { t } = useLandingText()
  return (
    <section
      id="questions"
      className="landing-section border-t border-neutral-200 bg-neutral-50"
    >
      <div className="landing-container grid gap-8 lg:grid-cols-[1fr_2fr]">
        <div>
          <h2 className="landing-heading">{t("A few practical questions.")}</h2>
          <a
            href="mailto:support@decisionate.ca"
            className="landing-brand-link mt-4 inline-block text-sm"
          >
            support@decisionate.ca
          </a>
        </div>
        <div className="divide-y divide-neutral-200 border-t border-neutral-200">
          {faqs.map((faq) => (
            <details key={faq.question} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-5 text-base font-medium marker:hidden">
                {t(faq.question)}
                <Plus
                  size={18}
                  className="mt-1 shrink-0 text-neutral-500 group-open:rotate-45"
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                {t(faq.answer)}
                {"link" in faq && (
                  <>
                    {" "}
                    <Link
                      href={faq.link.href}
                      className="landing-brand-link font-medium underline underline-offset-4"
                    >
                      {t(faq.link.label)}
                    </Link>
                    .
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

export function FinalCTASection() {
  const { t } = useLandingText()
  return (
    <section className="landing-brand-strip py-12 text-white sm:py-16">
      <div className="landing-container flex flex-col justify-between gap-7 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-semibold sm:text-3xl">
            {t("Bring your next decision into focus.")}
          </h2>
          <p className="landing-brand-strip-copy mt-3 text-sm leading-6">
            {t("Start with a file or connection. Build from there.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/sign-up"
            className="landing-button border border-white bg-white text-neutral-950 hover:bg-neutral-100"
          >
            {t("Start trial")}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link
            href="/sign-in"
            className="text-sm font-medium text-white underline underline-offset-4"
          >
            {t("Sign in")}
          </Link>
        </div>
      </div>
    </section>
  )
}
