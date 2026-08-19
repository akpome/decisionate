"use client"

import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Sparkles,
} from "lucide-react"
import {
  useState,
} from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type PreviewView = "business" | "marketing"
type PreviewPoint = {
  month: string
  value: number
}

const previewData: Record<PreviewView, PreviewPoint[]> = {
  business: [
    { month: "Jan", value: 34 },
    { month: "Feb", value: 42 },
    { month: "Mar", value: 39 },
    { month: "Apr", value: 51 },
    { month: "May", value: 58 },
    { month: "Jun", value: 67 },
    { month: "Jul", value: 74 },
  ],
  marketing: [
    { month: "Jan", value: 28 },
    { month: "Feb", value: 36 },
    { month: "Mar", value: 46 },
    { month: "Apr", value: 43 },
    { month: "May", value: 61 },
    { month: "Jun", value: 72 },
    { month: "Jul", value: 81 },
  ],
}

export function LandingDashboardPreview() {
  const [view, setView] = useState<PreviewView>("business")
  const data = previewData[view]

  return (
    <div className="relative mx-auto w-full max-w-2xl">
      <div className="absolute -inset-3 rounded-2xl border border-cyan-300/20" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-xl border border-white/15 bg-white shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </div>
            <span className="ml-2 text-xs font-semibold text-slate-500">
              Decisionate / Dashboard
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live decision signal
          </div>
        </div>

        <div className="bg-slate-50 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
                Decision intelligence
              </p>
              <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-950 sm:text-xl">
                General Business Overview
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Evidence for your next operating decision.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 text-[11px] font-semibold">
              {(["business", "marketing"] as PreviewView[]).map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  title={`Show ${option} preview`}
                  className={`rounded px-2 py-1.5 capitalize transition ${
                    view === option
                      ? "bg-slate-950 text-white"
                      : "text-slate-500 hover:text-slate-950"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["Revenue", "$248k", "+18.4%"],
              ["Decisions", "24", "+6 this month"],
              ["Learning", "82%", "outcomes captured"],
            ].map(([label, value, change]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-medium text-slate-500">{label}</p>
                <p className="mt-1 text-sm font-bold text-slate-950 sm:text-base">{value}</p>
                <p className="mt-1 text-[10px] font-semibold text-emerald-600">{change}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-900">Revenue trend</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">Monthly performance</p>
                </div>
                <BarChart3 size={15} className="text-blue-600" aria-hidden="true" />
              </div>
              <div className="mt-3 h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 5, right: 4, left: -28, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} />
                    <YAxis hide domain={[0, 90]} />
                    <Tooltip contentStyle={{ borderRadius: 6, borderColor: "#e2e8f0", fontSize: 11 }} />
                    <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2.5} fill="#dbeafe" fillOpacity={0.8} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-950 p-3 text-white">
              <div className="flex items-center gap-2 text-cyan-300">
                <Sparkles size={15} aria-hidden="true" />
                <p className="text-xs font-semibold">AI recommendation</p>
              </div>
              <p className="mt-4 text-sm font-semibold leading-5">
                Protect the improving trend with a focused next action.
              </p>
              <p className="mt-2 text-[10px] leading-4 text-slate-400">
                Based on trend, target progress and prior outcomes.
              </p>
              <div className="mt-4 flex items-center gap-1 text-[10px] font-semibold text-cyan-300">
                Review recommendation
                <ArrowUpRight size={13} aria-hidden="true" />
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Activity size={15} className="text-amber-600" aria-hidden="true" />
              <p className="text-xs font-semibold text-amber-900">3 decisions need an outcome review</p>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
              Decision queue
              <ChevronDown size={13} aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-4 -left-4 hidden items-center gap-2 rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl sm:flex">
        <CheckCircle2 size={14} className="text-emerald-400" aria-hidden="true" />
        Outcome tracking included
      </div>
    </div>
  )
}
