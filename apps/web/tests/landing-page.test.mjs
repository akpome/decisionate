import assert from "node:assert/strict"
import { readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")

function load(path, overrides = {}) {
  const { outputText } = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, {
    module: loaded,
    exports: loaded.exports,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : require(name),
  })
  return loaded.exports
}

const { integrationGroups, faqs } = load("../components/landing/landing-content.ts")
const connectors = integrationGroups.flatMap(group => group.items)
const { refreshedLandingFrench } = load("../lib/landing-translations.ts")
const headline = "Decisionate"
const productSummary = "Analyze accounting, sales and marketing data together. Compare selected metrics across datasets, investigate relationships and unusual changes, then track the action you choose."
const automationSummary = "Save a cross-dataset report for weekly reviews. Enable weekly report delivery and KPI alerts by email when you are ready."
const agencySummary = "Create branded workspaces for your clients. Clients connect and manage their own data; your agency helps them understand performance, coordinate actions and track results with client-approved access."

function renderHero(language = "en") {
  const overrides = {
    "next/link": { default: props => React.createElement("a", Object.fromEntries(Object.entries(props).filter(([key]) => key !== "prefetch"))) },
    "@/app/use-decisionate-language": {
      useLandingText: () => ({ language, t: text => language === "fr" ? refreshedLandingFrench[text] || text : text }),
    },
    "@/features/demo/lib/demo-data": { prefetchPublicDemo: () => {} },
  }
  overrides["./landing-product-demo"] = load("../components/landing/landing-product-demo.tsx", overrides)
  const { LandingHero } = load("../components/landing/hero.tsx", overrides)
  return renderToStaticMarkup(React.createElement(LandingHero))
}

function renderSections(language = "en") {
  const overrides = {
    "next/link": { default: props => React.createElement("a", props) },
    "@/app/use-decisionate-language": {
      useLandingText: () => ({ language, t: text => language === "fr" ? refreshedLandingFrench[text] || text : text }),
    },
    "@/features/dashboards/dashboard-definitions": load("../features/dashboards/dashboard-definitions.ts"),
    "./landing-content": { integrationGroups, faqs },
  }
  const sections = load("../components/landing/landing-sections.tsx", overrides)
  return renderToStaticMarkup(React.createElement(React.Fragment, null,
    ...["BusinessSection", "AgencySection", "FeaturesSection", "IntegrationsSection", "PricingSection", "FAQSection"]
      .map(name => React.createElement(sections[name], { key: name }))
  ))
}

test("landing catalog includes every source except all Lightspeed variants", () => {
  const backend = read("../../api/app/modules/datasets/services/sources.py").split("DATASET_SOURCES = [")[1].split("\ndef ")[0]
  const sources = [...backend.matchAll(/"type": "([^"]+)"[\s\S]*?"label": "([^"]+)"/g)].map(match => ({ type: match[1], name: match[2] }))
  assert.ok(sources.length > 20)
  const expected = sources.filter(item => !item.type.startsWith("lightspeed"))
  assert.deepEqual(Array.from(connectors, item => item.type).sort(), expected.map(item => item.type).sort())
  assert.equal(new Set(connectors.map(item => item.type)).size, connectors.length)
  for (const source of expected) assert.equal(connectors.find(item => item.type === source.type)?.name, source.name)
})

test("supported connectors and provider-approval disclosures are preserved", () => {
  for (const type of ["sage", "zoho_books"]) assert.equal(connectors.find(item => item.type === type)?.note, undefined)
  assert.match(connectors.find(item => item.type === "google_business_profile").note, /provider approval/i)
  assert.doesNotMatch(read("../components/landing/landing-content.ts"), /Upcoming/)
  assert.match(faqs.find(item => item.question === "How long is connector data kept?").answer, /three years, then deleted/)
})

