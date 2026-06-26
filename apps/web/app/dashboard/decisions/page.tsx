"use client"

import { getDecisions } from "@/lib/api"
import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import Link from "next/link"

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
    LineChart,
    Line,
    CartesianGrid,
    LabelList,
} from "recharts"

import {
    BarChart3,
    Target,
    Calendar,
    Activity,
    FolderOpen,
    Flag,
    Gauge,
    BriefcaseBusiness,
    Layers3,
    HeartPulse,
    AlertTriangle,
} from "lucide-react"

export default function DecisionsPage() {
    const { user } = useUser()
    const [decisions, setDecisions] = useState<any[]>([])

    useEffect(() => {
        if (!user?.id) return
        const userId = user.id

        async function load() {
            try {
                const data = await getDecisions(userId)
                setDecisions(data)
            } catch (error) {
                console.error(error)
            }
        }

        load()
    }, [user?.id])

    const successfulCount = decisions.filter(
        decision => decision.outcome_status === "successful"
    ).length

    const partiallySuccessfulCount = decisions.filter(
        decision => decision.outcome_status === "partially_successful"
    ).length

    const unsuccessfulCount = decisions.filter(
        decision => decision.outcome_status === "unsuccessful"
    ).length

    const evaluatedCount =
        successfulCount +
        partiallySuccessfulCount +
        unsuccessfulCount

    const successRate =
        evaluatedCount === 0
            ? 0
            : Math.round((successfulCount / evaluatedCount) * 100)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const overdueReviews = decisions
        .filter(
            decision =>
                decision.review_date &&
                new Date(decision.review_date) < today
        )
        .sort(
            (a, b) =>
                new Date(a.review_date).getTime() -
                new Date(b.review_date).getTime()
        )
        .slice(0, 3)

    const upcomingReviews = decisions
        .filter(
            decision =>
                decision.review_date &&
                new Date(decision.review_date) >= today
        )
        .sort(
            (a, b) =>
                new Date(a.review_date).getTime() -
                new Date(b.review_date).getTime()
        )
        .slice(0, 3)

    const decisionsMissingOutcome = decisions.filter(
        decision => !decision.outcome_status
    )

    const decisionsMissingLearning = decisions.filter(
        decision =>
            decision.outcome_status &&
            !decision.lessons_learned
    )

    const attentionItems = [
        ...overdueReviews.map(decision => ({
            id: decision.id,
            title: decision.title,
            issue: "Review overdue",
        })),
        ...decisionsMissingOutcome.map(decision => ({
            id: decision.id,
            title: decision.title,
            issue: "Outcome missing",
        })),
        ...decisionsMissingLearning.map(decision => ({
            id: decision.id,
            title: decision.title,
            issue: "Learning missing",
        })),
    ]

    const categoryChartData = [
        ["General", "general"],
        ["Marketing", "marketing"],
        ["Sales", "sales"],
        ["Operations", "operations"],
        ["Finance", "finance"],
        ["Hiring", "hiring"],
        ["Product", "product"],
    ]
        .map(([name, key]) => ({
            name,
            value: decisions.filter(d => d.category === key).length,
        }))
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value)

    const categoryColors = [
        "#2563eb",
        "#16a34a",
        "#f97316",
        "#9333ea",
        "#dc2626",
        "#0891b2",
        "#ca8a04",
    ]

    const monthlyDecisionCounts = decisions.reduce(
        (acc: Record<string, number>, decision) => {
            if (!decision.created_at) return acc

            const month = new Date(decision.created_at).toLocaleString(
                "default",
                { month: "short" }
            )

            acc[month] = (acc[month] || 0) + 1

            return acc
        },
        {}
    )

    const monthlyDecisionData = Object.entries(
        monthlyDecisionCounts
    ).map(([month, value]) => ({
        month,
        value,
    }))

    const monthlyDecisionTotal =
        monthlyDecisionData.reduce(
            (total, item) => total + item.value,
            0
        )

    function getSuccessRateStyle(rate: number) {
        if (rate >= 80) return "bg-green-50 text-green-600"
        if (rate >= 60) return "bg-blue-50 text-blue-600"
        if (rate >= 40) return "bg-amber-50 text-amber-600"
        return "bg-red-50 text-red-600"
    }

    const outcomeRecordedCount = decisions.filter(
        decision => decision.outcome_status
    ).length

    const learningCapturedCount = decisions.filter(
        decision => decision.lessons_learned
    ).length

    const reviewScheduledCount = decisions.filter(
        decision => decision.review_date
    ).length

    const notesAddedCount = decisions.filter(
        decision => decision.notes
    ).length

    const totalDecisions =
        decisions.length || 1

    const outcomeCompletion =
        Math.round(
            (outcomeRecordedCount /
                totalDecisions) *
            100
        )

    const learningCompletion =
        Math.round(
            (learningCapturedCount /
                totalDecisions) *
            100
        )

    const reviewCompletion =
        Math.round(
            (reviewScheduledCount /
                totalDecisions) *
            100
        )

    const notesCompletion =
        Math.round(
            (notesAddedCount /
                totalDecisions) *
            100
        )

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">
                    Decisions
                </h1>

                <p className="mt-2 text-gray-500">
                    Track decisions, review outcomes, and learn what works.
                </p>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <DashboardCard>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                                Decision Success Rate
                            </p>

                            <p className="mt-2 text-6xl font-bold tracking-tight">
                                {successRate}%
                            </p>

                            <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
                                <div
                                    className={`h-full rounded-full ${successRate >= 80
                                        ? "bg-green-500"
                                        : successRate >= 60
                                            ? "bg-blue-500"
                                            : successRate >= 40
                                                ? "bg-amber-500"
                                                : "bg-red-500"
                                        }`}
                                    style={{ width: `${successRate}%` }}
                                />
                            </div>

                            <p className="mt-2 text-sm text-gray-500">
                                Based on decisions with recorded outcomes.
                            </p>
                        </div>

                        <IconBadge
                            className={getSuccessRateStyle(successRate)}
                            icon={<Target size={22} />}
                        />
                    </div>
                </DashboardCard>

                <DashboardCard>
                    <CardHeader
                        title="Decisions by Category"
                        description="Decisions grouped by business area."
                        icon={
                            <IconBadge
                                className="bg-purple-50 text-purple-600"
                                icon={<BarChart3 size={22} />}
                            />
                        }
                    />

                    {categoryChartData.length === 0 ? (
                        <EmptyState
                            title="No category data yet"
                            description="Categories will appear when decisions are created."
                        />
                    ) : (
                        <div className="mt-4 h-36">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={categoryChartData}
                                    layout="vertical"
                                >
                                    <XAxis type="number" allowDecimals={false} />
                                    <YAxis
                                        type="category"
                                        dataKey="name"
                                        width={90}
                                    />
                                    <Tooltip />

                                    <Bar
                                        dataKey="value"
                                        radius={[0, 6, 6, 0]}
                                    >
                                        <LabelList
                                            dataKey="value"
                                            position="right"
                                        />

                                        {categoryChartData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${entry.name}`}
                                                fill={
                                                    categoryColors[
                                                    index % categoryColors.length
                                                    ]
                                                }
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </DashboardCard>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <DashboardCard className="h-full">
                    <CardHeader
                        title="Decision Metrics"
                        description="Snapshot of decision activity and outcomes."
                        icon={
                            <IconBadge
                                className="bg-indigo-50 text-indigo-600"
                                icon={<Gauge size={22} />}
                            />
                        }
                    />

                    <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                        <MetricCard label="Total Decisions" value={decisions.length} />
                        <MetricCard label="Evaluated" value={evaluatedCount} />
                        <MetricCard label="Upcoming Reviews" value={upcomingReviews.length} />
                        <MetricCard label="Overdue Reviews" value={overdueReviews.length} />
                        <MetricCard
                            label="Planned"
                            value={decisions.filter(d => d.status === "planned").length}
                        />

                        <MetricCard
                            label="In Progress"
                            value={decisions.filter(d => d.status === "in_progress").length}
                        />

                        <MetricCard
                            label="Completed"
                            value={decisions.filter(d => d.status === "completed").length}
                        />

                        <MetricCard
                            label="Cancelled"
                            value={decisions.filter(d => d.status === "cancelled").length}
                        />
                    </div>
                </DashboardCard>

                <DashboardCard>
                    <CardHeader
                        title="Monthly Decision Trend"
                        description="Decision creation activity over time."
                        icon={
                            <IconBadge
                                className="bg-blue-50 text-blue-600"
                                icon={<Activity size={22} />}
                            />
                        }
                    />

                    {monthlyDecisionData.length > 1 ? (
                        <div className="mt-4 h-40">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={monthlyDecisionData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="month" />
                                    <YAxis allowDecimals={false} />
                                    <Tooltip />
                                    <Line
                                        type="monotone"
                                        dataKey="value"
                                        stroke="#2563eb"
                                        strokeWidth={3}
                                        dot={{ r: 4 }}
                                        activeDot={{ r: 6 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="mt-4 flex h-40 flex-col items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-center">
                            <p className="text-5xl font-bold text-blue-700">
                                {monthlyDecisionTotal}
                            </p>

                            <p className="mt-2 text-sm font-medium text-blue-700">
                                decisions created this month
                            </p>

                            <p className="mt-1 text-xs text-blue-500">
                                Trend chart appears when multiple months are available.
                            </p>
                        </div>
                    )}
                </DashboardCard>
            </div>

            <DashboardCard>
                <CardHeader
                    title="Decision Health"
                    description="How complete your decision records are."
                    icon={
                        <IconBadge
                            className="bg-green-50 text-green-600"
                            icon={<HeartPulse size={22} />}
                        />
                    }
                />

                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                    <MetricCard
                        label="Outcomes Recorded"
                        value={outcomeRecordedCount}
                    />

                    <MetricCard
                        label="Learning Captured"
                        value={learningCapturedCount}
                    />

                    <MetricCard
                        label="Reviews Scheduled"
                        value={reviewScheduledCount}
                    />

                    <MetricCard
                        label="Notes Added"
                        value={notesAddedCount}
                    />
                </div>
            </DashboardCard>

            <div>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-semibold">
                            Decision Portfolio
                        </h2>

                        <p className="mt-1 text-sm text-gray-500">
                            {decisions.length} decisions available for review and management.
                        </p>
                    </div>

                    <IconBadge
                        className="bg-purple-50 text-purple-600"
                        icon={<BriefcaseBusiness size={22} />}
                    />
                </div>

                <div className="mt-4 h-px bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200" />
            </div>

            {decisions.length === 0 ? (
                <DashboardCard className="border-dashed text-center">
                    <h3 className="text-lg font-semibold">
                        No decisions yet
                    </h3>

                    <p className="mt-2 text-sm text-gray-500">
                        Create your first decision to start tracking outcomes and learning what works.
                    </p>
                </DashboardCard>
            ) : (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {decisions.map(decision => (
                        <DecisionCard
                            key={decision.id}
                            decision={decision}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

function DashboardCard({
    children,
    className = "",
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div
            className={`rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ${className}`}
        >
            {children}
        </div>
    )
}

function CardHeader({
    title,
    description,
    icon,
}: {
    title: string
    description: string
    icon: React.ReactNode
}) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div>
                <h2 className="text-xl font-semibold tracking-tight">
                    {title}
                </h2>

                <p className="mt-1 text-sm text-gray-600">
                    {description}
                </p>
            </div>

            {icon}
        </div>
    )
}

function IconBadge({
    icon,
    className,
}: {
    icon: React.ReactNode
    className: string
}) {
    return (
        <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${className}`}
        >
            {icon}
        </div>
    )
}

