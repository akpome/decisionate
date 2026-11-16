import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path, imports = {}, env = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module: loaded, exports: loaded.exports, URL, process: { env },
    require: name => { assert.ok(name in imports, `Unexpected dependency: ${name}`); return imports[name] },
  })
  return loaded.exports
}
const domains = load("../lib/decisionate-domains.ts")
const seo = load("../lib/seo.ts", { "./decisionate-domains": domains })
const routes = load("../lib/application-routes.ts")
const auth = load("../features/auth/lib/auth-redirects.ts", { "@/lib/application-routes": routes })

test("only the primary production marketing site is indexable", () => {
  assert.equal(seo.isIndexableMarketingHost("decisionate.ca"), true)
  for (const host of ["www.decisionate.ca", "app.decisionate.ca", "north.decisionate.app", "preview.vercel.app", "localhost", "decisionate.ca.attacker.test"]) {
    assert.equal(seo.isIndexableMarketingHost(host), false, host)
  }
  assert.equal(seo.isIndexableMarketingHost("decisionate.ca", "portal"), false)
  for (const environment of ["preview", "development"]) assert.equal(seo.isIndexableMarketingHost("decisionate.ca", "", environment), false)
})

test("public pages have distinct titles, canonical URLs and complete social previews", () => {
  const titles = new Set(), descriptions = new Set()
  for (const path of Object.keys(seo.publicSeoPages)) {
    const m = seo.publicPageMetadata(path, true)
    titles.add(m.title.absolute); descriptions.add(m.description)
    assert.ok(m.title.absolute.length <= 65)
    assert.ok(m.description.length >= 100 && m.description.length <= 165)
    assert.equal(m.alternates.canonical, new URL(path, domains.DECISIONATE_MARKETING_ORIGIN).href)
    assert.equal(m.openGraph.url, m.alternates.canonical)
    assert.equal(m.openGraph.title, m.title.absolute)
    assert.equal(m.twitter.description, m.description)
    assert.equal(m.twitter.card, "summary_large_image")
    assert.equal(m.robots.index, true)
    assert.equal(m.openGraph.images[0].width, 1200)
    assert.equal(m.openGraph.images[0].height, 630)
    assert.equal(m.openGraph.images[0].url, "https://decisionate.ca/social-preview.png")
    assert.ok(m.openGraph.images[0].alt)
    const privateCopy = seo.publicPageMetadata(path, false)
    assert.equal(privateCopy.robots.index, false)
    assert.equal(privateCopy.alternates, undefined)
  }
  assert.equal(titles.size, 5)
  assert.equal(descriptions.size, 5)
})

test("the sitemap contains only canonical public pages and never fabricates modification dates", () => {
  const urls = seo.marketingSitemap(true)
  assert.equal(urls.length, 5)
  for (const entry of urls) {
    const url = new URL(entry.url)
    assert.equal(url.origin, "https://decisionate.ca")
    assert.ok(Object.hasOwn(seo.publicSeoPages, url.pathname))
    assert.equal(url.search, "")
    assert.equal(entry.lastModified, undefined)
  }
  assert.equal(seo.marketingSitemap(false).length, 0)
  assert.equal(seo.siteRobots(true).sitemap, "https://decisionate.ca/sitemap.xml")
  assert.equal(seo.siteRobots(false).sitemap, undefined)
  assert.ok(!seo.siteRobots(false).rules.disallow.includes("/"), "Crawlers must be able to read noindex directives")
})

test("structured data identifies the real business and product without invented ratings or prices", () => {
  const data = JSON.parse(seo.serializeStructuredData(seo.marketingStructuredData))
  assert.equal(data["@context"], "https://schema.org")
  assert.deepEqual(data["@graph"].map(item => item["@type"]), ["Organization", "WebSite", "SoftwareApplication"])
  for (const item of data["@graph"]) {
    assert.equal(item.name, "Decisionate")
    assert.equal(item.url, "https://decisionate.ca")
    assert.equal(item.aggregateRating, undefined)
    assert.equal(item.offers, undefined)
  }
  const unsafe = { text: '</script><script>alert("x")</script>' }
  const serialized = seo.serializeStructuredData(unsafe)
  assert.ok(!serialized.includes("<"))
  assert.deepEqual(JSON.parse(serialized), unsafe)
  assert.match(read("../app/page.tsx"), /marketing && <script type="application\/ld\+json"/)
})

test("server metadata uses the request host and exposes verification tokens only on the marketing site", async () => {
  for (const host of ["decisionate.ca", "app.decisionate.ca", "preview.vercel.app", "north.decisionate.app"]) {
    const server = load("../lib/seo-server.ts", {
      "server-only": {}, "next/headers": { headers: async () => new Headers({ host: "internal:3000", "x-forwarded-host": host }) },
      "@/features/auth/lib/auth-redirects": auth, "./portal-brand": { portalBrand: { id: "" } }, "./seo": seo,
    }, { GOOGLE_SITE_VERIFICATION: "google-test", BING_SITE_VERIFICATION: "bing-test" })
    const metadata = await server.marketingPageMetadata("/")
    assert.equal(metadata.robots.index, host === "decisionate.ca")
    assert.equal(metadata.verification?.google, host === "decisionate.ca" ? "google-test" : undefined)
    assert.equal(metadata.verification?.other["msvalidate.01"], host === "decisionate.ca" ? "bing-test" : undefined)
  }
})

test("root metadata defaults to noindex and every listed public page opts in explicitly", () => {
  assert.match(read("../app/layout.tsx"), /robots: \{ index: false, follow: false \}/)
  for (const path of Object.keys(seo.publicSeoPages)) {
    const source = read(`../app${path === "/" ? "" : path}/page.tsx`)
    assert.ok(source.includes(`marketingPageMetadata("${path}")`), path)
  }
  const config = load("../next.config.ts", { "./lib/application-routes": routes }).default
  return config.headers().then(headers => {
    const rule = headers.find(rule => rule.headers.some(item => item.key === "X-Robots-Tag"))
    assert.equal(rule.source, "/:path*")
    assert.equal(rule.has[0].value, "app\\.decisionate\\.ca")
    assert.equal(rule.headers[0].value, "noindex, nofollow")
  })
})
