"use client"

import { AppErrorRecovery } from "@/components/app-error-recovery"

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <head>
        <title>Unable to load | Decisionate</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0 }}>
        <AppErrorRecovery error={error} />
      </body>
    </html>
  )
}
