import { ImageResponse } from "next/og"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-static"

export async function GET() {
  const logo = await readFile(join(process.cwd(), "public/icons/decisionate-logo.png"))
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#ffffff", padding: "64px 72px", color: "#151b25", borderBottom: "16px solid #059669" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        {/* ImageResponse renders bitmap assets directly, not next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/png;base64,${logo.toString("base64")}`} width={88} height={88} alt="" />
        <span style={{ fontSize: 64, fontWeight: 700 }}>Decisionate</span>
      </div>
      <div style={{ display: "flex", marginTop: 52, maxWidth: 1020, fontSize: 56, fontWeight: 700, lineHeight: 1.15 }}>Business analytics. Clearer decisions.</div>
      <div style={{ display: "flex", marginTop: 28, maxWidth: 980, fontSize: 30, lineHeight: 1.4, color: "#475569" }}>Sales, marketing and accounting data together. Forecasts, budgets and weekly reports.</div>
      <div style={{ display: "flex", marginTop: "auto", fontSize: 25, color: "#2563eb" }}>decisionate.ca</div>
    </div>,
    { width: 1200, height: 630 },
  )
}
