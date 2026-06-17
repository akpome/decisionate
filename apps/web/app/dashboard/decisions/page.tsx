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
} from "recharts"

import {
    BarChart3,
    CheckCircle2,
    Clock3,
    AlertTriangle,
    TrendingUp,
    XCircle,
    Target,
    Calendar,
    Activity,
    FolderOpen,
    Flag,
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
        d => d.outcome_status === "successful"
    ).length

    const partiallySuccessfulCount = decisions.filter(
        d => d.outcome_status === "partially_successful"
    ).length

    const unsuccessfulCount = decisions.filter(
        d => d.outcome_status === "unsuccessful"
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

    const categoryChartData = [
        {
            name: "General",
            value: decisions.filter(
                d => d.category === "general"
            ).length,
        },
        {
            name: "Marketing",
            value: decisions.filter(
                d => d.category === "marketing"
            ).length,
        },
        {
            name: "Sales",
            value: decisions.filter(
                d => d.category === "sales"
            ).length,
        },
        {
            name: "Operations",
            value: decisions.filter(
                d => d.category === "operations"
            ).length,
        },
        {
            name: "Finance",
            value: decisions.filter(
                d => d.category === "finance"
            ).length,
        },
        {
            name: "Hiring",
            value: decisions.filter(
                d => d.category === "hiring"
            ).length,
        },
        {
            name: "Product",
            value: decisions.filter(
                d => d.category === "product"
            ).length,
        },
    ].filter(item => item.value > 0)
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
            const date =
                decision.created_at
                    ? new Date(decision.created_at)
                    : null

            if (!date) return acc

            const month =
                date.toLocaleString("default", {
                    month: "short",
                })

            acc[month] =
                (acc[month] || 0) + 1

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

    function getSuccessRateStyle(rate: number) {
        if (rate >= 80) {
            return "bg-green-50 text-green-600"
        }

        if (rate >= 60) {
            return "bg-blue-50 text-blue-600"
        }

        if (rate >= 40) {
            return "bg-amber-50 text-amber-600"
        }

        return "bg-red-50 text-red-600"
    }

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

            <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border bg-white p-6 shadow-sm transition hover:border-gray-300 hover:shadow-md">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-sm uppercase tracking-wide text-gray-500">
                                Decision Success Rate
                            </p>

                            <p className="mt-2 text-5xl font-bold">
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
                                    style={{
                                        width: `${successRate}%`,
                                    }}
                                />
                            </div>

                            <p className="mt-2 text-gray-500">
                                Based on decisions with recorded outcomes.
                            </p>
                        </div>

                        <div
                            className={`flex h-12 w-12 items-center justify-center rounded-full ${getSuccessRateStyle(
                                successRate
                            )}`}
                        >
                            <Target size={22} />
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border bg-white p-6 shadow-sm flex flex-col">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-semibold">
                                Decisions by Category
                            </h2>

                            <p className="mt-1 text-sm text-gray-500">
                                Decisions grouped by business area.
                            </p>
                        </div>

                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-50 text-purple-600">
                            <BarChart3 size={18} />
                        </div>
                    </div>

                    <div className="mt-4 h-32">
                        <ResponsiveContainer
                            width="100%"
                            height="100%"
                        >
                            <BarChart
                                data={categoryChartData}
                                layout="vertical"
                            >
                                <XAxis
                                    type="number"
                                    allowDecimals={false}
                                />

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
                                    {categoryChartData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${entry.name}`}
                                            fill={categoryColors[index % categoryColors.length]}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        <MetricCard
                            label="Total Decisions"
                            value={decisions.length}
                            icon={<BarChart3 size={18} />}
                            accent="blue"
                        />

                        <MetricCard
                            label="Evaluated"
                            value={evaluatedCount}
                            icon={<CheckCircle2 size={18} />}
                            accent="green"
                        />

                        <MetricCard
                            label="Upcoming Reviews"
                            value={upcomingReviews.length}
                            icon={<Clock3 size={18} />}
                            accent="amber"
                        />

                        <MetricCard
                            label="Overdue Reviews"
                            value={overdueReviews.length}
                            icon={<AlertTriangle size={18} />}
                            accent="red"
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <MetricCard
                            label="Successful"
                            value={successfulCount}
                            icon={<CheckCircle2 size={18} />}
                            accent="green"
                        />

                        <MetricCard
                            label="Partially Successful"
                            value={partiallySuccessfulCount}
                            icon={<TrendingUp size={18} />}
                            accent="amber"
                        />

                        <MetricCard
                            label="Unsuccessful"
                            value={unsuccessfulCount}
                            icon={<XCircle size={18} />}
                            accent="red"
                        />
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        {upcomingReviews.length > 0 && (
                            <ReviewSection
                                title="Upcoming Reviews"
                                decisions={upcomingReviews}
                                label="Review"
                            />
                        )}

                        {overdueReviews.length > 0 && (
                            <ReviewSection
                                title="Overdue Reviews"
                                decisions={overdueReviews}
                                label="Review was due"
                            />
                        )}
                    </div>
                </div>

                <div className="rounded-2xl border bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-semibold">
                                Monthly Decision Trend
                            </h2>

                            <p className="mt-1 text-sm text-gray-500">
                                Decision creation activity over time.
                            </p>
                        </div>

                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                            <Activity size={18} />
                        </div>
                    </div>

                    <div className="mt-4 h-[calc(100%-3rem)]">
                        <ResponsiveContainer
                            width="100%"
                            height="100%"
                        >
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
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {decisions.length === 0 ? (
                <div className="rounded-2xl border border-dashed bg-white p-8 text-center shadow-sm">
                    <h3 className="text-lg font-semibold">
                        No decisions yet
                    </h3>

                    <p className="mt-2 text-sm text-gray-500">
                        Create your first decision to start tracking outcomes and learning what works.
                    </p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {decisions.map(decision => (
                        <DecisionCard
                            key={decision.id}
                            decision={decision}
                        />
                    ))}
                </div>
            )}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-semibold">
                        Decision Portfolio
                    </h2>

                    <p className="mt-1 text-sm text-gray-500">
                        {decisions.length} decisions available for review and management.
                    </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                    <BarChart3 size={18} />
                </div>
            </div>
        </div>
    )
}

function MetricCard({
    label,
    value,
    icon,
    accent = "gray",
}: {
    label: string
    value: number
    icon: React.ReactNode
    accent?: "gray" | "blue" | "green" | "amber" | "red"
}) {
    const accents = {
        gray: "bg-gray-100 text-gray-600",
        blue: "bg-blue-50 text-blue-600",
        green: "bg-green-50 text-green-600",
        amber: "bg-amber-50 text-amber-600",
        red: "bg-red-50 text-red-600",
    }

    return (
        <div className="rounded-xl border bg-white p-4 shadow-sm transition hover:border-gray-300 hover:shadow-md">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-gray-500">
                        {label}
                    </p>

                    <p className="mt-2 text-3xl font-bold">
                        {value}
                    </p>
                </div>

                <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${accents[accent]}`}
                >
                    {icon}
                </div>
            </div>
        </div>
    )
}

