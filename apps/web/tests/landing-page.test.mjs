import assert from "node:assert/strict"
import { readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path) {
  const { outputText } = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports })
  return loaded.exports
}
const { integrationGroups, faqs } = load(
  "../components/landing/landing-content.ts"
)
const connectors = integrationGroups.flatMap((group) => group.items)
const { refreshedLandingFrench } = load("../lib/landing-translations.ts")

test("pricing and review controls have French labels", () => {
  assert.equal(refreshedLandingFrench.Annual, "Annuel")
  assert.equal(refreshedLandingFrench.Review, "Réviser")
})

test("landing catalog includes every source except all Lightspeed variants", () => {
  const backend = read("../../api/app/modules/datasets/services/sources.py")
    .split("DATASET_SOURCES = [")[1]
    .split("\ndef ")[0]
  const sources = [
    ...backend.matchAll(/"type": "([^"]+)"[\s\S]*?"label": "([^"]+)"/g)
  ].map((match) => ({ type: match[1], name: match[2] }))
  assert.ok(sources.length > 20)
  const expected = sources.filter((item) => !item.type.startsWith("lightspeed"))
  assert.deepEqual(
    Array.from(connectors, (item) => item.type).sort(),
    expected.map((item) => item.type).sort()
  )
  assert.equal(
    new Set(connectors.map((item) => item.type)).size,
    connectors.length
  )
  for (const source of expected)
    assert.equal(
      connectors.find((item) => item.type === source.type)?.name,
      source.name
    )
  assert.equal(
    connectors.some((item) => item.type.startsWith("lightspeed")),
    false
  )
})

test("Sage and Zoho Books are supported, provider approval is still disclosed", () => {
  for (const type of ["sage", "zoho_books"])
    assert.equal(connectors.find((item) => item.type === type)?.note, undefined)
  assert.match(
    connectors.find((item) => item.type === "google_business_profile").note,
    /provider approval/i
  )
  assert.doesNotMatch(
    read("../components/landing/landing-content.ts"),
    /Upcoming/
  )
  const faq = faqs.find(
    (item) => item.question === "How long is connector data kept?"
  )
  assert.match(faq.answer, /three years, then deleted/)
})

test("sign-in and trial actions use the actual authentication routes", () => {
  const nav = read("../components/landing/navbar.tsx")
  assert.match(nav, /href="\/sign-in"/)
  assert.match(nav, /href="\/sign-up"/)
  assert.doesNotMatch(
    nav.match(/className="landing-nav-actions[^\"]*"/)?.[0] ?? "",
    /hidden/
  )
  assert.match(read("../components/landing/hero.tsx"), /href="\/sign-up"/)
  assert.match(
    read("../components/landing/landing-sections.tsx"),
    /href="\/sign-up"/
  )
})

test("the tagline stays in brand lockups while the hero describes the workflow", () => {
  const hero = read("../components/landing/hero.tsx")
  assert.doesNotMatch(hero, /Decisions from Data\./)
  assert.match(hero, /See performance\. Follow through\./)
  assert.equal(refreshedLandingFrench["See performance. Follow through."], "Analysez la performance. Suivez les résultats.")
  for (const file of ["navbar", "footer"])
    assert.match(read(`../components/landing/${file}.tsx`), /Decisions from Data\./)
  assert.match(hero, /href="\/demo"/)
  assert.match(hero, /Explore live demo/)
  assert.match(hero, /onFocus=\{prefetchPublicDemo\}/)
  assert.doesNotMatch(hero, /decisionate-overview|landing-hero-caption|next\/image/)
  assert.doesNotMatch(hero, /Watch the workflow|href="#product"/)
  assert.match(hero, /<LandingProductDemo>/)
  assert.match(hero, /landing-button-accent/)
  assert.doesNotMatch(read("../app/page.tsx"), /ProductWorkflowSection/)
})

test("the video stage fits the first viewport without cropping the product", () => {
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const values = (selector) => {
    const rules = []
    css.walkRules(selector, rule => {
      if (rule.parent.type === "root") rules.push(rule)
    })
    return Object.fromEntries(rules.flatMap(rule => rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])))
  }
  assert.equal(values(".landing-hero-stage")["grid-template-rows"], "auto minmax(0, 1fr)")
  assert.match(values(".landing-hero-stage")["max-height"], /100svh - var\(--landing-nav-height\)/)
  assert.equal(values(".landing-product-video")["max-height"], "100%")
  assert.equal(values(".landing-product-video")["aspect-ratio"], "8 / 5")
  assert.match(read("../components/landing/landing-product-demo.tsx"), /object-contain/)
  assert.equal(values(".landing-page svg.lucide").color, "var(--landing-brand-accent)")
  assert.notEqual(values(".landing-button-accent").background, "var(--landing-brand-accent)")
  assert.equal(values(".landing-video-play").background, "var(--landing-brand-primary)")
  assert.equal(values(".landing-nav-actions > button").background, "var(--landing-brand-primary)")
})

