"use client"

import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Database,
  Gauge,
  Link2,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react"
import {
  useEffect,
  useState,
} from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

const demoSteps = [
  {
    label: "Connect",
    view: "connect",
    title: "Start with the data you already have",
    description: "Upload a CSV or Excel file, or connect a source your team already uses.",
    action: "Choose a source and bring a dataset into the workspace.",
    result: "A shared, analyzable dataset with its columns and time range ready to inspect.",
    example: "Example: Google Analytics marketing data",
    icon: Database,
  },
  {
    label: "Configure",
    view: "mapping",
    title: "Tell Decisionate what matters",
    description: "Select the dataset, metrics, date range, aggregation and dashboard that frame the question.",
    action: "Map a business metric to a source column and set the analysis period.",
    result: "Every KPI and chart uses the same metric, period and aggregation choices.",
    example: "Revenue → revenue · Jan 1–Jun 30 · Monthly sum",
    icon: Gauge,
  },
  {
    label: "Relate",
    view: "relationship",
    title: "Connect the signals behind a decision",
    description: "Relate metrics from separate sources by normalized periods when one dataset does not tell the whole story.",
    action: "Compare marketing spend with revenue and let Decisionate test sensible timing automatically.",
    result: "A business-friendly association with strength, matched periods and the observed delay.",
    example: "Strong association · Revenue follows ad spend by about 1 month",
    icon: Link2,
  },
  {
    label: "Monitor",
    view: "monitoring",
    title: "Keep important changes in view",
    description: "Anomaly detection, targets and scheduled alerts help surface meaningful changes without requiring someone to watch every chart.",
    action: "Choose a metric, define an optional target and configure an alert delivery channel.",
    result: "A concise signal with the evidence, recommendation and next step ready for review.",
    example: "Unusual increase · Revenue is 24% above its recent expected range",
    icon: Bell,
  },
  {
    label: "Analyze",
    view: "analysis",
    title: "See the signal behind the numbers",
    description: "Use dashboards, KPIs, comparisons and category breakdowns to understand what changed.",
    action: "Compare performance and look for a meaningful movement before acting.",
    result: "A focused view of the evidence behind the business question.",
    example: "Revenue is up 18% since the previous period",
    icon: TrendingUp,
  },
  {
    label: "Recommend",
    view: "forecast",
    title: "Turn evidence into a next action",
    description: "Forecasts and recommendations combine current signals with historical decision learning, with transparent fallback guidance when AI is unavailable.",
    action: "Review the forecast, confidence, risks and supporting evidence.",
    result: "A recommendation you can review and convert into a decision with its evidence preserved.",
    example: "Focus the next campaign on the highest-converting channel",
    icon: Sparkles,
  },
  {
    label: "Decide",
    view: "decision",
    title: "Make the choice accountable",
    description: "Convert a recommendation into a decision with an owner, expected outcome and review date.",
    action: "Record what will be done, the expected outcome and how success will be measured.",
    result: "A decision record that can be reviewed instead of disappearing into a chat or meeting.",
    example: "Expected outcome: +12% qualified leads · Review: Jul 31",
    icon: Target,
  },
  {
    label: "Learn",
    view: "learning",
    title: "Make the next recommendation wiser",
    description: "Record the actual result, outcome status and lesson learned when the decision is reviewed.",
    action: "Compare the expected outcome with what happened and capture the lesson.",
    result: "Future recommendations can use your workspace's own decision evidence.",
    example: "Successful · Actual revenue: $12,400 · Lesson: repeat the tested offer",
    icon: Lightbulb,
  },
] as const

const trendData = [
  { month: "Jan", value: 34 },
  { month: "Feb", value: 42 },
  { month: "Mar", value: 39 },
  { month: "Apr", value: 51 },
  { month: "May", value: 58 },
  { month: "Jun", value: 67 },
  { month: "Jul", value: 74 },
]

const decisionData = [
  { label: "Marketing", value: 8 },
  { label: "Sales", value: 6 },
  { label: "Operations", value: 5 },
  { label: "Finance", value: 3 },
]

const forecastData = [
  { month: "Apr", actual: 51, forecast: null },
  { month: "May", actual: 58, forecast: null },
  { month: "Jun", actual: 67, forecast: null },
  { month: "Jul", actual: 74, forecast: 74 },
  { month: "Aug", actual: null, forecast: 81 },
  { month: "Sep", actual: null, forecast: 86 },
]

const monitoringData = [
  { month: "Apr", value: 51, expected: 49 },
  { month: "May", value: 58, expected: 52 },
  { month: "Jun", value: 67, expected: 55 },
  { month: "Jul", value: 74, expected: 60 },
]