function ReviewSection({
    title,
    decisions,
    label,
}: {
    title: string
    decisions: any[]
    label: string
}) {
    const isOverdue =
        title === "Overdue Reviews"

    return (
        <div className="rounded-xl border bg-white p-6 shadow-sm transition hover:border-gray-300 hover:shadow-md">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">
                    {title}
                </h2>

                <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${isOverdue
                        ? "bg-red-50 text-red-600"
                        : "bg-amber-50 text-amber-600"
                        }`}
                >
                    {isOverdue ? (
                        <AlertTriangle size={18} />
                    ) : (
                        <Clock3 size={18} />
                    )}
                </div>
            </div>

            <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                {decisions.map(decision => (
                    <Link
                        key={decision.id}
                        href={`/dashboard/decisions/${decision.id}`}
                        className={`min-w-[200px] rounded-lg border border-l-4 bg-white p-3 transition hover:border-gray-300 hover:shadow-sm ${isOverdue
                            ? "border-l-red-400"
                            : "border-l-amber-400"
                            }`}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-sm font-medium">
                                    {decision.title}
                                </p>

                                <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                                    <Calendar size={12} />

                                    {label}:{" "}
                                    {new Date(
                                        decision.review_date
                                    ).toLocaleDateString()}
                                </p>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
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
    const health =
        getDecisionHealth(decision)

    return (
        <Link
            href={`/dashboard/decisions/${decision.id}`}
            className="block rounded-xl border bg-white p-6 shadow-sm transition hover:border-gray-300 hover:shadow-md"
        >
            <div className="flex items-start justify-between gap-4">
                <h2 className="font-semibold text-lg">
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

            <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
                {decision.category && (
                    <span className="flex items-center gap-1 text-blue-600">
                        <FolderOpen size={12} />
                        {decision.category
                            .replaceAll("_", " ")
                            .replace(
                                /\b\w/g,
                                (char: string) =>
                                    char.toUpperCase()
                            )}
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
                        {decision.priority
                            .charAt(0)
                            .toUpperCase() +
                            decision.priority.slice(1)}
                    </span>
                )}

                {decision.outcome_status && (
                    <span className="flex items-center gap-1 text-green-600">
                        <Target size={12} />
                        {decision.outcome_status
                            .replaceAll("_", " ")
                            .replace(
                                /\b\w/g,
                                (char: string) =>
                                    char.toUpperCase()
                            )}
                    </span>
                )}
            </div>
        </Link>
    )
}

function formatOutcomeStatus(status: string) {
    return status
        .replaceAll("_", " ")
        .replace(/\b\w/g, char => char.toUpperCase())
} 