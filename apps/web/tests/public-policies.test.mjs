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
    assert.ok(source.includes('updated="October 23, 2026"'), name)
    assert.match(source, /three years, then deleted/, name)
    assert.match(source, /three calendar years/, name)
    assert.doesNotMatch(source, /preceding 35 months/, name)
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

test("privacy describes stored analysis settings, jobs and sensitive dimension values", () => {
  const source = policies[0].source
  for (const pattern of [/selected unique values/, /Background analysis records/, /Closing a page does not itself delete/, /not access controls or anonymization/, /selected dimension filter values/, /Clearing browser storage does not delete those server-side records/]) {
    assert.match(source, pattern)
  }
  const facts = read("../../api/app/modules/reports/service.py")
  assert.match(facts, /facts\["dimension_filters"\] = report\["definition"\]\.get\("dimension_filters", \[\]\)/)
  const jobs = read("../../api/app/modules/reports/models.py")
  for (const field of ["definition", "sources", "status", "result"]) assert.ok(jobs.includes(`${field} = Column(`))
})

test("policies distinguish saved report deletion, weekly template removal and retained decision evidence", () => {
  for (const { source, name } of policies.slice(0, 2)) {
    for (const pattern of [/associated saved-report analysis-job records/, /evidence copied into those decisions/, /Removing only the weekly template pauses delivery/, /pauses delivery/, /downloaded files|downloaded or delivered by email/]) {
      assert.match(source, pattern, name)
    }
  }
  const router = read("../../api/app/modules/reports/router.py")
  assert.match(router, /db\.query\(ReportAnalysisJob\)\.filter_by\(saved_report_id=report\.id\)\.delete/)
  assert.match(router, /preference\.enabled = 0/)
  assert.match(router, /def report_decision_evidence\(report\)/)
})

test("terms explain filtered, indexed, seasonal and queued analysis with explicit weekly delivery", () => {
  const source = policies[1].source
  for (const pattern of [/initial syncing requests 90 days/, /checkpointed background chunks/, /matching observations/, /shared baseline of 100, not amounts in the original units/, /do not establish causation, attribution/, /sufficient suitable history/, /latest complete week/, /Choosing a template does not itself enable email delivery/, /reopening one does not automatically recompute it/, /does not itself record a business action/]) {
    assert.match(source, pattern)
  }
})

test("security describes scoped report-job access, worker checks and bounded execution", () => {
  const source = policies[2].source
  for (const pattern of [/scoped to the submitting user and workspace/, /Saved reports also require access to their source datasets/, /not access controls or anonymization/, /separate analysis worker and durable database jobs/, /not by itself a security sandbox/, /per-workspace queue limits/, /supervised execution timeouts/, /rechecks workspace access, source versions/, /not blindly resent/, /do not guarantee uninterrupted availability or exactly-once email delivery/]) {
    assert.match(source, pattern)
  }
  const jobs = read("../../api/app/modules/reports/jobs.py")
  assert.match(jobs, /filter_by\(id=identity, workspace_id=workspace, user_id=user\)/)
  assert.match(jobs, /ReportAnalysisJob\.status\.in_\(ACTIVE\)\)\.count\(\) >= 3/)
  const worker = read("../../api/app/infrastructure/analysis_worker.py")
  for (const pattern of [/verify_job_actor\(job\)/, /authorize_datasets\(db, job\.user_id, job\.workspace_id/, /snapshot\(datasets\) != expected/, /weekly_configuration\(db, preference, job\.workspace_id, job\.user_id\)/, /ANALYSIS_JOB_TIMEOUT_SECONDS/, /No automatic resend/]) {
    assert.match(worker, pattern)
  }
})

test("security distinguishes analysis-job cleanup from snapshots and retained decision evidence", () => {
  const source = policies[2].source
  for (const pattern of [/eligible for cleanup after seven days, or 90 days for weekly-send jobs/, /cleanup runs while the analysis worker operates/, /does not delete saved report snapshots or copied decision evidence/, /preserves source datasets and linked decisions/, /pauses delivery/, /do not recall previously downloaded files or delivered emails/]) {
    assert.match(source, pattern)
  }
  const worker = read("../../api/app/infrastructure/analysis_worker.py")
  assert.match(worker, /ReportAnalysisJob\.status\.notin_\(ACTIVE\)/)
  assert.match(worker, /ReportAnalysisJob\.kind.notin_\(\{"weekly_send", "weekly_owner_send"\}\)[\s\S]*timedelta\(days=7\)/)
  assert.match(worker, /ReportAnalysisJob\.completed_at < utc_now\(\) - timedelta\(days=90\)/)
  assert.match(worker, /time\.monotonic\(\) - last_cleanup > 3600/)
})

test("security describes bounded imports and identifiable AI report context without anonymity guarantees", () => {
  const source = policies[2].source
  for (const pattern of [/initial sync requests 90 days/, /checkpointed background chunks/, /does not extend provider permissions/, /selected dimension filter values/, /seasonal-analysis results/, /not an upload of the raw dataset file or every source row/, /should not be assumed to be anonymous/]) {
    assert.match(source, pattern)
  }
  assert.match(read("../../api/app/modules/datasets/router.py"), /INITIAL_CONNECTOR_SYNC_DAYS = 90/)
  assert.match(read("../../api/app/modules/reports/service.py"), /facts\["dimension_filters"\]/)
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