export function LandingProductDemo() {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const currentStep = demoSteps[step]
  const StepIcon = currentStep.icon

  useEffect(() => {
    if (!playing) {
      return
    }

    const timer = window.setInterval(() => {
      setStep(current => (current + 1) % demoSteps.length)
    }, 3600)

    return () => window.clearInterval(timer)
  }, [playing])

  function goToStep(nextStep: number) {
    setStep(
      (nextStep + demoSteps.length) % demoSteps.length
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-white shadow-2xl">
      <div className="flex items-center border-b border-slate-800 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
          <span className="ml-2 text-xs font-semibold text-slate-400">
            Decisionate / Product demo
          </span>
        </div>
      </div>

      <div className="grid min-h-[31rem] lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="border-b border-slate-800 bg-slate-900/70 p-4 lg:border-b-0 lg:border-r">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Decisionate workflow
          </p>
          <div className="mt-5 space-y-2">
            {demoSteps.map((item, index) => {
              const Icon = item.icon
              const active = index === step
              const complete = index < step

              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => goToStep(index)}
                  title={`Show ${item.label.toLowerCase()} step`}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                    active
                      ? "bg-cyan-400 text-slate-950"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {complete && !active ? (
                    <CheckCircle2 size={15} aria-hidden="true" />
                  ) : (
                    <Icon size={15} aria-hidden="true" />
                  )}
                  {item.label}
                </button>
              )
            })}
          </div>
        </aside>

        <main className="min-w-0 bg-slate-50 p-4 text-slate-950 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
                Step {step + 1} of {demoSteps.length} · {currentStep.label}
              </p>
              <h3 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
                {currentStep.title}
              </h3>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500 sm:text-sm">
                {currentStep.description}
              </p>
            </div>
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white sm:flex">
              <StepIcon size={19} aria-hidden="true" />
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-blue-600">
                Do this
              </p>
              <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-800">
                {currentStep.action}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-600">
                Get this
              </p>
              <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-800">
                {currentStep.result}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-900">
                    {currentStep.view === "connect"
                      ? "Connected sources"
                      : currentStep.view === "mapping"
                        ? "Metric mapping"
                        : currentStep.view === "relationship"
                          ? "Relationship analysis"
                          : currentStep.view === "monitoring"
                            ? "Alert monitor"
                            : currentStep.view === "decision"
                          ? "New decision"
                          : currentStep.view === "learning"
                            ? "Outcome review"
                            : currentStep.view === "forecast"
                              ? "Forecast evidence"
                              : "Business performance"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {currentStep.view === "connect"
                      ? "Ready for analysis"
                      : currentStep.view === "mapping"
                        ? "Use the columns that answer the question"
                        : currentStep.view === "relationship"
                          ? "Observed association, not proven causation"
                          : currentStep.view === "monitoring"
                            ? "Signals checked against recent patterns"
                            : currentStep.view === "decision"
                          ? "Recommendation converted to action"
                          : currentStep.view === "learning"
                            ? "Evidence returned to the decision loop"
                            : currentStep.view === "forecast"
                              ? "Historical actuals compared with the forecast"
                              : "Last 7 periods"}
                  </p>
                </div>
                <Gauge size={15} className="text-blue-600" aria-hidden="true" />
              </div>

              {currentStep.view === "forecast" && (
                <div className="mt-2 flex items-center gap-3 text-[9px] font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-blue-600" aria-hidden="true" />
                    Actual
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-cyan-500" aria-hidden="true" />
                    Forecast
                  </span>
                </div>
              )}

              <div className="mt-3 h-44">
                {currentStep.view === "connect" ? (
                  <div className="grid h-full grid-cols-3 gap-2">
                    {["CSV", "Analytics", "CRM"].map((source, index) => (
                      <div key={source} className="flex flex-col justify-between rounded-md border border-slate-200 bg-slate-50 p-2">
                        <Database size={15} className="text-blue-600" aria-hidden="true" />
                        <div>
                          <p className="text-[10px] font-bold text-slate-900">{source}</p>
                          <p className="mt-1 text-[9px] text-emerald-600">{index === 2 ? "Mapped" : "Connected"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : currentStep.view === "mapping" ? (
                  <div className="space-y-2 pt-1">
                    {[
                      ["Revenue", "revenue", "Mapped"],
                      ["Conversions", "conversions", "Mapped"],
                      ["Date", "event_date", "Detected"],
                    ].map(([label, column, status]) => (
                      <div key={label} className="grid grid-cols-[5.2rem_minmax(0,1fr)_3.5rem] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                        <span className="text-[10px] font-bold text-slate-700">{label}</span>
                        <span className="truncate rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500">{column}</span>
                        <span className="text-right text-[9px] font-bold text-emerald-600">{status}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between rounded-md bg-blue-50 px-2 py-2 text-[10px] font-semibold text-blue-700">
                      <span>Aggregation</span>
                      <span>Monthly sum</span>
                    </div>
                  </div>
                ) : currentStep.view === "relationship" ? (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                      <span className="text-[10px] font-bold text-slate-700">Meta Ads · Ad spend</span>
                      <span className="rounded bg-blue-100 px-2 py-1 text-[9px] font-bold text-blue-700">Input</span>
                    </div>
                    <div className="flex justify-center text-slate-400" aria-hidden="true">
                      <ArrowRight size={14} />
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-2 py-2">
                      <span className="text-[10px] font-bold text-slate-700">Revenue · Monthly sum</span>
                      <span className="rounded bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-700">Outcome</span>
                    </div>
                    <div className="rounded-md bg-slate-950 px-2 py-2 text-[10px] font-semibold text-white">
                      Best observed delay: <span className="text-cyan-300">about 1 month</span>
                    </div>
                  </div>
                ) : currentStep.view === "monitoring" ? (
                  <div className="space-y-2 pt-1">
                    <div className="h-28">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={monitoringData} margin={{ top: 5, right: 4, left: -28, bottom: 0 }}>
                          <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} />
                          <YAxis hide />
                          <Area type="monotone" dataKey="expected" stroke="#94a3b8" strokeDasharray="4 3" fill="none" />
                          <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2.5} fill="#dbeafe" fillOpacity={0.8} />
                          <Line type="monotone" dataKey="value" stroke="#2563eb" dot={{ r: 3, fill: "#2563eb" }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-[10px]">
                      <span className="font-bold text-amber-800">Unusual increase detected</span>
                      <span className="font-semibold text-amber-700">24% above range</span>
                    </div>
                  </div>
                ) : currentStep.view === "decision" ? (
                  <div className="space-y-2 pt-1">
                    {[
                      ["Decision", "Focus the highest-converting channel"],
                      ["Expected outcome", "Increase qualified leads by 12%"],
                      ["Review date", "Jul 31, 2026"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-[10px] font-semibold text-slate-700">{value}</div>
                      </div>
                    ))}
                  </div>
                ) : currentStep.view === "learning" ? (
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                        <p className="text-[9px] uppercase tracking-wide text-slate-400">Expected</p>
                        <p className="mt-1 text-sm font-bold text-slate-800">+12%</p>
                      </div>
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                        <p className="text-[9px] uppercase tracking-wide text-emerald-600">Actual</p>
                        <p className="mt-1 text-sm font-bold text-emerald-700">+16%</p>
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white px-2 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Lesson learned</p>
                      <p className="mt-1 text-[10px] font-semibold leading-4 text-slate-700">Repeat the tested offer with the strongest channel mix.</p>
                    </div>
                  </div>
                ) : currentStep.view === "forecast" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={forecastData} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} />
                      <YAxis hide allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 6, borderColor: "#e2e8f0", fontSize: 11 }} />
                      <Bar dataKey="actual" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="forecast" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : currentStep.view === "analysis" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={decisionData} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} />
                      <YAxis hide allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 6, borderColor: "#e2e8f0", fontSize: 11 }} />
                      <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 5, right: 4, left: -28, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} />
                      <YAxis hide domain={[0, 90]} />
                      <Tooltip contentStyle={{ borderRadius: 6, borderColor: "#e2e8f0", fontSize: 11 }} />
                      <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2.5} fill="#dbeafe" fillOpacity={0.8} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-lg bg-slate-950 p-3 text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                {currentStep.view === "monitoring"
                  ? "Alert signal"
                  : currentStep.view === "forecast"
                    ? "AI recommendation"
                    : currentStep.view === "decision"
                      ? "Decision record"
                      : currentStep.view === "learning"
                        ? "Learning evidence"
                        : currentStep.view === "relationship"
                          ? "Relationship context"
                          : "Dashboard signal"}
              </p>
              <p className="mt-4 text-sm font-semibold leading-5">
                {currentStep.view === "monitoring"
                  ? "Revenue is outside its recent expected range."
                  : currentStep.view === "forecast"
                    ? "Protect the improving trend with a focused next action."
                    : currentStep.view === "decision"
                      ? "Increase campaign focus for the next review period."
                      : currentStep.view === "learning"
                        ? "Outcome recorded. Lesson added to future context."
                        : currentStep.view === "relationship"
                          ? "Ad spend and revenue move together with a one-month observed delay."
                          : "Revenue is moving above its recent baseline."}
              </p>
              <div className="mt-4 border-t border-slate-800 pt-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  Example
                </p>
                <p className="mt-1 text-[10px] leading-4 text-slate-300">
                  {currentStep.example}
                </p>
              </div>
              <button
                type="button"
                onClick={() => goToStep(step + 1)}
                className="mt-4 inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-300 hover:text-cyan-200"
              >
                {step === demoSteps.length - 1 ? "Start again" : "Next step"}
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex gap-1.5" aria-label="Demo progress">
              {demoSteps.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => goToStep(index)}
                  title={`Jump to ${item.label.toLowerCase()}`}
                  aria-label={`Jump to ${item.label.toLowerCase()}`}
                  className={`h-1.5 rounded-full transition-all ${index === step ? "w-8 bg-blue-600" : "w-2 bg-slate-300"}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(0)}
                title="Restart demo"
                aria-label="Restart demo"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <RotateCcw size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setPlaying(current => !current)}
                title={playing ? "Pause demo" : "Play demo"}
                aria-label={playing ? "Pause demo" : "Play demo"}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-950 text-white hover:bg-slate-800"
              >
                {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
