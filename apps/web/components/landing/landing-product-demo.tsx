"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useRef, useState } from "react"
import { useLandingText } from "@/app/use-decisionate-language"

export const productDemoChapters = [
  {
    time: 0,
    label: "Connect",
    description: "Authorize a source, choose an account and sync its data."
  },
  {
    time: 10,
    label: "Analyze",
    description:
      "Choose a dashboard, compare metrics and adjust the chart view."
  },
  {
    time: 24,
    label: "Decide",
    description:
      "Link a decision to its dataset, action, expected outcome and review date."
  },
  {
    time: 38,
    label: "Review",
    description:
      "Record the result and lesson, keeping the evidence with the original decision."
  }
] as const

export function LandingProductDemo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingSeek = useRef<number | null>(null)
  const [chapter, setChapter] = useState(0)
  const [playbackError, setPlaybackError] = useState(false)
  const { t, language } = useLandingText()

  function seek(time: number, index: number) {
    const video = videoRef.current
    if (!video) return
    if (video.readyState >= 1) {
      video.currentTime = time
    } else {
      // Deferred media cannot seek until its metadata has loaded.
      pendingSeek.current = time
    }
    setChapter(index)
    video.scrollIntoView({ block: "start" })
    void video.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return
      setPlaybackError(true)
    })
  }

  return (
    <div className="mt-8">
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="none"
          poster="/media/decisionate-demo-poster.webp"
          width={1440}
          height={900}
          aria-label={t("Decisionate product walkthrough")}
          className="landing-product-video aspect-[8/5] max-h-[calc(100svh-160px)] w-full scroll-mt-32 bg-white object-contain sm:scroll-mt-24"
          onLoadedMetadata={(event) => {
            if (pendingSeek.current !== null) {
              event.currentTarget.currentTime = pendingSeek.current
              pendingSeek.current = null
            }
          }}
          onError={() => setPlaybackError(true)}
          onPlaying={() => setPlaybackError(false)}
          onTimeUpdate={(event) => {
            const time = event.currentTarget.currentTime
            setChapter(
              productDemoChapters.findLastIndex((item) => item.time <= time)
            )
          }}
        >
          <source src="/media/decisionate-workflow.webm" type="video/webm" />
          <track
            key={language}
            kind="captions"
            src={`/media/decisionate-workflow.${language}.vtt`}
            srcLang={language}
            label={language === "fr" ? "Français" : "English"}
            default
          />
          {t("Open the live demo to explore Decisionate.")}
        </video>
      </div>
      {playbackError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t(
            "The video could not play. You can still explore the live demo below."
          )}
        </p>
      )}
      <div
        className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label={t("Walkthrough chapters")}
      >
        {productDemoChapters.map((item, index) => (
          <div
            key={item.label}
            className={`border-t-2 pt-3 ${chapter === index ? "border-teal-700" : "border-neutral-200"}`}
          >
            <button
              type="button"
              onClick={() => seek(item.time, index)}
              aria-label={`${t("Play chapter")}: ${t(item.label)}`}
              aria-current={chapter === index ? "step" : undefined}
              className="inline-flex items-baseline gap-3 text-left font-semibold text-neutral-950"
            >
              <span className="text-xs font-normal tabular-nums text-neutral-500">
                0:{String(item.time).padStart(2, "0")}
              </span>
              {t(item.label)}
            </button>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              {t(item.description)}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-neutral-500">
          {t(
            "Recorded in Decisionate with sample data. No live customer information."
          )}
        </p>
        <Link
          href="/demo"
          className="inline-flex items-center gap-2 font-medium text-teal-800"
        >
          {t("Explore the live demo")}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
