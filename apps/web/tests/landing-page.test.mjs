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

test("the tagline stays in brand lockups while the hero describes business-data insights", () => {
  const hero = read("../components/landing/hero.tsx")
  assert.doesNotMatch(hero, /Decisions from Data\./)
  assert.match(hero, /Insights from existing business data\./)
  assert.doesNotMatch(hero, /Find insights in your existing business data\./)
  assert.doesNotMatch(hero, /See performance\. Follow through\./)
  assert.equal(refreshedLandingFrench["Insights from existing business data."], "Enseignements issus des données d'entreprise existantes.")
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

test("the first-screen message explains the inputs, insights and follow-through in both languages", () => {
  const hero = read("../components/landing/hero.tsx")
  const copy = hero.match(/const productSummary = t\(\s*"([^\"]+)"/)[1]
  for (const benefit of [
    "accounting, sales and marketing",
    "upload spreadsheets",
    "Spot trends",
    "AI-assisted insights",
    "Build reports",
    "record decisions",
    "assign actions",
    "track outcomes",
    "one workspace"
  ]) assert.ok(copy.includes(benefit), `Missing first-screen benefit: ${benefit}`)
  assert.ok(copy.split(/\s+/).length <= 35, "Keep the hero message concise")
  const french = refreshedLandingFrench[copy]
  assert.ok(french, "The updated hero needs a French translation")
  assert.ok(french.split(/\s+/).length <= 50, "Keep the French hero message concise too")
  for (const benefit of ["tableurs", "IA", "rapports", "décisions", "actions attribuées", "résultats"])
    assert.ok(french.includes(benefit), `Missing French benefit: ${benefit}`)
  assert.match(hero, /Start your 30-day trial/)
  assert.match(hero, /No credit card required\./)
})

test("hero copy steps down by purpose and trial reassurance follows the action row", () => {
  const hero = read("../components/landing/hero.tsx")
  assert.match(hero, /className="landing-hero-cta"/)
  assert.ok(hero.indexOf('className="landing-hero-note ') > hero.indexOf('className="landing-hero-actions '))
  assert.match(hero, /<\/Link>\s*<\/div>\s*<p className="landing-hero-note /)
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const declarations = (parent, selector) => Object.fromEntries(parent.nodes.find(node => node.selector === selector).nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]))
  const sizes = [
    ".landing-hero-copy,\n.landing-hero-copy-mobile,\n.landing-hero-copy-compact",
    ".landing-hero-automation,\n.landing-hero-automation-mobile",
    ".landing-hero-team,\n.landing-hero-team-mobile"
  ].map(selector => parseInt(declarations(css, selector)["font-size"]))
  assert.deepEqual(sizes, [16, 15, 14])
  const wide = css.nodes.find(node => node.type === "atrule" && node.params === "(min-width: 1200px)")
  assert.equal(declarations(wide, ".landing-hero-copy")["font-size"], "18px")
  assert.equal(declarations(wide, ".landing-hero-automation")["font-size"], "16px")
  const cta = declarations(css, ".landing-hero-cta")
  assert.equal(cta.display, "flex")
  assert.equal(cta["flex-direction"], "column")
  assert.equal(cta.gap, "8px")
  assert.equal(cta["flex-shrink"], "0")
  assert.ok(!css.nodes.some(node => node.selector === ".landing-hero-note"), "Reassurance remains in normal flow on stacked mobile layouts")
})

test("small portrait screens get a compact overview without losing the fuller workflow details", () => {
  const hero = read("../components/landing/hero.tsx")
  const compact = hero.match(/const compactSummary = t\(\s*"([^"]+)"/)[1]
  assert.ok(compact.split(/\s+/).length <= 20)
  assert.ok(refreshedLandingFrench[compact])
  assert.match(hero, /className="landing-hero-copy-compact /)
  assert.ok(hero.indexOf('className="landing-hero-copy-mobile') > hero.indexOf("</LandingProductDemo>"))
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const tiny = css.nodes.find(node => node.type === "atrule" && node.params === "(max-height: 600px) and (max-width: 360px)")
  assert.ok(tiny.nodes.find(node => node.selector === ".landing-hero-copy").nodes.some(node => node.prop === "display" && node.value === "none"))
  assert.ok(tiny.nodes.find(node => node.selector === ".landing-hero-copy-compact,\n  .landing-hero-copy-mobile").nodes.some(node => node.prop === "display" && node.value === "block"))
})

test("automation benefits fill the desktop hero gap and remain available below the mobile demo", () => {
  const hero = read("../components/landing/hero.tsx")
  const summary = hero.match(/const automationSummary = t\(\s*"([^"]+)"/)[1]
  for (const benefit of ["Automatic daily syncing", "Weekly performance reports", "KPI alerts", "email"])
    assert.ok(summary.includes(benefit), `Missing automation benefit: ${benefit}`)
  assert.ok(summary.split(/\s+/).length <= 25, "Keep the automation summary concise")
  const french = refreshedLandingFrench[summary]
  assert.ok(french, "The automation summary needs a French translation")
  for (const benefit of ["quotidienne automatique", "hebdomadaires", "KPI", "courriel"])
    assert.ok(french.includes(benefit), `Missing French automation benefit: ${benefit}`)
  assert.ok(french.split(/\s+/).length <= 25)
  assert.match(hero, /className="landing-hero-automation /)
  assert.match(hero, /className="landing-hero-automation-mobile /)
  assert.equal((hero.match(/\{automationSummary\}/g) ?? []).length, 2)
  assert.ok(hero.indexOf('className="landing-hero-automation ') < hero.indexOf('className="landing-hero-actions'))
  assert.ok(hero.indexOf('className="landing-hero-automation-mobile') > hero.indexOf("</LandingProductDemo>"))
})

test("team and agency benefits stay concise, translated and available on smaller screens", () => {
  const hero = read("../components/landing/hero.tsx")
  const summary = hero.match(/const teamSummary = t\(\s*"([^"]+)"/)[1]
  for (const benefit of ["Work together", "business workspace", "client workspaces", "agency's branding", "role-based access"])
    assert.ok(summary.includes(benefit), `Missing team benefit: ${benefit}`)
  assert.ok(summary.split(/\s+/).length <= 25)
  const french = refreshedLandingFrench[summary]
  assert.ok(french, "The team summary needs a French translation")
  assert.ok(french.split(/\s+/).length <= 30)
  assert.equal((hero.match(/\{teamSummary\}/g) ?? []).length, 2)
  assert.equal((hero.match(/\{productSummary\}/g) ?? []).length, 2)
  assert.ok(hero.indexOf('className="landing-hero-team ') < hero.indexOf('className="landing-hero-actions'))
  assert.ok(hero.indexOf('className="landing-hero-team-mobile') > hero.indexOf("</LandingProductDemo>"))
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
  assert.equal(values(".landing-product-video")["object-position"], "center bottom")
  assert.match(read("../components/landing/landing-product-demo.tsx"), /object-contain/)
  assert.equal(values(".landing-page svg.lucide").color, "var(--landing-brand-accent)")
  assert.notEqual(values(".landing-button-accent").background, "var(--landing-brand-accent)")
  assert.equal(values(".landing-video-play").background, "#fff")
  assert.equal(values(".landing-video-play").color, "var(--landing-brand-primary)")
  assert.equal(values(".landing-nav-actions > button").background, undefined)
  assert.equal(values(".landing-page .landing-nav-actions > button svg.lucide,\n.landing-page .landing-video-play svg.lucide").color, "inherit")
})

test("all four chapters stay in one row without the removed explanatory copy", () => {
  const demo = read("../components/landing/landing-product-demo.tsx")
  assert.doesNotMatch(demo, /Authorize a source|Recorded in Decisionate|\.description|grid-cols-2/)
  assert.match(demo, /landing-demo-chapters/)
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const grids = []
  css.walkRules(".landing-demo-chapters", rule => {
    grids.push(...rule.nodes.filter(node => node.prop === "grid-template-columns").map(node => node.value))
  })
  assert.deepEqual(grids, ["repeat(4, minmax(0, 1fr))"])
  const narrow = css.nodes.find(node => node.type === "atrule" && node.name === "container" && node.params === "(max-width: 360px)")
  assert.ok(narrow.nodes.some(node => node.selector === ".landing-demo-chapters button"))
})

test("desktop heading and buttons anchor to the video edges with reassurance beneath them", () => {
  const hero = read("../components/landing/hero.tsx")
  assert.doesNotMatch(hero, /text-center|justify-center|items-baseline/)
  const copyClass = hero.match(/className="landing-hero-copy ([^"]+)"/)[1]
  assert.doesNotMatch(copyClass, /hidden|mx-auto/)
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const desktop = css.nodes.find(node => node.type === "atrule" && node.params === "(min-width: 1024px)")
  const aligned = css.nodes.find(node => node.type === "atrule" && node.params === "(min-width: 1024px), (max-height: 600px) and (min-width: 541px)")
  const declarations = selector => Object.fromEntries(aligned.nodes.find(node => node.selector === selector).nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]))
  const grid = desktop.nodes.find(node => node.selector === ".landing-product-demo,\n  .landing-hero-stage")
  assert.ok(grid.nodes.some(node => node.prop === "grid-template-columns" && node.value === "minmax(0, 0.8fr) minmax(0, 1.2fr)"))
  assert.equal(declarations(".landing-hero-stage")["align-items"], "end")
  assert.equal(declarations(".landing-hero-stage")["grid-template-rows"], "auto")
  assert.equal(declarations(".landing-hero-stage")["max-height"], "none")
  assert.equal(declarations(".landing-hero-intro")["align-self"], "stretch")
  assert.equal(declarations(".landing-hero-intro").display, "flex")
  assert.equal(declarations(".landing-hero-intro")["flex-direction"], "column")
  assert.equal(declarations(".landing-hero-message")["margin-block"], "0")
  assert.equal(declarations(".landing-hero-intro").gap, "16px")
  const message = css.nodes.find(node => node.selector === ".landing-hero-message,\n.landing-hero-more")
  assert.ok(message.nodes.some(node => node.prop === "gap" && node.value === "16px"))
  for (const selector of [".landing-hero-copy", ".landing-hero-automation", ".landing-hero-team"]) {
    css.walkRules(selector, rule => assert.ok(!rule.nodes.some(node => node.prop?.startsWith("margin")), `${selector} must not introduce inconsistent paragraph spacing`))
  }
  assert.equal(declarations(".landing-hero-cta")["margin-top"], "auto")
  assert.equal(declarations(".landing-hero-cta").position, "relative")
  assert.equal(declarations(".landing-hero-note").position, "absolute")
  assert.equal(declarations(".landing-hero-note").top, "calc(100% + 8px)")
  assert.equal(declarations(".landing-hero-note").width, "100%")
  assert.equal(declarations(".landing-hero-actions")["align-items"], "flex-end")
  assert.equal(declarations(".landing-hero-actions")["flex-wrap"], "nowrap")
  assert.equal(declarations(".landing-demo-details")["grid-column"], "2")
  assert.equal(declarations(".landing-demo-details")["justify-self"], "end")
  const demo = read("../components/landing/landing-product-demo.tsx")
  assert.ok(demo.indexOf('className="landing-demo-details"') < demo.indexOf('className="landing-demo-chapters'))
  assert.match(demo, /new ResizeObserver/)
  assert.match(demo, /setVideoWidth\(entry\.contentRect\.width\)/)
  assert.match(demo, /maxWidth: videoWidth/)
  assert.match(demo, /observer\.disconnect\(\)/)
  const frame = aligned.nodes.find(node => node.selector === ".landing-demo-frame")
  assert.ok(frame.nodes.some(node => node.prop === "justify-content" && node.value === "flex-end"))
})

test("compact desktop and landscape actions retain the shared video baseline", () => {
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const compact = css.nodes.find(node => node.type === "atrule" && node.params === "(min-width: 1024px) and (max-width: 1199px)")
  const shortLabel = compact.nodes.find(node => node.selector === ".landing-trial-short")
  assert.ok(shortLabel.nodes.some(node => node.prop === "display" && node.value === "inline"))
  const landscape = css.nodes.find(node => node.type === "atrule" && node.params === "(max-height: 600px) and (min-width: 541px)")
  assert.ok(!landscape.nodes.some(node => node.selector === ".landing-hero-intro" || node.selector === ".landing-hero-note"))
  const cta = landscape.nodes.find(node => node.selector === ".landing-hero-cta")
  assert.ok(cta.nodes.some(node => node.prop === "margin-top" && node.value === "auto"))
  const actions = landscape.nodes.find(node => node.selector === ".landing-hero-actions")
  assert.ok(!actions.nodes.some(node => node.prop === "flex-wrap" && node.value === "wrap"))
})

test("short landscape screens constrain the video while letting text and chapters flow", () => {
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const landscape = css.nodes.find(node => node.type === "atrule" && node.params === "(max-height: 600px) and (min-width: 541px)")
  const video = landscape.nodes.find(node => node.selector === ".landing-product-video")
  assert.ok(video.nodes.some(node => node.prop === "max-height" && node.value.includes("100svh")))
  const benefits = landscape.nodes.find(node => node.selector === ".landing-hero-automation,\n  .landing-hero-team")
  assert.ok(benefits.nodes.some(node => node.prop === "display" && node.value === "none"))
  const narrow = css.nodes.find(node => node.type === "atrule" && node.params === "(max-height: 600px) and (min-width: 541px) and (max-width: 819px), (max-height: 360px) and (min-width: 541px) and (max-width: 1023px)")
  assert.ok(narrow.nodes.find(node => node.selector === ".landing-hero-copy-mobile").nodes.some(node => node.prop === "display" && node.value === "block"))
  const shortPhone = css.nodes.find(node => node.type === "atrule" && node.params === "(max-height: 360px) and (min-width: 541px) and (max-width: 639px)")
  assert.ok(shortPhone.nodes.find(node => node.selector === ".landing-hero-title").nodes.some(node => node.prop === "font-size" && node.value === "28px"))
  assert.ok(shortPhone.nodes.find(node => node.selector === ".landing-hero-subtitle").nodes.some(node => node.prop === "font-size" && node.value === "16px"))
})

test("secondary hero details only join the first row when both languages have room", () => {
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const wide = css.nodes.find(node => node.type === "atrule" && node.params === "(min-width: 1280px)")
  assert.ok(wide.nodes.find(node => node.selector === ".landing-hero-team").nodes.some(node => node.prop === "display" && node.value === "block"))
  assert.ok(wide.nodes.find(node => node.selector === ".landing-hero-more").nodes.some(node => node.prop === "display" && node.value === "none"))
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

test("the demo poster matches the recording dimensions without an empty band", () => {
  const { imageSize } = require("next/dist/compiled/image-size")
  const poster = imageSize(readFileSync(new URL("../public/media/decisionate-demo-poster.webp", import.meta.url)))
  const demo = read("../components/landing/landing-product-demo.tsx")
  assert.equal(poster.width, Number(demo.match(/width=\{(\d+)\}/)[1]))
  assert.equal(poster.height, Number(demo.match(/height=\{(\d+)\}/)[1]))
})

test("industry links select the corresponding real demo dashboard", () => {
  const sections = read("../components/landing/landing-sections.tsx")
  assert.match(sections, /dashboardDefinitions/)
  assert.match(sections, /\/demo\?dashboard=\$\{item.key\}/)
  assert.doesNotMatch(sections, /Most popular|Trusted by|Upcoming/)
})
