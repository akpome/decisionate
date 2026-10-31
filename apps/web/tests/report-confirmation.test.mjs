import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[1]?.getText(ast) === "[message]") effect = node.arguments[0].getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(effect, "Report confirmations need an effect that resets when the message changes")

function harness(message) {
  const state = { message, timers: [], cleared: [] }
  const cleanup = vm.runInNewContext(ts.transpileModule(`(${effect})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    message, setMessage: update => { state.message = update(state.message) },
    window: { setTimeout: (callback, delay) => { state.timers.push({ callback, delay }); return 17 }, clearTimeout: timer => state.cleared.push(timer) },
  })
  return { state, cleanup }
}

test("successful report confirmations disappear after five seconds", () => {
  for (const message of ["Weekly report updated. Delivery settings are unchanged.", "Weekly report updated and assessment attached to the decision. Delivery settings are unchanged.", "Report snapshot saved."]) {
    const { state, cleanup } = harness(message)
    assert.equal(state.message, message)
    assert.equal(state.timers.length, 1)
    assert.equal(state.timers[0].delay, 5000)
    state.timers[0].callback()
    assert.equal(state.message, "")
    cleanup()
    assert.deepEqual(state.cleared, [17])
  }
})

test("empty confirmations create no timer and changing or unmounting a message clears its timer", () => {
  const empty = harness("")
  assert.equal(empty.state.timers.length, 0)
  assert.equal(empty.cleanup, undefined)
  const first = harness("Weekly report updated. Delivery settings are unchanged.")
  first.cleanup()
  assert.deepEqual(first.state.cleared, [17])
  first.state.message = "Weekly report sent."
  first.state.timers[0].callback()
  assert.equal(first.state.message, "Weekly report sent.")
  const next = harness(first.state.message)
  assert.equal(next.state.timers[0].delay, 5000)
  next.state.timers[0].callback()
  assert.equal(next.state.message, "")
})

test("auto-dismiss only changes confirmation state, leaving errors and delivery status independent", () => {
  assert.doesNotMatch(effect, /setError|setWeeklySettings|setWeeklyDirty|setAnalysisJob|setReport/)
  assert.match(source, /\{message && <p role="status"/)
  assert.match(source, /\{weeklySendIssue && <p role="status"/)
  assert.match(source, /aria-label="Weekly settings status"/)
})
