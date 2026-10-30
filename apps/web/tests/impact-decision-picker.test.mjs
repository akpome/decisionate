import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const source = readFileSync(new URL("../features/reports/impact-decision-picker.tsx", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText
function load(imports = {}, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, AbortController,
    require: name => imports[name] || require(name), ...globals })
  return loaded.exports.ImpactDecisionPicker
}
const decisions = [{ id: 1, title: "Increase advertising" }, { id: 2, title: "Increase staffing" }, { id: 3, title: "Reduce advertising costs" }]
const response = (items = decisions, next_offset = null) => ({ decisions: items, next_offset })
const keyboard = key => ({ key, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} })

function harness(patch = {}) {
  const slots = [], effects = [], timers = new Map(), requests = [], chosen = [], scrolled = []
  let cursor = 0, timerId = 0, tree
  const props = { userId: "owner", workspaceId: "store", disabled: false, onChoose: id => chosen.push(id), ...patch }
  const hooks = { ...React, useId: () => "picker", useRef: initial => {
    const index = cursor++
    return slots[index] ||= { current: initial }
  }, useState: initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial
    return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value }]
  }, useEffect: (run, dependencies) => {
    const index = cursor++, previous = slots[index]
    if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return
    previous?.cleanup?.()
    slots[index] = { dependencies }
    effects.push(() => { slots[index].cleanup = run() })
  } }
  const Picker = load({ react: hooks, "@/lib/api": { correlationRequest: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) } }, {
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id }, clearTimeout: id => timers.delete(id),
    document: { getElementById: id => ({ scrollIntoView: () => scrolled.push(id) }) },
  })
  const nodes = predicate => {
    const found = []
    function visit(node) {
      if (!node || typeof node !== "object") return
      if (predicate(node)) found.push(node)
      React.Children.forEach(node.props?.children, visit)
    }
    visit(tree)
    return found
  }
  const render = () => { cursor = 0; tree = Picker(props); effects.splice(0).forEach(run => run()); return tree }
  const runTimers = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(run => run()); render() }
  const settle = async (request, value, fail = false) => {
    request[fail ? "reject" : "resolve"](value)
    await new Promise(resolve => setImmediate(resolve))
    render()
  }
  const control = () => nodes(node => node.props?.role === "combobox")[0]
  const options = () => nodes(node => node.props?.role === "option")
  render()
  return { props, chosen, requests, scrolled, render, runTimers, settle, nodes, control, options,
    html: () => renderToStaticMarkup(tree),
    focus: () => { control().props.onFocus({ target: { select() {} } }); render() },
    type: value => { control().props.onChange({ target: { value } }); render() },
    key: key => { control().props.onKeyDown(keyboard(key)); render() },
    blur: () => { tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null }); render() },
  }
}

test("one labelled editable combobox replaces both the search input and native dropdown", () => {
  const Picker = load({ "@/lib/api": {} })
  const html = renderToStaticMarkup(React.createElement(Picker, { userId: "owner", disabled: false, onChoose() {} }))
  assert.equal((html.match(/<input/g) || []).length, 1)
  assert.match(html, /role="combobox"/)
  assert.match(html, /aria-autocomplete="list"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-required="true"/)
  assert.match(html, /Choose or search decisions/)
  assert.doesNotMatch(html, /<select|Search decisions|role="listbox"/)
})

test("typing filters loaded decision names immediately and queries the same workspace without selecting", async () => {
  const h = harness()
  h.runTimers()
  await h.settle(h.requests[0], response())
  h.focus(); h.type("ADVERTISING")
  assert.equal(h.options().length, 2)
  assert.match(h.html(), /Increase advertising|Reduce advertising costs/)
  assert.doesNotMatch(h.html(), /Increase staffing/)
  assert.deepEqual(h.chosen, [])
  h.runTimers()
  assert.equal(h.requests.at(-1).args[3], "store")
  assert.equal(h.requests.at(-1).args[1], "/business-reports/review-decisions?search=ADVERTISING&offset=0")
  h.type("costs & pricing")
  h.runTimers()
  assert.match(h.requests.at(-1).args[1], /search=costs%20%26%20pricing/)
})

test("choosing a filtered result commits its id, closes the list and keeps its name", async () => {
  const h = harness()
  h.runTimers(); await h.settle(h.requests[0], response())
  h.focus(); h.type("staff")
  h.options()[0].props.onClick(); h.render()
  assert.deepEqual(h.chosen, [2])
  assert.equal(h.control().props["aria-expanded"], false)
  h.props.decisionId = 2; h.render()
  assert.equal(h.control().props.value, "Increase staffing (#2)")
  h.focus(); h.type("advertising"); h.runTimers()
  await h.settle(h.requests.at(-1), response([decisions[0]]))
  h.blur()
  assert.equal(h.control().props.value, "Increase staffing (#2)")
})

