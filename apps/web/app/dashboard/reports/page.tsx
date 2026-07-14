"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useUser } from "@clerk/nextjs"
import {
  BarChart3,
  FileText,
  LineChart,
  RefreshCw,
} from "lucide-react"

import {
  getMyOrganization,
  getOrganizationWorkspaces,
  getDatasets,
  type DatasetSummary,
  type OrganizationRecord,
  type OrganizationWorkspaceRecord,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"

/* =========================
   Reports Page Dataset Derived Types
========================= */

type ReportStatus =
  | "Ready"
  | "Needs Data"

type DatasetReport = {
  dataset: DatasetSummary
  status: ReportStatus
  updatedAt: string
}

type ReportBrand = {
  name: string
  logoUrl: string
  primaryColor: string
  accentColor: string
}

const defaultReportBrand: ReportBrand = {
  name: "Decisionate",
  logoUrl: "",
  primaryColor: "#2563EB",
  accentColor: "#14B8A6",
}

/* =========================
   Reports Page Workspace Dataset Reports
========================= */

export default function ReportsPage() {
  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)

  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])
  const [reportBrand, setReportBrand] =
    useState<ReportBrand>(defaultReportBrand)
  const [loading, setLoading] =
    useState(false)
  const [errorMessage, setErrorMessage] =
    useState("")

  const reports = useMemo(
    () => buildDatasetReports(datasets),
    [datasets]
  )

  async function loadReports() {
    if (!user?.id) return

    try {
      setLoading(true)
      setErrorMessage("")

      const [
        data,
        organization,
        workspaces,
      ] = await Promise.all([
        getDatasets(
          user.id,
          activeWorkspaceId
        ),
        getMyOrganization(user.id),
        getOrganizationWorkspaces(user.id),
      ])

      setDatasets(data)
      setReportBrand(
        getReportBrand(
          activeWorkspaceId,
          user.id,
          organization,
          workspaces,
          user.fullName
        )
      )
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Reports could not be loaded."
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user?.id) return

    let ignoreResult = false

    async function loadInitialReports(
      userId: string
    ) {
      try {
        setLoading(true)
        setErrorMessage("")

        const [
          data,
          organization,
          workspaces,
        ] = await Promise.all([
          getDatasets(
            userId,
            activeWorkspaceId
          ),
          getMyOrganization(userId),
          getOrganizationWorkspaces(userId),
        ])

        if (!ignoreResult) {
          setDatasets(data)
          setReportBrand(
            getReportBrand(
              activeWorkspaceId,
              userId,
              organization,
              workspaces,
              user.fullName
            )
          )
        }
      } catch (error) {
        console.error(error)

        if (!ignoreResult) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Reports could not be loaded."
          )
        }
      } finally {
        if (!ignoreResult) {
          setLoading(false)
        }
      }
    }

    void loadInitialReports(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    user?.id,
    user?.fullName,
    workspaceVersion,
  ])

  return (
    <div className="space-y-8">
      {/* =========================
          Reports Header And Workspace Refresh Action
      ========================= */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Reports
          </h1>

          <p className="mt-2 text-gray-500">
            Review dataset summaries and open report-ready analysis.
          </p>
        </div>

        <button
          type="button"
          onClick={loadReports}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
        >
          <RefreshCw size={16} />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div
        className="rounded-2xl border bg-white p-5 shadow-sm"
        style={{
          borderColor: reportBrand.primaryColor,
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-lg font-bold text-white"
            style={{
              backgroundColor:
                reportBrand.primaryColor,
            }}
          >
            {reportBrand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={reportBrand.logoUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              reportBrand.name
                .charAt(0)
                .toUpperCase()
            )}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Prepared by
            </p>

            <h2 className="text-xl font-semibold text-gray-900">
              {reportBrand.name}
            </h2>

            <p
              className="text-sm"
              style={{
                color: reportBrand.accentColor,
              }}
            >
              Client-ready dataset reporting workspace
            </p>
          </div>
        </div>
      </div>

      {/* =========================
          Reports Summary Cards For Workspace Dataset Coverage
      ========================= */}

      <div className="grid gap-4 md:grid-cols-3">
        <ReportStatCard
          label="Datasets"
          value={datasets.length}
          icon={<FileText size={20} />}
        />

        <ReportStatCard
          label="Rows Covered"
          value={sumDatasetRows(datasets)}
          icon={<BarChart3 size={20} />}
        />

        <ReportStatCard
          label="Columns Covered"
          value={sumDatasetColumns(datasets)}
          icon={<LineChart size={20} />}
        />
      </div>

      {/* =========================
          Reports Error And Empty States
      ========================= */}

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorMessage}
        </div>
      )}

      {!loading && reports.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
          <h2 className="text-xl font-semibold">
            No report data yet
          </h2>

          <p className="mt-2 text-gray-500">
            Upload a dataset to generate dashboard, forecast and insight reports.
          </p>

          <Link
            href="/dashboard/datasets"
            className="mt-5 inline-flex rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
          >
            Add Dataset
          </Link>
        </div>
      )}

      {/* =========================
          Reports List Generated From Current Workspace Datasets
      ========================= */}

      {reports.length > 0 && (
        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-semibold">
              Dataset Reports
            </h2>
          </div>

          <div className="divide-y">
            {reports.map((report) => (
              <ReportRow
                key={report.dataset.id}
                report={report}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* =========================
   Reports Row And Stat Components
========================= */

function ReportStatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: number
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">
          {label}
        </p>

        <span className="rounded-lg bg-blue-50 p-2 text-blue-600">
          {icon}
        </span>
      </div>

      <p className="mt-3 text-2xl font-bold">
        {value.toLocaleString()}
      </p>
    </div>
  )
}

function ReportRow({
  report,
}: {
  report: DatasetReport
}) {
  return (
    <div className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <h3 className="truncate font-medium">
          {report.dataset.file_name}
        </h3>

        <p className="mt-1 text-sm text-gray-500">
          {report.dataset.row_count.toLocaleString()} rows,{" "}
          {report.dataset.column_count.toLocaleString()} columns
        </p>

        <p className="mt-1 text-xs text-gray-400">
          Updated {report.updatedAt}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={getReportStatusClass(report.status)}>
          {report.status}
        </span>

        <Link
          href={`/dashboard/datasets/${report.dataset.id}`}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Dataset
        </Link>

        <Link
          href="/dashboard"
          className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50"
        >
          Dashboard
        </Link>

        <Link
          href="/dashboard/forecasts"
          className="rounded-lg border border-green-200 px-3 py-2 text-sm font-medium text-green-700 transition hover:bg-green-50"
        >
          Forecast
        </Link>
      </div>
    </div>
  )
}

/* =========================
   Reports Data And Formatting Helpers
========================= */

function buildDatasetReports(
  datasets: DatasetSummary[]
): DatasetReport[] {
  return datasets.map((dataset) => ({
    dataset,
    status:
      dataset.row_count > 0 &&
      dataset.column_count > 0
        ? "Ready"
        : "Needs Data",
    updatedAt: formatReportDate(
      dataset.created_at
    ),
  }))
}

function sumDatasetRows(
  datasets: DatasetSummary[]
) {
  return datasets.reduce(
    (total, dataset) =>
      total + dataset.row_count,
    0
  )
}

function sumDatasetColumns(
  datasets: DatasetSummary[]
) {
  return datasets.reduce(
    (total, dataset) =>
      total + dataset.column_count,
    0
  )
}

function formatReportDate(
  value: string | undefined
) {
  if (!value) {
    return "recently"
  }

  return new Date(value).toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    }
  )
}

function getReportStatusClass(
  status: ReportStatus
) {
  return `rounded-full px-3 py-1 text-xs font-medium ${
    status === "Ready"
      ? "bg-green-50 text-green-700"
      : "bg-amber-50 text-amber-700"
  }`
}

function getReportBrand(
  activeWorkspaceId: string,
  userId: string,
  organization: OrganizationRecord | null,
  workspaces: OrganizationWorkspaceRecord[],
  fullName: string | null | undefined
): ReportBrand {
  const fallbackName =
    organization?.report_display_name ||
    organization?.name ||
    fullName ||
    defaultReportBrand.name

  if (!activeWorkspaceId || activeWorkspaceId === userId) {
    return {
      name: fallbackName,
      logoUrl: organization?.logo_url ?? "",
      primaryColor:
        organization?.primary_color ??
        defaultReportBrand.primaryColor,
      accentColor:
        organization?.accent_color ??
        defaultReportBrand.accentColor,
    }
  }

  const workspace =
    workspaces.find(
      (item) =>
        item.owner_user_id === activeWorkspaceId
    )

  return {
    name:
      workspace?.report_display_name ||
      workspace?.name ||
      fallbackName,
    logoUrl: workspace?.logo_url ?? "",
    primaryColor:
      workspace?.primary_color ??
      defaultReportBrand.primaryColor,
    accentColor:
      workspace?.accent_color ??
      defaultReportBrand.accentColor,
  }
}
