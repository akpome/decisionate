import type { BusinessReport } from "./types"

export function ReportGrouping({ report }: { report: Pick<BusinessReport, "grain" | "analysis_grain"> }) {
  const analysis = report.analysis_grain || report.grain
  return <p className="text-xs leading-5 text-gray-500">
    {analysis !== report.grain && <>Weekly summary: {report.grain} detail / </>}
    Analysis group by: {analysis}
  </p>
}
