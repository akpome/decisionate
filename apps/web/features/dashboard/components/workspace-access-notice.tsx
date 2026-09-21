"use client"

import { useDecisionateText } from "@/app/use-decisionate-language"

type WorkspaceAccessNoticeProps = {
  loading: boolean
  canManageWorkspaceData: boolean
  message: string
  className?: string
}

export function WorkspaceAccessNotice({
  loading,
  canManageWorkspaceData,
  message,
  className = "",
}: WorkspaceAccessNoticeProps) {
  const { t } = useDecisionateText()

  if (loading || canManageWorkspaceData) {
    return null
  }

  return (
    <div
      role="status"
      className={`rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 ${className}`.trim()}
    >
      {t(message)}
    </div>
  )
}