test("arrow keys navigate, Enter chooses, and Escape or outside blur keeps the previous selection", async () => {
  const h = harness({ decisionId: 1 })
  h.runTimers(); await h.settle(h.requests[0], response())
  h.focus(); h.type("staff"); h.key("Escape")
  assert.equal(h.control().props.value, "Increase advertising (#1)")
  assert.equal(h.control().props["aria-expanded"], false)
  h.focus(); h.type("not a decision"); h.blur()
  assert.equal(h.control().props.value, "Increase advertising (#1)")
  assert.deepEqual(h.chosen, [])
  h.focus(); h.key("Enter")
  assert.deepEqual(h.chosen, [])
  h.key("ArrowDown")
  assert.equal(h.control().props["aria-activedescendant"], "picker-option-1")
  h.key("ArrowDown")
  assert.equal(h.control().props["aria-activedescendant"], "picker-option-2")
  assert.equal(h.scrolled.at(-1), "picker-option-2")
  h.key("Enter")
  assert.deepEqual(h.chosen, [2])
  h.focus(); h.key("ArrowUp")
  assert.equal(h.control().props["aria-activedescendant"], "picker-option-3")
})

test("typing clears keyboard highlight and arbitrary text cannot select a decision", async () => {
  const h = harness()
  h.runTimers(); await h.settle(h.requests[0], response())
  h.focus(); h.key("ArrowDown"); h.type("staff")
  assert.equal(h.control().props["aria-activedescendant"], undefined)
  h.key("Enter")
  assert.deepEqual(h.chosen, [])
  h.key("ArrowDown"); h.key("Enter")
  assert.deepEqual(h.chosen, [2])
})

test("replaced searches cancel outstanding requests and late responses never replace current results", async () => {
  const h = harness()
  h.runTimers()
  const original = h.requests[0]
  h.focus(); h.type("staff"); h.runTimers()
  const current = h.requests[1]
  assert.equal(original.args[2].signal.aborted, true)
  await h.settle(current, response([decisions[1]]))
  await h.settle(original, response([decisions[0]]))
  assert.equal(h.options().length, 1)
  assert.match(h.html(), /Increase staffing/)
  assert.doesNotMatch(h.html(), /Increase advertising/)
})

test("search pagination keeps the query, deduplicates results and resets when typing resumes", async () => {
  const h = harness()
  h.runTimers(); await h.settle(h.requests[0], response([], 25))
  h.focus(); h.type("advertising"); h.runTimers()
  await h.settle(h.requests.at(-1), response([decisions[0]], 25))
  const more = () => h.nodes(node => node.type === "button" && node.props.children === "Load more decisions")[0]
  let focused = 0
  h.control().props.ref.current = { focus: () => { focused += 1 } }
  more().props.onClick(); h.render(); h.runTimers()
  assert.equal(focused, 1)
  assert.equal(h.control().props["aria-expanded"], true)
  assert.match(h.requests.at(-1).args[1], /search=advertising&offset=25/)
  await h.settle(h.requests.at(-1), response([decisions[0], decisions[2]]))
  assert.equal(h.options().length, 2)
  assert.equal(more(), undefined)
  h.type("staff"); h.runTimers()
  assert.match(h.requests.at(-1).args[1], /search=staff&offset=0/)
})

test("empty results and recoverable failures appear within the dropdown while it remains editable", async () => {
  const h = harness()
  h.focus(); h.runTimers()
  await h.settle(h.requests[0], new Error("Unavailable"), true)
  assert.match(h.html(), /Decisions could not be loaded/)
  assert.equal(h.control().props.disabled, false)
  const retry = h.nodes(node => node.props?.["aria-label"] === "Retry decisions")[0]
  let focused = 0
  h.control().props.ref.current = { focus: () => { focused += 1 } }
  retry.props.onClick(); h.render(); h.runTimers()
  assert.equal(focused, 1)
  assert.equal(h.control().props["aria-expanded"], true)
  await h.settle(h.requests.at(-1), response([]))
  assert.match(h.html(), /No matching active decisions/)
  assert.doesNotMatch(h.html(), /Decisions could not be loaded/)
})

test("an existing id outside the current results is retained, and reselecting it does not reload the analysis", async () => {
  const h = harness({ decisionId: 97 })
  assert.equal(h.control().props.value, "Decision #97")
  h.runTimers(); await h.settle(h.requests[0], response())
  assert.equal(h.control().props.value, "Decision #97")
  h.focus(); h.type("older"); h.runTimers()
  await h.settle(h.requests.at(-1), response([{ id: 97, title: "An older decision" }]))
  h.options()[0].props.onClick(); h.render()
  assert.deepEqual(h.chosen, [])
  assert.equal(h.control().props.value, "An older decision (#97)")
})

test("read-only mode hides the dropdown and workspace changes reset the scoped picker", () => {
  const h = harness({ disabled: true, decisionId: 1 })
  h.focus()
  assert.equal(h.control().props.disabled, true)
  assert.equal(h.control().props["aria-expanded"], false)
  assert.equal(h.options().length, 0)
  const workspace = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(workspace, /<ImpactDecisionPicker key=\{JSON.stringify\(\[userId, workspaceId\]\)\}/)
})
