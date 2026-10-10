import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")

function parse(path) {
  return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function findNode(source, predicate) {
  let found
  function visit(node) {
    if (predicate(node)) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, "Expected component callback was not found")
  return found
}

function loadCallback(source, callback, globals) {
  const expression = ts.createPrinter().printNode(ts.EmitHint.Expression, callback, source)
  const { outputText } = ts.transpileModule(`module.exports = ${expression}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, { module: loaded, ...globals })
  return loaded.exports
}

function resizeEffect(path, observerAvailable) {
  const source = parse(path)
  const effect = findNode(source, node => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0].getText(source).includes("new ResizeObserver"))
  const listeners = new Map()
  const frames = new Map()
  const updates = []
  const element = { width: 358, scrollWidth: 1200, getBoundingClientRect() { return { width: this.width } } }
  const observers = []
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(node) { this.node = node }
    disconnect() { this.disconnected = true }
  }
  const window = {
    addEventListener: (event, listener) => listeners.set(event, listener),
    removeEventListener: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event) },
    requestAnimationFrame: callback => { frames.set(1, callback); return 1 },
    cancelAnimationFrame: id => frames.delete(id)
  }
  const run = loadCallback(source, effect.arguments[0], {
    window,
    ResizeObserver: observerAvailable ? Observer : undefined,
    videoRef: { current: element },
    previewTableRef: { current: element },
    setVideoWidth: width => updates.push(width),
    setPreviewTableWidth: width => updates.push(width)
  })
  return { run, listeners, frames, updates, element, getObserver: () => observers[0] }
}

for (const [label, path, dimension] of [
  ["landing walkthrough", "../components/landing/landing-product-demo.tsx", "width"],
  ["dataset preview", "../app/dashboard/datasets/[id]/page.tsx", "scrollWidth"]
]) {
  for (const observerAvailable of [false, true]) {
    test(`${label} stays usable ${observerAvailable ? "with" : "without"} ResizeObserver`, () => {
      const harness = resizeEffect(path, observerAvailable)
      const cleanup = harness.run()
      for (const callback of harness.frames.values()) callback()
      assert.equal(harness.updates.at(-1), harness.element[dimension])
      harness.element[dimension] = 640
      harness.listeners.get("resize")()
      assert.equal(harness.updates.at(-1), 640)
      const observer = harness.getObserver()
      if (observerAvailable) {
        assert.equal(observer.node, harness.element)
        harness.element[dimension] = 720
        observer.callback()
        assert.equal(harness.updates.at(-1), 720)
      }
      cleanup()
      assert.equal(harness.listeners.size, 0)
      assert.equal(harness.frames.size, 0)
      if (observerAvailable) assert.equal(observer.disconnected, true)
    })
  }
  test(`${label} cancels pending measurement on unmount`, () => {
    const harness = resizeEffect(path, false)
    harness.run()()
    assert.equal(harness.frames.size, 0)
    assert.deepEqual(harness.updates, [])
  })
}

test("walkthrough chapter updates do not require Array.findLastIndex", () => {
  const source = parse("../components/landing/landing-product-demo.tsx")
  const chapters = findNode(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === "productDemoChapters")
  const onTimeUpdate = findNode(source, node => ts.isJsxAttribute(node) && node.name.getText(source) === "onTimeUpdate")
  const productDemoChapters = loadCallback(source, chapters.initializer, {})
  const updates = []
  const callback = loadCallback(source, onTimeUpdate.initializer.expression, {
    productDemoChapters,
    setChapter: index => updates.push(index)
  })
  assert.doesNotMatch(onTimeUpdate.getText(source), /findLastIndex/)
  for (const [time, expected] of [[0, 0], [9.9, 0], [10, 1], [24, 2], [38, 3], [55, 3]]) {
    callback({ currentTarget: { currentTime: time } })
    assert.equal(updates.at(-1), expected)
  }
})