function MetricCard({
    label,
    value,
    suffix = "",
}: {
    label: string
    value: number
    suffix?: string
}) {
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="truncate text-xs font-medium text-gray-500">
                {label}
            </p>

            <p className="mt-1 text-xl font-semibold text-gray-900">
                {value}{suffix}
            </p>
        </div>
    )
}

function EmptyState({
    title,
    description,
}: {
    title: string
    description: string
}) {
    return (
        <div className="mt-4 flex h-36 flex-col items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-center">
            <p className="text-sm font-medium text-blue-700">
                {title}
            </p>

            <p className="mt-1 text-xs text-blue-500">
                {description}
            </p>
        </div>
    )
}

function getDecisionHealth(decision: any) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (
        decision.review_date &&
        new Date(decision.review_date) < today
    ) {
        return "Needs Review"
    }

    if (
        decision.status === "completed" &&
        decision.outcome_status &&
        decision.lessons_learned
    ) {
        return "Healthy"
    }

    if (decision.status === "in_progress") {
        return "In Progress"
    }

    if (decision.status === "cancelled") {
        return "Cancelled"
    }

    return "Planned"
}

function getHealthBadgeClass(health: string) {
    if (health === "Healthy") {
        return "border-green-200 bg-green-50 text-green-700"
    }

    if (health === "Needs Review") {
        return "border-amber-200 bg-amber-50 text-amber-700"
    }

    if (health === "In Progress") {
        return "border-blue-200 bg-blue-50 text-blue-700"
    }

    if (health === "Cancelled") {
        return "border-red-200 bg-red-50 text-red-700"
    }

    return "border-gray-200 bg-gray-50 text-gray-700"
}

