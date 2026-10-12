import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const page = readFileSync(new URL("../app/platform-admin/page.tsx", import.meta.url), "utf8")
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

test("admin table wrapping fixes stay scoped to the platform admin page", () => {
  assert.match(page, /className="platform-admin-layout/)
  assert.match(css, /\.platform-admin-layout table\s*\{\s*overflow-wrap: normal;/)
  assert.match(css, /\.platform-admin-layout th\s*\{\s*white-space: nowrap;\s*letter-spacing: 0;/)
  assert.match(css, /\.platform-admin-layout \.admin-data-table\s*\{\s*width: 100%;\s*table-layout: fixed;/)
})

test("users and workspaces have bounded columns and accessible horizontal scrolling", () => {
  for (const [label, width] of [["Users", 1140], ["Workspaces", 1112]]) {
    assert.ok(page.includes(`role="region" aria-label="${label} table" tabIndex={0}`))
    assert.ok(page.includes(`admin-data-table min-w-[${width}px]`))
  }
  assert.equal((page.match(/<colgroup>/g) || []).length, 2)
  assert.match(page, /function AdminReference/)
  assert.match(page, /navigator\.clipboard\.writeText\(value\)/)
  assert.match(page, /truncate font-mono text-xs" title=\{value\}/)
  assert.match(page, /platformUser\.clerk_user_id,\s*platformUser\.email \|\| ""/)
})

test("compact admin actions keep labels and destructive confirmation safeguards", () => {
  assert.match(page, /aria-label=\{`View members of \$\{organization\.name\}`\}/)
  assert.match(page, /aria-label=\{`Delete workspace \$\{organization\.name\}`\}/)
  assert.match(page, /<tr id=\{`workspace-delete-confirm-\$\{organization\.id\}`\}>\s*<td colSpan=\{9\}/)
  assert.match(page, /deleteConfirmationText\.trim\(\) !== "DELETE WORKSPACE"/)
  assert.match(page, /platformUser\.protected \? \(/)
  assert.match(page, /confirmation !== "DELETE USER"/)
})
