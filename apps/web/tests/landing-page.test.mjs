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

test("landing navigation uses the same subtle divider as the page sections", () => {
  assert.match(read("../components/landing/navbar.tsx"), /landing-nav[^\n]+border-b border-neutral-200/)
  const sheet = require("postcss").parse(read("../components/landing/landing.css"))
  sheet.walkRules(".landing-nav", rule => rule.walkDecls("border-bottom", declaration => {
    assert.doesNotMatch(declaration.value, /brand-accent|2px|3px/)
  }))
})

function load(path, overrides = {}) {
  const { outputText } = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, {
    module: loaded,
    exports: loaded.exports,
    require: name => name === "@/lib/decisionate-domains" ? domains
      : Object.hasOwn(overrides, name) ? overrides[name] : require(name),
  })
  return loaded.exports
}

const { integrationGroups, faqs } = load("../components/landing/landing-content.ts")
const domains = load("../lib/decisionate-domains.ts")
const connectors = integrationGroups.flatMap(group => group.items)
const { refreshedLandingFrench } = load("../lib/landing-translations.ts")
const headline = "Decisionate"
const promise = "Decide what to change this week. See whether it helped."
const productSummary = "Sales are up. Is profit up too? Bring your sales, marketing and accounting figures together to answer questions like this. Record what you'll try and when you'll check the result."
const retentionExample = "Check how many customers make a second purchase within 30, 60 or 90 days. Use what you learn to choose when to send a reminder."
const demoQuestion = "Which ads earned more per dollar? See the numbers, choose one change to test, and decide when to review it."
const agencySummary = "Give each client a private workspace in a portal carrying your agency's name and logo. With their permission, review the numbers together, agree on the next step and revisit the result at your next meeting."

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

function renderSections(language = "en", catalog) {
  const overrides = {
    "next/link": { default: props => React.createElement("a", props) },
    "@/app/use-decisionate-language": {
      useLandingText: () => ({ language, t: text => language === "fr" ? refreshedLandingFrench[text] || text : text }),
    },
    "@/features/dashboards/dashboard-definitions": load("../features/dashboards/dashboard-definitions.ts"),
    "@/features/demo/lib/demo-dashboard-profiles": load("../features/demo/lib/demo-dashboard-profiles.ts"),
    "./landing-content": { integrationGroups, faqs },
  }
  const sections = load("../components/landing/landing-sections.tsx", overrides)
  return renderToStaticMarkup(React.createElement(React.Fragment, null,
    ...["BusinessSection", "AgencySection", "FeaturesSection", "IntegrationsSection", "PricingSection", "FAQSection"]
      .map(name => React.createElement(sections[name], { key: name, catalog }))
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
    for (const copy of [headline, promise, productSummary, retentionExample, demoQuestion]) {
      assert.ok(refreshedLandingFrench[copy], `Missing French translation: ${copy}`)
      const expected = renderToStaticMarkup(React.createElement(React.Fragment, null, translated(copy)))
      assert.ok(html.includes(expected), `Missing ${language} copy: ${copy}`)
    }
    assert.equal((html.match(/landing-hero-copy /g) || []).length, 1)
    assert.ok(html.indexOf(translated(retentionExample)) < html.indexOf("landing-hero-cta"))
    assert.equal((html.match(/landing-hero-promise /g) || []).length, 1)
    assert.doesNotMatch(html, /Insights from existing|Decisions from Data|landing-hero-more|landing-hero-team/)
    assert.ok(html.indexOf("landing-hero-intro") < html.indexOf("landing-product-demo"))
    assert.equal((html.match(/<video\b/g) || []).length, 1)
  }
})

test("trial wording matches no-card onboarding and the hero focuses on the decision", () => {
  assert.match(read("../../api/app/modules/billing/service.py"), /TRIAL_PERIOD_DAYS = 30/)
  assert.match(read("../../api/app/modules/organizations/router.py"), /trial_start \+ timedelta\(days=TRIAL_PERIOD_DAYS\)/)
  const html = renderHero()
  assert.match(html, /Start your 30-day trial/)
  assert.ok(html.indexOf(promise) < html.indexOf("Start your 30-day trial"))
  assert.doesNotMatch(html, /KPI alerts|email delivery/i)
  assert.match(html, /No credit card required\./)
  assert.ok(html.indexOf("landing-hero-note") > html.indexOf("Explore live demo"))
  assert.match(html, /href="https:\/\/app\.decisionate\.ca\/sign-up"/)
  assert.match(html, /href="\/demo"/)
  const hero = read("../components/landing/hero.tsx")
  for (const event of ["onFocus", "onPointerEnter", "onTouchStart"]) assert.match(hero, new RegExp(`${event}=\\{prefetchPublicDemo\\}`))
})

