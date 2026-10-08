import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(path.join(webRoot, "package.json"))
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

function loadComponent(relativePath, translate = text => text) {
  const modules = new Map()
  const overrides = {
    "next/link": { __esModule: true, default: props => React.createElement("a", props) },
    "@clerk/nextjs": { useUser: () => ({ user: { id: "reviewer" } }) },
    "@/lib/use-active-workspace": { useActiveWorkspace: () => ({ activeWorkspaceId: "reviewer" }) },
    "@/lib/api": { deleteDataset: async () => {} },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: translate }) },
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const loadedModule = { exports: {} }
    modules.set(file, loadedModule.exports)
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    })
    vm.runInNewContext(outputText, {
      module: loadedModule, exports: loadedModule.exports,
      require: specifier => {
        if (overrides[specifier]) return overrides[specifier]
        if (specifier.startsWith("@/") || specifier.startsWith(".")) {
          const base = specifier.startsWith("@/") ? path.join(webRoot, specifier.slice(2)) : path.resolve(path.dirname(file), specifier)
          const resolved = [base, `${base}.tsx`, `${base}.ts`].find(existsSync)
          if (!resolved) throw new Error(`Cannot resolve ${specifier}`)
          return load(resolved)
        }
        return require(specifier)
      },
    }, { filename: file })
    return loadedModule.exports
  }
  return load(path.join(webRoot, relativePath))
}

const { DashboardPageHeader } = loadComponent("features/dashboard/components/dashboard-page-header.tsx")
const { DatasetList } = loadComponent("features/datasets/components/dataset-list.tsx")
const { DashboardActionButton } = loadComponent("features/dashboards/dashboard-registry.tsx")
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))
const datasets = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, file_name: `Dataset ${index + 1}`, row_count: 100 + index, column_count: 4, source_type: index % 2 ? "csv" : "meta_ads" }))

test("page headers have a compact semantic title and optional description", () => {
  const html = render(DashboardPageHeader, { title: "Datasets", actions: React.createElement("button", {}, "Add data") })
  assert.match(html, /<h1 class="[^"]*text-2xl/)
  assert.match(html, /border-b/)
  assert.match(html, />Add data<\/button>/)
  assert.doesNotMatch(html, /<p/)
})

test("page titles and descriptions retain translation", () => {
  const { DashboardPageHeader: TranslatedHeader } = loadComponent("features/dashboard/components/dashboard-page-header.tsx", text => `translated:${text}`)
  const html = render(TranslatedHeader, { title: "Datasets", description: "Workspace data" })
  assert.match(html, />translated:Datasets<\/h1>/)
  assert.match(html, />translated:Workspace data<\/p>/)
})

test("tool buttons keep accessible labels, tooltips, and fixed dimensions", () => {
  const html = render(DashboardActionButton, { icon: React.createElement("span", {}, "icon"), label: "Save PDF", onClick: () => {}, disabled: true })
  assert.match(html, /aria-label="Save PDF"/)
  assert.match(html, /title="Save PDF"/)
  assert.match(html, /h-10 w-10/)
  assert.match(html, /disabled=""/)
  assert.match(html, /class="sr-only">Save PDF/)
})

test("dataset library has labeled search, source and sorting controls", () => {
  const html = render(DatasetList, { datasets, onRefresh: async () => {} })
  assert.match(html, /type="search"/)
  assert.match(html, />Search datasets<\/span>/)
  assert.match(html, /aria-label="Filter by source"/)
  assert.match(html, /aria-label="Sort datasets"/)
  assert.match(html, /value="rows">Most rows/)
  assert.match(html, /role="status" aria-live="polite"/)
})

test("busy tool buttons show progress without changing dimensions", () => {
  const html = render(DashboardActionButton, { icon: React.createElement("span", {}, "icon"), label: "Opening...", onClick: () => {}, busy: true })
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /disabled=""/)
  assert.match(html, /animate-spin/)
  assert.match(html, /h-10 w-10/)
})

test("large libraries render only twenty items and expose pagination", () => {
  const html = render(DatasetList, { datasets, onRefresh: async () => {} })
  assert.equal((html.match(/aria-label="View dataset:/g) ?? []).length, 20)
  assert.match(html, /aria-label="Dataset pages"/)
  assert.match(html, /<button[^>]*aria-label="Previous page"[^>]*disabled=""/)
  assert.match(html, /aria-label="Next page"/)
  assert.ok(html.indexOf('title="Dataset 25"') < html.indexOf('title="Dataset 24"'))
  assert.doesNotMatch(html, /title="Dataset 1"/)
})

test("read-only library preserves viewing without deletion controls", () => {
  const html = render(DatasetList, { datasets: datasets.slice(0, 1), onRefresh: async () => {}, canDelete: false, canManage: false })
  assert.match(html, /aria-label="View dataset: Dataset 1"/)
  assert.doesNotMatch(html, /aria-label="Delete dataset:/)
})

test("empty and failed libraries remain distinguishable", () => {
  const empty = render(DatasetList, { datasets: [], onRefresh: async () => {} })
  const failed = render(DatasetList, { datasets: [], onRefresh: async () => {}, loadError: true })
  const shared = render(DatasetList, { datasets: [], onRefresh: async () => {}, canManage: false })
  assert.match(empty, /No saved datasets/)
  assert.match(failed, /Datasets unavailable/)
  assert.doesNotMatch(failed, /No saved datasets/)
  assert.match(shared, /No shared datasets/)
})
