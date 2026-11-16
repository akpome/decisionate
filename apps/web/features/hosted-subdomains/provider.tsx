"use client"

import { createContext, useContext, type ReactNode } from "react"
import { type HostedPortal } from "./types"

const HostedContext = createContext<{ portal: HostedPortal | null; returnTo: string | null }>({ portal: null, returnTo: null })
export const useHostedPortal = () => useContext(HostedContext)
export function HostedPortalProvider({ portal, returnTo, children }: { portal: HostedPortal | null; returnTo: string | null; children: ReactNode }) {
  return <HostedContext.Provider value={{ portal, returnTo }}>{children}</HostedContext.Provider>
}