test("hero renders one brand headline and one copy instance in both languages", () => {
  for (const language of ["en", "fr"]) {
    const html = renderHero(language)
    const translated = text => language === "fr" ? refreshedLandingFrench[text] : text
    assert.equal((html.match(/<h1\b/g) || []).length, 1)
    for (const copy of [headline, productSummary, automationSummary]) {
      assert.ok(refreshedLandingFrench[copy], `Missing French translation: ${copy}`)
      const expected = renderToStaticMarkup(React.createElement(React.Fragment, null, translated(copy)))
      assert.ok(html.includes(expected), `Missing ${language} copy: ${copy}`)
    }
    assert.equal((html.match(/landing-hero-copy /g) || []).length, 1)
    assert.equal((html.match(/landing-hero-automation /g) || []).length, 1)
    assert.doesNotMatch(html, /Insights from existing|Decisions from Data|landing-hero-more|landing-hero-team/)
    assert.ok(html.indexOf("landing-hero-intro") < html.indexOf("landing-product-demo"))
    assert.equal((html.match(/<video\b/g) || []).length, 1)
  }
})

test("trial wording matches no-card onboarding and emails remain opt-in", () => {
  assert.match(read("../../api/app/modules/billing/service.py"), /TRIAL_PERIOD_DAYS = 30/)
  assert.match(read("../../api/app/modules/organizations/router.py"), /trial_start \+ timedelta\(days=TRIAL_PERIOD_DAYS\)/)
  assert.match(read("../../api/app/modules/alerts/router.py"), /enabled=False/)
  const html = renderHero()
  assert.match(html, /Start your 30-day trial/)
  assert.match(html, /Enable weekly report delivery and KPI alerts by email when you are ready/)
  assert.match(html, /No credit card required\./)
  assert.ok(html.indexOf("landing-hero-note") > html.indexOf("Explore live demo"))
  assert.match(html, /href="\/sign-up"/)
  assert.match(html, /href="\/demo"/)
  const hero = read("../components/landing/hero.tsx")
  for (const event of ["onFocus", "onPointerEnter", "onTouchStart"]) assert.match(hero, new RegExp(`${event}=\\{prefetchPublicDemo\\}`))
})

test("mobile menu owns auth links and retains keyboard dismissal with focus restoration", () => {
  const nav = read("../components/landing/navbar.tsx")
  const menu = nav.slice(nav.indexOf('id="landing-mobile-navigation"'))
  for (const route of ["/sign-in", "/sign-up", "/demo"]) assert.ok(menu.includes(`href="${route}"`))
  assert.match(nav, /aria-expanded=\{menuOpen\}/)
  assert.match(nav, /aria-controls="landing-mobile-navigation"/)
  assert.match(menu, /hidden=\{!menuOpen\}/)
  assert.match(nav, /event\.key === "Escape" && menuOpen/)
  assert.match(nav, /menuButtonRef\.current\?\.focus\(\)/)
  assert.match(nav, /\}, \[menuOpen\]\)/)
  assert.match(menu, /onClick=\{\(\) => setMenuOpen\(false\)\}/)
  const css = read("../components/landing/landing.css")
  assert.match(css, /\.landing-nav \.landing-desktop-auth\s*\{\s*display: none/)
  assert.match(css, /@media \(min-width: 1280px\)[\s\S]*\.landing-nav \.landing-desktop-auth\s*\{\s*display: inline-flex/)
  assert.doesNotMatch(css, /landing-sign-in\s*\{[^}]*grid-row: 2/)
})

test("business and agency sections precede the evidence and action section", () => {
  const hero = read("../components/landing/hero.tsx")
  assert.doesNotMatch(hero, /agency|client workspaces|teamSummary/)
  const sections = read("../components/landing/landing-sections.tsx")
  assert.match(sections, /Keep the evidence close to the action\./)
  assert.ok(sections.includes(agencySummary))
  assert.match(sections, /Help every client move from data to action\./)
  assert.ok(refreshedLandingFrench[agencySummary])
  assert.doesNotMatch(sections, /audience ===|Workspace type|Manage your agency and client workspaces separately/)
  const page = read("../app/page.tsx")
  const order = ["BusinessSection", "AgencySection", "FeaturesSection", "IntegrationsSection", "PricingSection", "FAQSection"]
    .map(name => page.indexOf(`<${name} />`))
  assert.ok(order.every(index => index >= 0))
  assert.ok(order.every((index, position) => !position || index > order[position - 1]))
  assert.match(page, /<AgencySection \/>\s*<FeaturesSection \/>/)
})

