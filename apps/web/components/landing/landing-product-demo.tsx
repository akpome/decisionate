"use client"

import Link from "next/link"
import { ArrowRight, Play } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useLandingText } from "@/app/use-decisionate-language"

export const productDemoChapters = [
  {
    time: 0,
    label: "Connect"
  },
  {
    time: 10,
    label: "Analyze"
  },
  {
    time: 24,
    label: "Decide"
  },
  {
    time: 38,
    label: "Review"
  }
] as const

export function LandingProductDemo({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingSeek = useRef<number | null>(null)
  const [chapter, setChapter] = useState(0)
  const [hasStarted, setHasStarted] = useState(false)
  const [playbackError, setPlaybackError] = useState(false)
  const [videoWidth, setVideoWidth] = useState<number>()
  const { t, language } = useLandingText()

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // Viewport height can constrain the video to less than its column width.
    const updateVideoWidth = () => {
      setVideoWidth(video.getBoundingClientRect().width)
    }
    const frame = window.requestAnimationFrame(updateVideoWidth)
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(([entry]) => setVideoWidth(entry.contentRect.width))
      : null
    observer?.observe(video)
    if (!observer) window.addEventListener("resize", updateVideoWidth)
    return () => {
      window.cancelAnimationFrame(frame)
      if (!observer) window.removeEventListener("resize", updateVideoWidth)
      observer?.disconnect()
    }
  }, [])

  function play() {
    const video = videoRef.current
    if (!video) return
    setHasStarted(true)
    void video.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return
      setPlaybackError(true)
    })
  }

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
    play()
  }

  return (
    <div className="landing-product-demo">
      <div className="landing-hero-stage">
        {children}
        <div className="landing-demo-frame">
          <video
            ref={videoRef}
            controls={hasStarted}
            playsInline
            preload="none"
            poster="/media/decisionate-demo-poster.webp"
            width={1440}
            height={900}
            aria-label={t("Decisionate product walkthrough")}
            className="landing-product-video scroll-mt-32 bg-white object-contain sm:scroll-mt-24"
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
                productDemoChapters.reduce(
                  (active, item, index) => item.time <= time ? index : active,
                  -1
                )
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
          {!hasStarted && (
            <button
              type="button"
              onClick={play}
              aria-label={t("Play product walkthrough")}
              title={t("Play product walkthrough")}
              className="landing-video-play"
            >
              <Play size={28} fill="currentColor" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="landing-demo-details" style={{ maxWidth: videoWidth }}>
        {playbackError && (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {t(
              "The video could not play. You can still explore the live demo below."
            )}
          </p>
        )}
        <div
          className="landing-demo-chapters"
          aria-label={t("Walkthrough chapters")}
        >
          {productDemoChapters.map((item, index) => (
            <button
              key={item.label}
              type="button"
              onClick={() => seek(item.time, index)}
              aria-label={`${t("Play chapter")}: ${t(item.label)}`}
              aria-current={chapter === index ? "step" : undefined}
              className={`min-h-14 min-w-0 border-t-2 pt-3 text-left text-sm font-semibold text-neutral-950 ${chapter === index ? "landing-brand-chapter" : "border-neutral-200"}`}
            >
              <span className="mb-1 block text-xs font-normal tabular-nums text-neutral-500">
                0:{String(item.time).padStart(2, "0")}
              </span>
              <span className="block whitespace-nowrap">{t(item.label)}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end text-xs leading-5">
          <Link
            href="/demo"
            className="landing-brand-link inline-flex items-center gap-2 font-medium"
          >
            {t("Explore the live demo")}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  )
}
