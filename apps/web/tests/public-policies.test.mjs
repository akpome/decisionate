import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server")

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const policies = ["privacy", "terms", "security"].map((name) => ({
  name,
  source: read(`../app/${name}/page.tsx`).replace(/\s+/g, " "),
}))
const css = read("../components/landing/landing.css")

function color(variable) {
  const match = css.match(new RegExp(`--landing-brand-${variable}: (#[0-9a-f]{6});`, "i"))
  assert.ok(match, `Missing brand ${variable}`)
  return match[1]
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test("landing removes permanent-summary copy in both languages", () => {
  for (const path of [
    "../components/landing/landing-content.ts",
    "../components/landing/landing-sections.tsx",
    "../lib/landing-translations.ts",
  ]) {
    const source = read(path)
    assert.doesNotMatch(source, /No permanent summaries|Aucun résumé permanent|permanent storage|stockage permanent/)
  }
})

test("all policies match connector and expiry retention constants", () => {
  const retention = read("../../api/app/modules/datasets/services/retention.py")
  const expiry = read("../../api/app/modules/billing/data_retention.py")
  assert.match(retention, /CONNECTOR_DATA_RETENTION_YEARS = 3/)
  assert.match(retention, /CONNECTOR_DATA_RETENTION_MONTHS = CONNECTOR_DATA_RETENTION_YEARS \* 12/)
  assert.match(expiry, /SUBSCRIPTION_EXPIRY_DATA_PURGE_DAYS = 89/)
  assert.match(expiry, /SUBSCRIPTION_CANCELLATION_DATA_PURGE_DAYS = 90/)
  for (const { name, source } of policies) {
    assert.match(source, /updated="October 8, 2026"/, name)
    assert.match(source, /three years, then deleted/, name)
    assert.match(source, /preceding 35 months/, name)
    assert.match(source, /89 days after the subscription end date/, name)
    assert.match(source, /90 days/, name)
    assert.match(source, /manually uploaded datasets/, name)
    assert.match(source, /Connection settings and credentials|connection settings or credentials/, name)
    assert.match(source, /Backups, replicas/, name)
    assert.doesNotMatch(source, /yearly historical summary partitions|kept raw for 24 months|permanent historical analysis/, name)
  }
})

test("policies distinguish private workspaces, public shares, and prepared demo data", () => {
  for (const { name, source } of policies) {
    assert.match(source, /without signing in|exception to private sign-in/, name)
    assert.match(source, /prepared sample data/, name)
  }
  const privacy = policies[0].source
  assert.match(privacy, /not automatically delete datasets already imported/)
  assert.match(privacy, /not customer workspace data/)
  assert.match(privacy, /Demo sample files are public/)
})

test("product export permissions do not restrict individual privacy rights", () => {
  const privacy = policies[0].source
  assert.match(privacy, /do not limit an individual/)
  assert.match(privacy, /do not have to be a workspace owner to request your own personal information/)
  assert.match(privacy, /30 calendar days, subject to permitted extensions and exceptions/)
  assert.match(privacy, /https:\/\/www\.priv\.gc\.ca\/en\/privacy-topics\/accessing-personal-information/)
  for (const { name, source } of policies.slice(1)) {
    assert.match(source, /do not (restrict|limit) individual|do not limit an individual/, name)
  }
})

test("AI and billing descriptions are direct while security claims remain bounded", () => {
  for (const source of [
    ...policies.map((policy) => policy.source),
    read("../components/landing/landing-content.ts"),
    read("../components/landing/landing-sections.tsx"),
    read("../lib/landing-translations.ts"),
  ]) {
    assert.doesNotMatch(source, /optional AI|Optional AI|optional paid|optional enabled|when (?:AI|billing) is enabled|enabled AI services|services IA activés|facturation est activée|available only when|Where purchases are enabled|where billing is enabled/)
  }
  assert.match(policies[0].source, /For a requested AI analysis/)
  assert.match(policies[0].source, /\["Stripe",/)
  assert.match(policies[0].source, /not an upload of the raw dataset file or every source row/)
  assert.match(policies[1].source, /Paid subscriptions and AI-credit purchases are managed in Billing/)
  assert.match(policies[1].source, /renews automatically each month or year/)
  assert.match(policies[1].source, /Starting a trial without a payment method does not authorize a charge/)
  assert.match(policies[2].source, /In production mode, stored OAuth/)
  assert.match(policies[2].source, /Development configurations are not production guarantees/)
  assert.match(policies[2].source, /not a security certification/)
  assert.match(policies[2].source, /not promise a fixed incident response time/)
})

test("public pages load their own shared styles and use the logo palette", () => {
  assert.match(read("../components/landing/policy-page.tsx"), /import "\.\/landing\.css"/)
  assert.equal(color("primary"), "#0047ff")
  assert.equal(color("accent"), "#00c9ef")
  for (const foreground of [color("primary"), color("hover")]) {
    assert.ok(contrast(foreground, "#ffffff") >= 4.5)
    assert.ok(contrast(foreground, color("tint")) >= 4.5)
  }
  assert.ok(contrast(color("primary"), "#e1efff") >= 4.5)
  for (const component of ["hero", "navbar", "landing-product-demo", "landing-sections"]) {
    assert.doesNotMatch(read(`../components/landing/${component}.tsx`), /(?:text|bg|border)-teal-/)
  }
  assert.match(css, /:focus-visible \{\s*outline: 2px solid var\(--landing-brand-primary\)/)
})

test("policies and public media do not depend on authentication middleware", () => {
  const proxy = read("../proxy.ts")
  const publicRoutes = proxy.match(/const isPublicDemoRoute = createRouteMatcher\(\[([\s\S]*?)\]\)/)?.[1]
  assert.ok(publicRoutes)
  assert.deepEqual([...publicRoutes.matchAll(/"([^"]+)"/g)].map((match) => match[1]), [
    "/", "/demo(.*)", "/privacy", "/terms", "/security",
  ])
  const parsed = ts.createSourceFile("proxy.ts", proxy, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find((statement) => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some((item) => item.name.getText(parsed) === "config"))
  assert.ok(declaration)
  const { outputText } = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports })
  const matchesProxy = (url) => unstable_doesMiddlewareMatch({ config: loaded.exports.config, nextConfig: {}, url })
  for (const extension of ["webp", "avif", "webm", "mp4", "vtt"]) {
    assert.equal(matchesProxy(`/media/walkthrough.${extension}`), false, extension)
    assert.equal(matchesProxy(`/api/private.${extension}`), true, extension)
  }
  for (const path of ["/dashboard", "/onboarding", "/api/private", "/api/private.json"]) {
    assert.equal(matchesProxy(path), true, path)
  }
})
