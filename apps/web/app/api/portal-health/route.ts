import { NextResponse } from "next/server"
import { portalBrand } from "@/lib/portal-brand"

export function GET() {
  if (!portalBrand.id) return new NextResponse(null, { status: 404 })
  return NextResponse.json({ portal_id: portalBrand.id }, { headers: { "Cache-Control": "no-store" } })
}
