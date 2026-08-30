import Link from "next/link"
import Image from "next/image"
import {
  Code2,
  Users,
} from "lucide-react"

export function LandingFooter() {
  return (
    <footer className="bg-slate-950 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2.5 text-white">
            <Image src="/icons/decisionate-icon.svg" alt="" width={32} height={32} className="h-8 w-8" />
            <span className="flex flex-col leading-none">
              <span className="text-[17px] font-bold tracking-tight">Decisionate</span>
              <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Decisions, automated.
              </span>
            </span>
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-6 text-slate-400">
            Decision automation for teams that want to act on evidence and learn from the choices they make.
          </p>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Product</p>
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <a href="#product" className="hover:text-white">Workflow</a>
            <a href="#industries" className="hover:text-white">Industry dashboards</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Resources</p>
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <a href="#resources" className="hover:text-white">Integrations</a>
            <Link href="/demo" className="hover:text-white">Live demo</Link>
            <a href="mailto:support@decisionate.ca" className="hover:text-white">Support</a>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Company</p>
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <Link href="/security" className="hover:text-white">Security</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
            <span className="flex gap-3 pt-1">
              <a href="https://www.linkedin.com" title="Decisionate on LinkedIn" aria-label="Decisionate on LinkedIn" className="hover:text-white"><Users size={16} /></a>
              <a href="https://github.com" title="Decisionate on GitHub" aria-label="Decisionate on GitHub" className="hover:text-white"><Code2 size={16} /></a>
            </span>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-800">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© 2026 Decisionate. All rights reserved.</span>
          <span>Built for clearer decisions and accountable follow-through.</span>
        </div>
      </div>
    </footer>
  )
}
