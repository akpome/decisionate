import Link from "next/link"
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Check,
  Database,
  Gauge,
  Layers3,
  LineChart,
  LockKeyhole,
  PlugZap,
  Scale,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react"

import {
  benefits,
  faqs,
  featureCards,
  industryDashboards,
  integrations,
  workflowSteps,
} from "@/components/landing/landing-content"

function SectionIntro({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow: string
  title: string
  description: string
  align?: "center" | "left"
}) {
  return (
    <div className={`${align === "center" ? "mx-auto text-center" : ""} max-w-2xl`}>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-base leading-7 text-slate-600">
        {description}
      </p>
    </div>
  )
}

export function TrustedBySection() {
  return (
    <section className="border-b border-slate-200 bg-white py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 sm:px-8 md:flex-row md:items-center md:justify-between">
        <p className="text-sm font-semibold text-slate-500">
          Built for growing businesses, agencies and agency client teams
        </p>
        <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
          {[
            "Owner-led teams",
            "Agency workspaces",
            "Client portals",
            "Evidence-led decisions",
          ].map(item => (
            <span key={item} className="border-l border-slate-300 pl-3 first:border-l-0 first:pl-0">
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

export function ProductWorkflowSection() {
  return (
    <section id="product" className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionIntro
          eyebrow="The product workflow"
          title="The path from business data to better judgment"
          description="Decisionate follows the same order your team does: understand the situation, choose an action, see what happened and carry the lesson forward."
        />

        <div className="relative mt-14 grid gap-8 md:grid-cols-3 lg:grid-cols-6">
          <div className="absolute left-[8%] right-[8%] top-6 hidden h-px bg-slate-200 lg:block" aria-hidden="true" />
          {workflowSteps.map(step => (
            <div key={step.number} className="relative text-center">
              <div className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full border-4 border-white bg-slate-950 text-xs font-bold text-white shadow-sm">
                {step.number}
              </div>
              <h3 className="mt-4 text-sm font-bold text-slate-950">{step.label}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{step.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-center lg:p-6">
          {[
            ["CSV / Excel / Systems", "Data inputs"],
            ["Analytics engine", "Evidence"],
            ["Recommendations", "Action"],
            ["Decisions / Outcomes / Lessons", "Learning"],
          ].map(([title, label], index) => (
            <div key={title} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm">
                {index === 0 ? <Database size={17} /> : index === 1 ? <BarChart3 size={17} /> : index === 2 ? <Sparkles size={17} /> : <Target size={17} />}
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">{title}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </div>
              {index < 3 && <span className="ml-auto hidden text-slate-300 lg:block">-&gt;</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function IndustryDashboardsSection() {
  return (
    <section id="industries" className="border-y border-slate-200 bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionIntro
          eyebrow="Industry dashboards"
          title="Start with a view that understands your business"
          description="Use a general view or choose an industry dashboard with measures, comparisons and decision questions shaped for the work you do."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {industryDashboards.map(dashboard => (
            <Link
              key={dashboard.name}
              href="/demo"
              title={`Open the live demo for the ${dashboard.name} dashboard`}
              className="group overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
            >
              <div className="h-28 border-b border-slate-100 bg-slate-50 p-4">
                <div className="flex h-full items-end gap-2">
                  {dashboard.values.map((value, index) => (
                    <span
                      key={`${dashboard.name}-${index}`}
                      className="flex-1 rounded-t-sm opacity-90 transition group-hover:opacity-100"
                      style={{ height: `${value}%`, backgroundColor: dashboard.accent }}
                    />
                  ))}
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-bold text-slate-950">{dashboard.name}</h3>
                  <span className="text-slate-300 transition group-hover:text-blue-600">-&gt;</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{dashboard.description}</p>
                <span className="mt-4 inline-block text-xs font-bold uppercase tracking-wide text-blue-600">Open live demo</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

const featureIcons = {
  database: Database,
  chart: BarChart3,
  forecast: TrendingUp,
  sparkles: Sparkles,
  target: Target,
  layers: Layers3,
} as const

export function FeaturesSection() {
  return (
    <section id="solutions" className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionIntro
          eyebrow="Core capabilities"
          title="Everything needed to move from signal to action"
          description="Use the parts you need today, then connect them into a repeatable decision practice as your business grows."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featureCards.map(feature => {
            const Icon = featureIcons[feature.icon]

            return (
              <article key={feature.title} className="rounded-lg border border-slate-200 bg-white p-5 transition hover:border-blue-200 hover:shadow-md">
                <span title={feature.title} className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Icon size={19} aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-base font-bold text-slate-950">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{feature.description}</p>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function AIDecisionEngineSection() {
  return (
    <section className="bg-slate-950 py-20 text-white sm:py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">The AI decision engine</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Charts are the beginning, not the destination.</h2>
          <p className="mt-5 text-base leading-7 text-slate-300">
            Decisionate helps teams move from a business signal to a recommendation, then keeps the outcome and lesson attached to the original decision.
          </p>
          <div className="mt-7 flex items-center gap-3 text-sm font-semibold text-cyan-300">
            <BrainCircuit size={18} aria-hidden="true" />
            Human judgment, strengthened by evidence
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-5 sm:items-center">
          {[
            ["Business data", Database],
            ["AI analysis", BrainCircuit],
            ["Recommendation", Sparkles],
            ["Decision", Target],
            ["Learning", Gauge],
          ].map(([label, Icon], index) => {
            const FeatureIcon = Icon as typeof Database

            return (
              <div key={label as string} className="flex items-center gap-3 sm:block sm:text-center">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-cyan-300 sm:mx-auto">
                  <FeatureIcon size={20} aria-hidden="true" />
                </div>
                <p className="text-sm font-bold text-white sm:mt-3">{label as string}</p>
                {index < 4 && <span className="ml-auto text-slate-600 sm:hidden">-&gt;</span>}
                <span
                  className={`mx-auto mt-4 hidden text-slate-600 sm:block ${index === 4 ? "invisible" : ""}`}
                  aria-hidden="true"
                >
                  -&gt;
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function DecisionLifecycleSection() {
  return (
    <section className="border-b border-slate-200 bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.76fr_1.24fr] lg:items-center">
          <SectionIntro
            align="left"
            eyebrow="Decision lifecycle"
            title="Keep the decision connected to the result"
            description="Traditional BI tools often stop at the chart. Decisionate continues through the action, review, outcome and lesson learned."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Recommendation", "A signal worth considering", Sparkles],
              ["Decision", "A choice with an owner", Target],
              ["Action plan", "The work that makes it real", Activity],
              ["Review date", "A moment to look again", LineChart],
              ["Outcome", "What actually happened", Check],
              ["Lesson learned", "What to repeat or avoid", LightbulbIcon],
            ].map(([title, description, Icon]) => {
              const LifecycleIcon = Icon as typeof Target

              return (
                <div key={title as string} className="flex items-start gap-3 rounded-lg border border-slate-200 p-4">
                  <LifecycleIcon size={18} className="mt-0.5 text-blue-600" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold text-slate-950">{title as string}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{description as string}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function LightbulbIcon(props: { size?: number; className?: string; "aria-hidden"?: boolean }) {
  return <Sparkles {...props} />
}

export function IntegrationsSection() {
  return (
    <section id="resources" className="border-b border-slate-200 bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionIntro
          eyebrow="Integrations"
          title="Start with the data you already have"
          description="Connect quickly with available sources today, then expand into the systems your operating model depends on."
        />

        <div className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {integrations.map(integration => {
            const available = integration.status === "Available"

            return (
              <div key={integration.name} className="flex min-h-24 flex-col justify-between rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  {available ? <PlugZap size={16} className="text-blue-600" aria-hidden="true" /> : <LockKeyhole size={15} className="text-slate-400" aria-hidden="true" />}
                  <p className="text-sm font-bold text-slate-900">{integration.name}</p>
                </div>
                <p className={`mt-4 text-[10px] font-bold uppercase tracking-wide ${available ? "text-emerald-600" : "text-slate-400"}`}>
                  {integration.status}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function BenefitsSection() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionIntro
          eyebrow="Why Decisionate"
          title="A better operating habit, not another reporting tab"
          description="Give growing teams a shared way to turn business evidence into action and organizational learning."
        />

        <div className="mt-12 grid gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit, index) => (
            <div key={benefit.title} className="flex gap-4 border-t border-slate-200 pt-4">
              <span className="text-sm font-bold text-blue-600">0{index + 1}</span>
              <div>
                <h3 className="text-base font-bold text-slate-950">{benefit.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{benefit.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function PricingSection() {
  const plans = [
    {
      name: "Free",
      price: "$0",
      annualPrice: "$0 CAD/year",
      priceDetail: "CAD / month",
      description: "Start with one workspace and a practical monthly AI allowance.",
      action: "Explore Live Demo",
      href: "/demo",
      featured: false,
      items: [
        "1 workspace",
        "1,000 included Decisionate AI credits",
        "Full access for 30 days",
      ],
    },
    {
      name: "Professional",
      price: "$79",
      annualPrice: "$790 CAD/year",
      priceDetail: "CAD / month",
      description: "Decision intelligence for a business managing its own workspace.",
      action: "Explore Live Demo",
      href: "/demo",
      featured: true,
      items: [
        "1 workspace",
        "Unlimited datasets",
        "All industry dashboards",
        "AI-powered recommendations",
        "Decision management",
        "Outcome tracking",
        "5,000 included Decisionate AI credits",
      ],
    },
    {
      name: "Agency",
      price: "$199",
      annualPrice: "$1,990 CAD/year",
      priceDetail: "CAD / month",
      description: "Manage an agency workspace and up to 10 client workspaces.",
      action: "Explore Live Demo",
      href: "/demo",
      featured: false,
      items: [
        "Up to 10 client workspaces",
        "White-label client portal",
        "Agency branding",
        "Industry dashboards",
        "25,000 included Decisionate AI credits",
      ],
    },
  ] as const

  return (
    <section id="pricing" className="border-y border-slate-200 bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionIntro
          eyebrow="Plans for businesses and agencies"
          title="Choose the way you manage decisions"
          description="Start with full access for 30 days. Choose Professional for one business workspace, or scale with agency plans based on client workspaces rather than employee seats."
        />

        <div className="mx-auto mt-12 grid max-w-7xl gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map(plan => (
            <article key={plan.name} className={`relative flex h-full flex-col rounded-lg border p-6 ${plan.featured ? "border-blue-600 bg-slate-950 text-white shadow-xl" : "border-slate-200 bg-white"}`}>
              {plan.featured && <span className="absolute right-5 top-5 rounded-full bg-cyan-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-950">Most popular</span>}
              <h3 className="text-lg font-bold">{plan.name}</h3>
              <div className="mt-5 flex items-end gap-2">
                <span className="text-4xl font-bold tracking-tight">{plan.price}</span>
                <span className={`pb-1 text-sm ${plan.featured ? "text-slate-300" : "text-slate-500"}`}>{plan.priceDetail}</span>
              </div>
              <p className={`mt-2 text-xs ${plan.featured ? "text-slate-300" : "text-slate-500"}`}>
                Annual billing: {plan.annualPrice ?? "$0/year"}
              </p>
              <p className={`mt-2 min-h-12 text-sm leading-6 ${plan.featured ? "text-slate-300" : "text-slate-500"}`}>{plan.description}</p>
              <ul className="mt-6 space-y-3">
                {plan.items.map(item => (
                  <li key={item} className={`flex gap-2 text-sm ${plan.featured ? "text-slate-200" : "text-slate-600"}`}>
                    <Check size={16} className={plan.featured ? "text-cyan-300" : "text-blue-600"} aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex justify-center pt-4">
                <a href={plan.href} className={`h-8 w-full max-w-[13rem] inline-flex items-center justify-center rounded-lg px-3 py-1 text-xs font-bold ${plan.featured ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200" : "border border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                  {plan.action}
                </a>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-[40rem] w-full text-left text-sm">
            <caption className="sr-only">Decisionate pricing and AI credit allocation</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-bold">Plan</th>
                <th className="px-4 py-3 text-right font-bold">Price (CAD)</th>
                <th className="px-4 py-3 text-right font-bold">Annual (CAD)</th>
                <th className="px-4 py-3 text-right font-bold">Client workspaces</th>
                <th className="px-4 py-3 text-right font-bold">AI credits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ["Free", "$0 CAD", "$0 CAD", "1", "1,000"],
                ["Professional", "$79 CAD", "$790 CAD", "1", "5,000"],
                ["Agency", "$199 CAD", "$1,990 CAD", "10", "25,000"],
                ["Additional client workspace", "+$20 CAD", "+$200 CAD", "+1", "TBD"],
              ].map(([name, price, annual, workspaces, credits]) => (
                <tr key={name}>
                  <th className="px-4 py-3 font-semibold text-slate-900">{name}</th>
                  <td className="px-4 py-3 text-right text-slate-700">{price}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{annual}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{workspaces}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mx-auto mt-6 grid max-w-4xl gap-3 text-center text-sm text-slate-600 sm:grid-cols-2">
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            Need more capacity? Add client workspaces for $20 CAD/month each or $200 CAD/year each. Additional AI allowance is configurable and will be confirmed separately.
          </p>
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            Additional AI credit packs are available when your usage grows.
          </p>
        </div>
      </div>
    </section>
  )
}

export function FAQSection() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <SectionIntro
          eyebrow="Questions"
          title="Frequently asked"
          description="A few useful answers before you start."
        />

        <div className="mt-10 divide-y divide-slate-200 border-y border-slate-200">
          {faqs.map(faq => (
            <details key={faq.question} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-base font-bold text-slate-950 marker:hidden">
                {faq.question}
                <span className="text-xl font-normal text-slate-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                {faq.answer}
                {"link" in faq && (
                  <>
                    {" "}
                    <Link
                      href={faq.link.href}
                      className="font-semibold text-blue-600 underline decoration-blue-200 underline-offset-4 hover:text-blue-700"
                    >
                      {faq.link.label}
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
  return (
    <section id="company" className="bg-blue-600 py-16 text-white sm:py-20">
      <div className="mx-auto flex max-w-4xl flex-col items-center px-5 text-center sm:px-8">
        <Scale size={26} className="text-cyan-200" aria-hidden="true" />
        <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-5xl">Ready to make better decisions?</h2>
        <p className="mt-4 max-w-xl text-base leading-7 text-blue-100">Start with your data, create your first decision and build the habit of learning from what happens next.</p>
        <Link href="/demo" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-bold text-blue-700 transition hover:bg-blue-50">
          Open Live Demo
          <TrendingUp size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}