function DecisionCard({
    decision,
}: {
    decision: any
}) {
    const health = getDecisionHealth(decision)

    return (
        <Link
            href={`/dashboard/decisions/${decision.id}`}
            className="block rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-lg"
        >
            <div className="flex items-start justify-between gap-4">
                <h2 className="text-lg font-semibold">
                    {decision.title}
                </h2>

                <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${getHealthBadgeClass(
                        health
                    )}`}
                >
                    {health}
                </span>
            </div>

            <p className="mt-3 text-sm text-gray-500 line-clamp-2">
                {decision.description ||
                    "No description provided."}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
                {decision.category && (
                    <span className="flex items-center gap-1 text-blue-600">
                        <FolderOpen size={12} />
                        {formatLabel(decision.category)}
                    </span>
                )}

                {decision.review_date && (
                    <span className="flex items-center gap-1 text-amber-600">
                        <Calendar size={12} />
                        {new Date(
                            decision.review_date
                        ).toLocaleDateString()}
                    </span>
                )}

                {decision.priority && (
                    <span className="flex items-center gap-1 text-red-600">
                        <Flag size={12} />
                        {formatLabel(decision.priority)}
                    </span>
                )}

                {decision.outcome_status && (
                    <span className="flex items-center gap-1 text-green-600">
                        <Target size={12} />
                        {formatLabel(decision.outcome_status)}
                    </span>
                )}
            </div>

            <div className="mt-4 border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                        Click to manage decision
                    </span>

                    <span className="font-medium text-blue-600">
                        View Details →
                    </span>
                </div>
            </div>
        </Link>
    )
}

function formatLabel(value: string) {
    return value
        .replaceAll("_", " ")
        .replace(
            /\b\w/g,
            (char: string) => char.toUpperCase()
        )
} 