test("business and agency sections are explicitly labelled and all content bands alternate", () => {
  const html = renderSections()
  assert.match(html, /For businesses/)
  assert.match(html, /For agencies/)
  assert.match(html, /aria-labelledby="landing-business-heading"/)
  assert.match(html, /aria-labelledby="landing-agency-heading"/)
  const backgrounds = [...html.matchAll(/<section\b[^>]*class="([^"]+)"/g)]
    .map(match => match[1].split(" ").find(value => value === "bg-white" || value === "bg-neutral-50"))
  assert.deepEqual(backgrounds, ["bg-neutral-50", "bg-white", "bg-neutral-50", "bg-white", "bg-neutral-50", "bg-white"])
  assert.match(html, /<article[^>]*class="[^"]*bg-white/)
})

test("agency plan, permissions and four-step workflow are described in both languages", () => {
  const copy = [
    "One workspace for your business.",
    "Connect your business tools or upload files. Use Reports to compare marketing, sales and financial performance across datasets, with the date fields and dimension filters that fit your question.",
    "Professional includes one business workspace, all industry dashboards and decision management. Keep your team's data, reports, actions and review dates together.",
    "Agency includes your agency workspace and up to 10 client workspaces, all Professional features and a shared AI credit allowance. Paid add-on workspaces let you expand as your agency grows.",
    "Create and brand your agency",
    "Choose Agency during workspace setup, then add your agency name, logo and brand colours. Client workspaces carry your branding.",
    agencySummary,
    "Create workspaces and invite clients",
    "Your agency creates a separate workspace for each client and invites their client owner. Each workspace supports one client owner and one client user, with role-based access.",
    "Clients connect and manage their data",
    "Clients authorize their own business tools for daily or weekly syncing, or upload files. They manage their datasets and connections; your agency does not connect or manage their data.",
    "Review performance and follow through",
    "With client-approved access, compare selected metrics across each client's datasets and record agreed actions in Decisions. Enable agency-branded weekly reports and KPI alerts by email, then review outcomes together."
  ]
  for (const language of ["en", "fr"]) {
    const html = renderSections(language)
    for (const text of copy) {
      assert.ok(refreshedLandingFrench[text], `Missing French copy: ${text}`)
      const expected = renderToStaticMarkup(React.createElement(React.Fragment, null, language === "fr" ? refreshedLandingFrench[text] : text))
      assert.ok(html.includes(expected), `Missing ${language} content: ${text}`)
    }
    const workflow = html.match(/<ol\b[^>]*>[\s\S]*?<\/ol>/)[0]
    assert.equal((workflow.match(/<li\b/g) || []).length, 4)
    assert.match(html, /href="#pricing"/)
    assert.match(html, /href="\/sign-up"/)
    assert.match(html, /href="\/demo\?dashboard=/)
  }
  const backend = read("../../api/app/modules/organizations/router.py")
  assert.match(backend, /A client workspace can have only one client owner/)
  assert.match(backend, /A client workspace can have only one client user/)
})

test("agency workflow assigns data connections and management to the client", () => {
  const html = renderSections()
  assert.match(html, /Clients connect and manage their data/)
  assert.match(html, /Clients authorize their own business tools/)
  assert.match(html, /your agency does not connect or manage their data/)
  assert.match(html, /With client-approved access/)
  assert.doesNotMatch(read("../components/landing/landing-sections.tsx"), /Connect each client's data|Connect business tools for daily or weekly syncing/)
})

test("landing explains cross-dataset Reports and selected evidence rather than a separate Insights workspace", () => {
  const about = faqs.find(item => item.question === "What is Decisionate?").answer
  const multi = faqs.find(item => item.question === "Can I combine data from more than one dataset?").answer
  assert.match(about, /Reports brings selected metrics, relationships and unusual changes together/)
  assert.match(about, /dashboards inspect individual datasets/)
  for (const pattern of [/two or more datasets/, /date column and dimension filters/, /shared baseline of 100/, /individual metric pairs/, /not proof of causation/, /does not automatically record a business action/]) {
    assert.match(multi, pattern)
  }
  const html = renderSections()
  assert.match(html, /Bring selected report evidence into Decisions/)
  assert.doesNotMatch(html, /explore AI-assisted insights|A view you can question/)
  const metadata = read("../app/layout.tsx")
  assert.match(metadata, /Analyze business performance across datasets/)
})

test("landing explains source filtering, seasonal validation and explicitly enabled weekly reports", () => {
  const upload = faqs.find(item => item.question === "Can I upload files?").answer
  const seasonal = faqs.find(item => item.question === "Do reports and forecasts account for seasonality?").answer
  const weekly = faqs.find(item => item.question === "What is included in a weekly report?").answer
  assert.match(upload, /selected unique values in a dimension column/)
  assert.match(seasonal, /enough suitable history supports validation/)
  assert.match(seasonal, /does not guarantee an accurate result/)
  for (const pattern of [/enable delivery in Alerts/, /latest complete week/, /three years of available history/, /dimension filters and seasonal setting/, /unusual-change checks/, /Manual report dates do not restrict/]) {
    assert.match(weekly, pattern)
  }
  const retention = faqs.find(item => item.question === "How long is connector data kept?").answer
  assert.match(retention, /90 days/)
  assert.match(retention, /background chunks/)
  assert.match(retention, /Provider permissions and history limits can reduce coverage/)
  assert.match(retention, /does not delete its source datasets or linked decisions/)
  assert.match(read("../../api/app/modules/datasets/router.py"), /INITIAL_CONNECTOR_SYNC_DAYS = 90/)
})

test("every landing FAQ answer and updated feature is available in French", () => {
  for (const { answer } of faqs) {
    assert.ok(refreshedLandingFrench[answer], `Missing French FAQ: ${answer}`)
  }
  for (const language of ["en", "fr"]) {
    const html = renderSections(language)
    for (const text of [
      "Analysis across your datasets",
      "Choose metrics, date columns and dimension values from different datasets. Compare indexed trends, investigate relationships and check unusual changes in one report.",
      "Bring selected report evidence into Decisions. Record the action and expected result, set a review date, then capture the outcome and lesson.",
      "Where supported, initial imports cover 90 days. Older available history is loaded in background chunks, up to three years. Provider permissions and history limits apply.",
      "Do reports and forecasts account for seasonality?",
      "What is included in a weekly report?",
    ]) {
      assert.ok(refreshedLandingFrench[text], `Missing French feature: ${text}`)
      const copy = language === "fr" ? refreshedLandingFrench[text] : text
      assert.ok(html.includes(renderToStaticMarkup(React.createElement(React.Fragment, null, copy))))
    }
  }
})

test("desktop columns and stacked mobile content use normal flow rather than CTA spacers", () => {
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const values = selector => Object.fromEntries(css.nodes.filter(node => node.selector === selector).flatMap(rule => rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])))
  assert.equal(values(".landing-hero-cta")["margin-top"], "28px")
  assert.equal(values(".landing-hero-note")["margin-top"], "8px")
  assert.equal(values(".landing-product-video")["aspect-ratio"], "8 / 5")
  assert.equal(values(".landing-product-video").width, "100%")
  assert.equal(values(".landing-demo-chapters")["grid-template-columns"], "repeat(4, minmax(0, 1fr))")
  assert.equal(values(".landing-page svg.lucide").color, "var(--landing-brand-accent)")
  const desktop = css.nodes.find(node => node.type === "atrule" && node.params === "(min-width: 1024px)")
  assert.ok(desktop.nodes.find(node => node.selector === ".landing-hero-stage").nodes.some(node => node.prop === "grid-template-columns"))
  assert.doesNotMatch(css.toString(), /display: contents|landing-hero-more|landing-hero-team|max-height: calc\(100svh/)
  assert.equal(values(".landing-button")["min-height"], "44px")
})

test("demo introduction, chapter controls and supplemental link remain accessible", () => {
  const html = renderHero()
  assert.match(html, /<h2[^>]*id="landing-demo-heading"/)
  assert.match(html, /See Decisionate in action/)
  assert.match(html, /From connecting your data to making decisions and reviewing outcomes\./)
  for (const [label, time] of [["Connect", 0], ["Analyze", 10], ["Decide", 24], ["Review", 38]]) {
    assert.ok(html.includes(`aria-label="${label}, jump to ${time} seconds"`))
  }
  assert.match(html, /aria-current="step"/)
  assert.match(html, /href="\/demo"[^>]*class="landing-brand-link/)
})

test("public brand marks retain the combined name and tagline height", () => {
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const declarations = {}
  css.walkRules(rule => {
    if (rule.parent.type === "root") declarations[rule.selector] = Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]))
  })
  assert.equal(declarations[".landing-brand-mark"].height, "42px")
  assert.equal(parseInt(declarations[".landing-brand-name"]["line-height"]) + parseInt(declarations[".landing-brand-tagline"]["line-height"]) + parseInt(declarations[".landing-brand-copy"].gap), 42)
  for (const file of ["navbar", "footer", "policy-page"]) assert.match(read(`../components/landing/${file}.tsx`), /landing-brand-copy/)
})

