"use client"

import { createContext, useContext, type ReactNode } from "react"
import { type HostedPortal } from "./types"

const HostedContext = createContext<{ portal: HostedPortal | null; returnTo: string | null; authPortal: HostedPortal | null }>({ portal: null, returnTo: null, authPortal: null })
export const useHostedPortal = () => useContext(HostedContext)
export function HostedPortalProvider({ portal, returnTo, authPortal = null, children }: { portal: HostedPortal | null; returnTo: string | null; authPortal?: HostedPortal | null; children: ReactNode }) {
  return <HostedContext.Provider value={{ portal, returnTo, authPortal }}>{children}</HostedContext.Provider>
}
