"use client"

import {
  createContext,
  useContext,
  type ReactNode,
} from "react"

const DashboardSessionUserIdContext =
  createContext<string | undefined>(undefined)

export function DashboardSessionProvider({
  userId,
  children,
}: {
  userId?: string
  children: ReactNode
}) {
  return (
    <DashboardSessionUserIdContext.Provider
      value={userId}
    >
      {children}
    </DashboardSessionUserIdContext.Provider>
  )
}

export function useDashboardSessionUserId() {
  return useContext(
    DashboardSessionUserIdContext
  )
}
