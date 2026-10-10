"use client"

import { AppErrorRecovery } from "@/components/app-error-recovery"

export default function Error({ error }: { error: Error & { digest?: string } }) {
  return <AppErrorRecovery error={error} />
}