test("mobile menu owns auth links and retains keyboard dismissal with focus restoration", () => {
  const nav = read("../components/landing/navbar.tsx")
  const menu = nav.slice(nav.indexOf('id="landing-mobile-navigation"'))
  assert.match(menu, /href=\{DECISIONATE_AUTH_LINKS.signIn\}/)
  assert.match(menu, /href=\{DECISIONATE_AUTH_LINKS.signUp\}/)
  assert.ok(menu.includes('href="/demo"'))
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

test("all public sign-in and trial links point to the app host", () => {
  const overrides = {
    "next/link": { default: props => React.createElement("a", props) },
    "next/image": { default: props => React.createElement("img", Object.fromEntries(Object.entries(props).filter(([key]) => key !== "priority"))) },
    "@/app/use-decisionate-language": { useLandingText: () => ({ t: text => text }) },
    "@/features/dashboards/dashboard-definitions": load("../features/dashboards/dashboard-definitions.ts"),
    "@/features/demo/lib/demo-dashboard-profiles": load("../features/demo/lib/demo-dashboard-profiles.ts"),
    "./landing-content": { integrationGroups, faqs },
    "./landing.css": {},
  }
  const { LandingNavbar } = load("../components/landing/navbar.tsx", overrides)
  const { LandingFooter } = load("../components/landing/footer.tsx", overrides)
  const { FinalCTASection } = load("../components/landing/landing-sections.tsx", overrides)
  const { PolicyPage } = load("../components/landing/policy-page.tsx", { ...overrides,
    "@/components/landing/footer": { LandingFooter },
  })
  const html = renderHero() + renderSections() + renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(LandingNavbar), React.createElement(LandingFooter), React.createElement(FinalCTASection),
    React.createElement(PolicyPage, { title: "Privacy", eyebrow: "Legal", updated: "2026-11-15", description: "Policy" }),
  ))
  const links = [...html.matchAll(/href="([^"]*\/sign-(?:in|up))"/g)].map(match => match[1])
  assert.ok(links.length >= 12)
  for (const link of links) assert.ok(Object.values(domains.DECISIONATE_AUTH_LINKS).includes(link), link)
})

test("business and agency sections precede the evidence and action section", () => {
  const hero = read("../components/landing/hero.tsx")
  assert.doesNotMatch(hero, /agency|client workspaces|teamSummary/)
  const sections = read("../components/landing/landing-sections.tsx")
  assert.match(sections, /Keep the evidence close to the action\./)
  assert.ok(sections.includes(agencySummary))
  assert.ok(sections.includes("Make the next decision with your client."))
  assert.ok(refreshedLandingFrench[agencySummary])
  assert.doesNotMatch(sections, /audience ===|Workspace type|Manage your agency and client workspaces separately/)
  const page = read("../app/page.tsx")
  const order = ["BusinessSection", "AgencySection", "FeaturesSection", "IntegrationsSection", "PricingSection", "FAQSection"]
    .map(name => page.indexOf(`<${name} `))
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
    "Which products are worth promoting?",
    "Your bestseller may not be your most profitable product. Compare sales and costs by product before choosing what to promote. After the promotion, check whether the extra sales were worth the discount.",
    "Professional includes one business workspace, all industry dashboards and decision management. Keep your team's data, reports, actions and review dates together.",
    "Agency includes your agency workspace and up to 10 client workspaces, all Professional features and a shared AI credit allowance. Paid add-on workspaces let you expand as your agency grows.",
    "Create and brand your agency",
    "Choose Agency during workspace setup, then publish your branded portal from Settings. Invite clients to their own workspaces under your agency's name, logo and colours.",
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
    assert.match(html, /href="https:\/\/app\.decisionate\.ca\/sign-up"/)
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
  assert.match(about, /Business Analysis to compare metrics, check ad returns and profitability/)
  assert.match(about, /Dashboards help you monitor performance/)
  for (const pattern of [/Compare metrics, then Multi-dataset report/, /two or more datasets/, /date column and dimension filters/, /shared baseline of 100/, /individual metric pairs/, /not proof of causation/, /does not automatically record a business action/]) {
    assert.match(multi, pattern)
  }
  const html = renderSections()
  assert.match(html, /Save the evidence with your decision, set a review date/)
  assert.doesNotMatch(html, /explore AI-assisted insights|A view you can question/)
  const metadata = read("../app/layout.tsx")
  assert.match(metadata, /Analyze business performance across datasets/)
})

