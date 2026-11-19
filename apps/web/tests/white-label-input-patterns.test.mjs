import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")

function patterns(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = []
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === "pattern") {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer
      assert.ok(value && ts.isStringLiteral(value), "Validate dynamically constructed patterns separately")
      found.push(value.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

test("white-label HTML patterns compile with the browser's Unicode sets flag", () => {
  const all = [
    ...patterns("../features/hosted-subdomains/setup.tsx"),
    ...patterns("../features/white-label/setup.tsx"),
  ]
  assert.equal(all.length, 3)
  for (const pattern of all) assert.doesNotThrow(() => new RegExp(pattern, "v"), pattern)
})

test("the subdomain pattern keeps its 3-40 character limit and accepts single hyphens", () => {
  const pattern = patterns("../features/hosted-subdomains/setup.tsx").find(value => value !== "https://.*")
  const matches = new RegExp(`^(?:${pattern})$`, "v")
  for (const value of ["abc", "scanned", "north-star", "a1b", "123", "a".repeat(40)])
    assert.equal(matches.test(value), true, value)
  for (const value of ["", "ab", "a".repeat(41), "-agency", "agency-", "North-Star", "north_star", "north.star", "north star", "n\u00f6rth"])
    assert.equal(matches.test(value), false, value)
})

test("the application ID pattern keeps its existing character rules and length limit", () => {
  const [pattern] = patterns("../features/white-label/setup.tsx")
  const matches = new RegExp(`^(?:${pattern})$`, "v")
  for (const value of ["ai", "decisionate-ai", "agency1", "a".repeat(63)])
    assert.equal(matches.test(value), true, value)
  for (const value of ["", "a", "a".repeat(64), "1agency", "-agency", "Agency", "agency_id", "agency.example", "agency name"])
    assert.equal(matches.test(value), false, value)
})
