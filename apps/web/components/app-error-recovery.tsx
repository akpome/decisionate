"use client"

import { Home, RefreshCw } from "lucide-react"
import { useEffect } from "react"
import type { CSSProperties } from "react"

const actionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 44,
  boxSizing: "border-box",
  border: "1px solid #d4d4d4",
  borderRadius: 6,
  padding: "10px 16px",
  font: "inherit",
  fontSize: 14,
  fontWeight: 600,
  lineHeight: "20px",
  textDecoration: "none",
  cursor: "pointer",
}

export function AppErrorRecovery({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  // Root failures can remove providers and styles, so keep recovery independent.
  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        width: "100%",
        boxSizing: "border-box",
        padding: 24,
        background: "#f9fafb",
        color: "#171717",
        fontFamily: "Arial, Helvetica, sans-serif",
        letterSpacing: 0,
      }}
    >
      <section
        role="alert"
        style={{
          width: "100%",
          maxWidth: 480,
          minWidth: 0,
          boxSizing: "border-box",
          border: "1px solid #e5e7eb",
          borderTop: "4px solid #00c9ef",
          borderRadius: 6,
          padding: 24,
          background: "#ffffff",
          overflowWrap: "anywhere",
        }}
      >
        <p style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: "22px" }}>Decisionate</p>
        <h1 style={{ margin: "16px 0 0", fontSize: 22, fontWeight: 600, lineHeight: "28px" }}>
          This page could not load
        </h1>
        <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: "22px", color: "#525252" }}>
          Something went wrong while loading this page. Reload to try again, or
          return to the home page.
        </p>
        {error.digest && (
          <p style={{ margin: "12px 0 0", fontSize: 12, lineHeight: "18px", color: "#525252" }}>
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ ...actionStyle, borderColor: "#0047ff", background: "#0047ff", color: "#ffffff" }}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Reload page
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Recovery must work without the app router. */}
          <a href="/" style={{ ...actionStyle, background: "#ffffff", color: "#171717" }}>
            <Home size={16} aria-hidden="true" />
            Home
          </a>
        </div>
      </section>
    </main>
  )
}
