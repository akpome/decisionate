import type { BusinessReport } from "./types"

export function ReportGrouping({ report }: { report: Pick<BusinessReport, "grain" | "analysis_grain" | "weekly_report" | "weekly_anomaly_analysis"> }) {
  const analysis = report.analysis_grain || report.grain
  return <p className="text-xs leading-5 text-gray-500">
    {report.weekly_anomaly_analysis && <>Whole-week assessment and daily checks / </>}
    {report.weekly_report && report.grain === "daily" && analysis === "weekly" ? "Weekly report / Report week: daily detail / Earlier history: weekly" : report.weekly_report && report.grain === "weekly" && analysis === "weekly" ? "Weekly report / Grouped weekly" : <>
    {report.weekly_report && <>Weekly report / </>}
    {analysis !== report.grain && <>Weekly summary: {report.grain} detail / </>}
    Analysis group by: {analysis}
    </>}
  </p>
}