test("landing explains source filtering, seasonal validation and default owner delivery below the hero", () => {
  const upload = faqs.find(item => item.question === "Can I upload files?").answer
  const seasonal = faqs.find(item => item.question === "Do reports and forecasts account for seasonality?").answer
  const weekly = faqs.find(item => item.question === "What is included in a weekly report?").answer
  assert.match(upload, /selected unique values in a dimension column/)
  assert.match(seasonal, /enough suitable history supports validation/)
  assert.match(seasonal, /does not guarantee an accurate result/)
  for (const pattern of [/last complete week/, /three years of available history/, /Preview and save it in Weekly Reports/, /owner gets it by email when there is enough data/, /add recipients or pause delivery/]) {
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
      "See what earns its keep",
      "Compare the sales recorded for each dollar spent, see what's left after costs, and check which metrics move together. Keep the comparison separate from what you decide to test.",
      "Save the evidence with your decision, set a review date, and record what happened. Get a weekly email when the latest report has enough data.",
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

test("desktop aligns the trial note and demo footer while stacked mobile actions stay with the copy", () => {
  const css = require("postcss").parse(read("../components/landing/landing.css"))
  const values = (selector, parent = css) => Object.fromEntries(parent.nodes.filter(node => node.selector === selector).flatMap(rule => rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])))
  assert.equal(values(".landing-hero-cta")["margin-top"], "28px")
  assert.equal(values(".landing-hero-note")["margin-top"], "8px")
  assert.equal(values(".landing-product-video")["aspect-ratio"], "8 / 5")
  assert.equal(values(".landing-product-video")["object-fit"], "contain")
  assert.equal(values(".landing-product-video")["object-position"], "center")
  assert.equal(values(".landing-product-video").width, "100%")
  assert.equal(values(".landing-demo-chapters")["grid-template-columns"], "repeat(4, minmax(0, 1fr))")
  assert.equal(values(".landing-page svg.lucide").color, "var(--landing-brand-accent)")
  const desktop = css.nodes.find(node => node.type === "atrule" && node.params === "(min-width: 1024px)")
  assert.equal(values(".landing-hero-stage", desktop)["align-items"], "stretch")
  for (const selector of [".landing-hero-cta", ".landing-demo-footer"]) {
    assert.equal(values(selector, desktop)["margin-top"], "auto")
  }
  assert.doesNotMatch(css.toString(), /display: contents|landing-hero-more|landing-hero-team|max-height: calc\(100svh/)
  assert.equal(values(".landing-button")["min-height"], "44px")
})

test("demo introduction, chapter controls and supplemental link remain accessible", () => {
  const html = renderHero()
  assert.match(html, /<h2[^>]*id="landing-demo-heading"/)
  assert.match(html, /See Decisionate in action/)
  assert.ok(html.includes(demoQuestion))
  for (const [label, time] of [["Trends", 0], ["Ad returns", 10], ["Decide", 24], ["Review", 38]]) {
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

test("pricing offers Professional and hosted Agency, with custom domains hidden until enabled", () => {
  const catalog = { currency: "CAD", plans: [
    { plan: "professional", monthly_price_cents: 12345, annual_price_cents: 123450, monthly_configured: true, annual_configured: true, available: true },
    { plan: "agency", monthly_price_cents: 23456, annual_price_cents: 234560, monthly_configured: true, annual_configured: true, available: true },
    { plan: "agency_subdomain", monthly_price_cents: 34567, annual_price_cents: 345670, monthly_configured: true, annual_configured: true, available: true },
  ] }
  const html = renderSections("en", catalog)
  for (const name of ["Professional", "Agency"]) assert.ok(html.includes(name))
  for (const name of ["Standard Branded Agency", "White Label Subdomain Agency", "Custom Domain White Label Agency"]) assert.ok(!html.includes(name))
  for (const amount of ["123.45", "345.67"]) assert.ok(html.includes(amount))
  assert.ok(!html.includes("234.56"))
  const pricing = html.slice(html.indexOf('id="pricing"'), html.indexOf('id="questions"'))
  assert.match(pricing, /Your portal at business\.decisionate\.app/)
  assert.equal((pricing.match(/Start trial/g) || []).length, 2)
  const enabled = renderSections("en", { ...catalog, plans: [...catalog.plans, { plan: "agency_custom_domain", monthly_price_cents: 45678, annual_price_cents: 456780, monthly_configured: true, annual_configured: true, available: true }] })
  assert.match(enabled, /Custom Domain White Label Agency/)
  assert.match(enabled, /456.78/)
  assert.doesNotMatch(renderSections(), /Custom Domain White Label Agency/)
  assert.doesNotMatch(renderSections(), /\$0\.00/)
  assert.ok(refreshedLandingFrench["Custom Domain White Label Agency"])
})

test("industry links select the corresponding demo dashboard and pricing retains translation", () => {
  const sections = read("../components/landing/landing-sections.tsx")
  assert.match(sections, /dashboardDefinitions/)
  assert.match(sections, /\/demo\?dashboard=\$\{item.key\}/)
  assert.doesNotMatch(sections, /Most popular|Trusted by|Upcoming/)
  assert.equal(refreshedLandingFrench.Annual, "Annuel")
  assert.equal(refreshedLandingFrench.Review, "Réviser")
})