test("desktop copy is vertically centered beside the video with chapters only beneath it", () => {
  const hero = read("../components/landing/hero.tsx")
  assert.doesNotMatch(hero, /text-center|justify-center|items-baseline/)
  const copyClass = hero.match(/className="landing-hero-copy ([^"]+)"/)[1]
  assert.doesNotMatch(copyClass, /hidden|mx-auto/)
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const desktop = css.nodes.find(node => node.type === "atrule" && node.params === "(min-width: 1024px)")
  const declarations = selector => Object.fromEntries(desktop.nodes.find(node => node.selector === selector).nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]))
  assert.equal(declarations(".landing-product-demo,\n  .landing-hero-stage")["grid-template-columns"], "minmax(0, 0.8fr) minmax(0, 1.2fr)")
  assert.equal(declarations(".landing-hero-stage")["align-items"], "center")
  assert.equal(declarations(".landing-hero-intro")["align-self"], "center")
  assert.equal(declarations(".landing-demo-details")["grid-column"], "2")
  assert.equal(declarations(".landing-demo-details")["justify-self"], "end")
  const demo = read("../components/landing/landing-product-demo.tsx")
  assert.ok(demo.indexOf('className="landing-demo-details"') < demo.indexOf('className="landing-demo-chapters'))
  assert.match(demo, /new ResizeObserver/)
  assert.match(demo, /setVideoWidth\(entry\.contentRect\.width\)/)
  assert.match(demo, /maxWidth: videoWidth/)
  assert.match(demo, /observer\.disconnect\(\)/)
  const frame = desktop.nodes.find(node => node.selector === ".landing-demo-frame")
  assert.ok(frame.nodes.some(node => node.prop === "justify-content" && node.value === "flex-end"))
})

test("short landscape screens constrain the video while letting text and chapters flow", () => {
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const landscape = css.nodes.find(node => node.type === "atrule" && node.params === "(max-height: 600px) and (min-width: 541px)")
  const stage = landscape.nodes.find(node => node.selector === ".landing-hero-stage")
  assert.ok(stage.nodes.some(node => node.prop === "max-height" && node.value === "none"))
  const video = landscape.nodes.find(node => node.selector === ".landing-product-video")
  assert.ok(video.nodes.some(node => node.prop === "max-height" && node.value.includes("100svh")))
})

test("public brand marks match the combined name and tagline height", () => {
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const declarations = {}
  css.walkRules(rule => {
    if (rule.parent.type !== "root") return
    declarations[rule.selector] = Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]))
  })
  assert.equal(declarations[".landing-brand-mark"].height, "42px")
  const textHeight = parseInt(declarations[".landing-brand-name"]["line-height"]) + parseInt(declarations[".landing-brand-tagline"]["line-height"]) + parseInt(declarations[".landing-brand-copy"].gap)
  assert.equal(textHeight, 42)
  for (const file of ["navbar", "footer", "policy-page"]) {
    const source = read(`../components/landing/${file}.tsx`)
    assert.match(source, /landing-brand-mark/)
    assert.match(source, /landing-brand-copy/)
  }
})

test("walkthrough is a deferred video with captions, real chapters and a fallback", () => {
  const demo = read("../components/landing/landing-product-demo.tsx")
  assert.match(demo, /preload="none"/)
  assert.match(demo, /controls/)
  assert.match(demo, /controls=\{hasStarted\}/)
  assert.match(demo, /aria-label=\{t\("Play product walkthrough"\)\}/)
  assert.match(demo, /playsInline/)
  assert.match(demo, /kind="captions"/)
  assert.match(demo, /currentTime = time/)
  assert.match(demo, /onLoadedMetadata/)
  assert.match(demo, /pendingSeek\.current = time/)
  assert.match(demo, /scrollIntoView/)
  assert.match(demo, /error\.name === "AbortError"/)
  assert.doesNotMatch(demo, /autoPlay|setInterval|AI recommendation/)
  for (const name of [
    "decisionate-overview.webp",
    "decisionate-overview-mobile.webp",
    "decisionate-demo-poster.webp",
    "decisionate-workflow.webm",
    "decisionate-workflow.en.vtt",
    "decisionate-workflow.fr.vtt"
  ]) {
    assert.ok(
      statSync(new URL(`../public/media/${name}`, import.meta.url)).size > 100
    )
  }
  assert.ok(
    statSync(
      new URL("../public/media/decisionate-workflow.webm", import.meta.url)
    ).size <
      8 * 1024 * 1024
  )
  for (const locale of ["en", "fr"]) {
    const captions = read(`../public/media/decisionate-workflow.${locale}.vtt`)
    assert.match(captions, /^WEBVTT/)
    assert.match(captions, /00:24\.000/)
    assert.match(captions, /00:38\.000/)
  }
})

test("industry links select the corresponding real demo dashboard", () => {
  const sections = read("../components/landing/landing-sections.tsx")
  assert.match(sections, /dashboardDefinitions/)
  assert.match(sections, /\/demo\?dashboard=\$\{item.key\}/)
  assert.doesNotMatch(sections, /Most popular|Trusted by|Upcoming/)
})