test("walkthrough preserves deferred playback, caption assets, chapter seeking and fallback", () => {
  const demo = read("../components/landing/landing-product-demo.tsx")
  for (const pattern of [/preload="none"/, /controls=\{hasStarted\}/, /playsInline/, /kind="captions"/, /currentTime = time/, /pendingSeek\.current = time/, /onLoadedMetadata/, /scrollIntoView/, /error\.name === "AbortError"/]) assert.match(demo, pattern)
  assert.doesNotMatch(demo, /autoPlay|setInterval/)
  for (const name of ["decisionate-demo-poster.webp", "decisionate-workflow.webm", "decisionate-workflow.en.vtt", "decisionate-workflow.fr.vtt"]) {
    assert.ok(statSync(new URL(`../public/media/${name}`, import.meta.url)).size > 100)
  }
  assert.ok(statSync(new URL("../public/media/decisionate-workflow.webm", import.meta.url)).size < 8 * 1024 * 1024)
  for (const locale of ["en", "fr"]) {
    const captions = read(`../public/media/decisionate-workflow.${locale}.vtt`)
    assert.match(captions, /^WEBVTT/)
    for (const time of ["00:10.000", "00:24.000", "00:38.000"]) assert.ok(captions.includes(time))
  }
  const { imageSize } = require("next/dist/compiled/image-size")
  const poster = imageSize(readFileSync(new URL("../public/media/decisionate-demo-poster.webp", import.meta.url)))
  assert.equal(poster.width, Number(demo.match(/width=\{(\d+)\}/)[1]))
  assert.equal(poster.height, Number(demo.match(/height=\{(\d+)\}/)[1]))
})

test("industry links select the corresponding demo dashboard and pricing retains translation", () => {
  const sections = read("../components/landing/landing-sections.tsx")
  assert.match(sections, /dashboardDefinitions/)
  assert.match(sections, /\/demo\?dashboard=\$\{item.key\}/)
  assert.doesNotMatch(sections, /Most popular|Trusted by|Upcoming/)
  assert.equal(refreshedLandingFrench.Annual, "Annuel")
  assert.equal(refreshedLandingFrench.Review, "Réviser")
})
