import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript")
const { renderToStaticMarkup } = require("react-dom/server")
const compiled = ts.transpileModule(readFileSync(new URL("../components/searchable-select.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
function load(hooks = React, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: name => name === "react" ? hooks : require(name), ...globals })
  return loaded.exports.SearchableSelect
}
const choices = [{ value: "1", label: "Advertising / Meta" }, { value: "2", label: "Orders / Shopify" }, { value: "3", label: "Revenue / Sage", disabled: true }]
function harness(patch = {}) {
  const state = [], effects = [], changes = [], searches = [], scrolled = []
  let cursor = 0, tree
  const props = { label: "Dataset", options: choices, value: "1", placeholder: "Choose or search datasets", onChange: value => changes.push(value), onSearchChange: query => searches.push(query), ...patch }
  const hooks = { ...React, useId: () => "searchable", useRef: initial => state[cursor++] ||= { current: initial }, useState: initial => {
    const index = cursor++
    if (!(index in state)) state[index] = initial
    return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value }]
  }, useEffect: (run, dependencies) => {
    const index = cursor++, previous = state[index]
    if (previous && dependencies.every((value, i) => Object.is(value, previous[i]))) return
    state[index] = dependencies; effects.push(run)
  } }
  const Select = load(hooks, { document: { getElementById: id => ({ scrollIntoView: () => scrolled.push(id) }) } })
  const nodes = predicate => {
    const found = []
    function visit(node) {
      if (!node || typeof node !== "object") return
      if (predicate(node)) found.push(node)
      React.Children.forEach(node.props?.children, visit)
    }
    visit(tree); return found
  }
  const render = () => { cursor = 0; tree = Select(props); effects.splice(0).forEach(run => run()); return tree }
  const input = () => nodes(node => node.props?.role === "combobox")[0]
  const options = () => nodes(node => node.props?.role === "option")
  render()
  return { props, changes, searches, scrolled, nodes, render, input, options, html: () => renderToStaticMarkup(tree),
    focus: () => { input().props.onFocus({ target: { select() {} } }); render() },
    type: value => { input().props.onChange({ target: { value } }); render() },
    key: key => { input().props.onKeyDown({ key, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} }); render() },
    blur: () => { tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null }); render() },
  }
}

test("the shared selector has one labelled editable input and no hidden native select or duplicate search", () => {
  const Select = load()
  const html = renderToStaticMarkup(React.createElement(Select, { label: "Unique value", placeholder: "Choose or search values", value: null, options: [], onChange() {} }))
  assert.equal((html.match(/<input/g) || []).length, 1)
  assert.match(html, /role="combobox"/)
  assert.match(html, /aria-autocomplete="list"/)
  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /<select|role="listbox"/)
})

test("input filters options immediately and forwards the exact query without changing selection", () => {
  const h = harness()
  h.focus(); h.type("sHoPiFy")
  assert.equal(h.options().length, 1)
  assert.match(h.html(), /Orders \/ Shopify/)
  assert.deepEqual(h.searches, ["sHoPiFy"])
  assert.deepEqual(h.changes, [])
  h.key("Enter")
  assert.deepEqual(h.changes, [])
})

test("mouse selection commits one approved value, closes the list and resets remote search", () => {
  const h = harness()
  h.focus(); h.type("orders")
  h.options()[0].props.onClick(); h.render()
  assert.deepEqual(h.changes, ["2"])
  assert.deepEqual(h.searches, ["orders", ""])
  assert.equal(h.input().props["aria-expanded"], false)
  h.props.value = "2"; h.render()
  assert.equal(h.input().props.value, "Orders / Shopify")
})

test("Escape and outside blur discard only the search, preserving the saved value and label", () => {
  const h = harness()
  h.focus(); h.type("not a dataset"); h.key("Escape")
  assert.equal(h.input().props.value, "Advertising / Meta")
  assert.deepEqual(h.changes, [])
  h.focus(); h.type("orders"); h.blur()
  assert.equal(h.input().props.value, "Advertising / Meta")
  assert.equal(h.input().props["aria-expanded"], false)
})

test("keyboard navigation skips disabled choices, scrolls the active item and selects only on Enter", () => {
  const h = harness()
  h.focus(); h.key("ArrowUp")
  assert.equal(h.input().props["aria-activedescendant"], "searchable-option-1")
  assert.equal(h.scrolled.at(-1), "searchable-option-1")
  assert.deepEqual(h.changes, [])
  h.key("Enter")
  assert.deepEqual(h.changes, ["2"])
  h.focus(); h.key("ArrowDown"); h.type("orders")
  assert.equal(h.input().props["aria-activedescendant"], undefined)
})

test("JSON value identities keep missing, empty and literal null distinct", () => {
  const values = [null, "", "null"], options = values.map(value => ({ value: JSON.stringify(value), label: value === null ? "Missing" : value === "" ? "Empty string" : value }))
  const h = harness({ label: "Unique value", value: null, options })
  for (let index = 0; index < options.length; index++) {
    h.focus(); h.options()[index].props.onClick(); h.render()
    assert.equal(h.changes.at(-1), JSON.stringify(values[index]))
  }
})

test("stale saved labels remain explicit, and selecting the same value does not reset analysis", () => {
  const h = harness({ options: [], selectedLabel: "Saved values: 2" })
  assert.equal(h.input().props.value, "Saved values: 2")
  h.focus()
  assert.match(h.html(), /No matching options/)
  h.props.options = choices; h.render()
  h.options()[0].props.onClick(); h.render()
  assert.deepEqual(h.changes, [])
})

test("loading and empty results do not disable search, and footer actions refocus it before paging or retry", () => {
  const h = harness({ options: [], loading: true, footer: React.createElement("button", { type: "button" }, "Load more values") })
  h.focus()
  assert.equal(h.input().props.disabled, false)
  assert.match(h.html(), /Loading\.\.\./)
  let focused = 0
  h.input().props.ref.current = { focus: () => { focused += 1 }, matches: () => false }
  h.nodes(node => Boolean(node.props?.onClickCapture))[0].props.onClickCapture()
  assert.equal(focused, 1)
  assert.equal(h.input().props["aria-expanded"], true)
})

test("disabled controls and inherited disabled fieldsets cannot commit a value", () => {
  const h = harness({ disabled: true })
  h.focus()
  assert.equal(h.input().props["aria-expanded"], false)
  h.props.disabled = false; h.render(); h.focus()
  h.input().props.ref.current = { focus() {}, matches: () => true }
  h.options()[1].props.onClick(); h.render()
  assert.deepEqual(h.changes, [])
})
