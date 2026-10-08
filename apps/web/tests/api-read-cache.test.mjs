import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const source = readFileSync(new URL("../lib/api-read-cache.ts", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})
const loaded = { exports: {} }
vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports })
const { ApiReadCache } = loaded.exports

function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

test("loaders start immediately in the calling workspace", async () => {
  const cache = new ApiReadCache()
  let activeWorkspace = "first"
  const request = cache.get("dataset:first", async () => activeWorkspace, 1000)
  activeWorkspace = "second"
  assert.equal(await request, "first")
})

test("slow reads stay shared after the original TTL has elapsed", async () => {
  let now = 0, calls = 0
  const cache = new ApiReadCache(128, () => now)
  const load = deferred()
  const loader = () => { calls++; return load.promise }
  const first = cache.get("dataset:user:workspace:1", loader, 15)
  await Promise.resolve()
  now = 100
  const second = cache.get("dataset:user:workspace:1", loader, 15)
  assert.equal(first, second)
  assert.equal(calls, 1)
  load.resolve("rows")
  assert.equal(await second, "rows")
})

test("freshness starts at completion and expired responses reload", async () => {
  let now = 0, calls = 0
  const cache = new ApiReadCache(128, () => now)
  const pending = deferred()
  const first = cache.get("dataset", () => { calls++; return pending.promise }, 15)
  await Promise.resolve()
  now = 100
  pending.resolve("first")
  await first
  now = 114
  assert.equal(await cache.get("dataset", () => { throw new Error("must stay fresh") }, 15), "first")
  now = 115
  assert.equal(await cache.get("dataset", async () => { calls++; return "updated" }, 15), "updated")
  assert.equal(calls, 2)
})

test("failed and synchronously throwing loaders can be retried", async () => {
  for (const loader of [() => Promise.reject(new Error("offline")), () => { throw new Error("offline") }]) {
    const cache = new ApiReadCache()
    await assert.rejects(cache.get("dataset", loader, 15), /offline/)
    assert.equal(await cache.get("dataset", async () => "retry", 15), "retry")
  }
})

test("invalidating a pending read never lets its stale result replace a newer read", async () => {
  const cache = new ApiReadCache()
  const old = deferred()
  const stale = cache.get("dataset:user:workspace:1", () => old.promise, 15)
  cache.invalidate(["dataset:user:workspace:"])
  assert.equal(await cache.get("dataset:user:workspace:1", async () => "new", 15), "new")
  old.resolve("old")
  await stale
  assert.equal(await cache.get("dataset:user:workspace:1", async () => "incorrect", 15), "new")
})

test("an invalidated read's rejection does not delete a newer cached result", async () => {
  const cache = new ApiReadCache()
  const old = deferred()
  const stale = cache.get("dataset", () => old.promise, 15)
  const rejection = assert.rejects(stale, /old failure/)
  cache.invalidate(["dataset"])
  await cache.get("dataset", async () => "new", 15)
  old.reject(new Error("old failure"))
  await rejection
  assert.equal(await cache.get("dataset", async () => "incorrect", 15), "new")
})

test("users and workspaces remain isolated during invalidation", async () => {
  const cache = new ApiReadCache()
  await cache.get("datasets:alice:a", async () => "alice-a", 1000)
  await cache.get("datasets:alice:b", async () => "alice-b", 1000)
  await cache.get("datasets:bob:a", async () => "bob-a", 1000)
  cache.invalidate(["datasets:alice:a"])
  assert.equal(await cache.get("datasets:alice:a", async () => "updated", 1000), "updated")
  assert.equal(await cache.get("datasets:alice:b", async () => "incorrect", 1000), "alice-b")
  assert.equal(await cache.get("datasets:bob:a", async () => "incorrect", 1000), "bob-a")
})

test("the cache evicts old settled entries but never duplicates active requests", async () => {
  const cache = new ApiReadCache(2)
  const pending = deferred()
  const active = cache.get("active", () => pending.promise, 1000)
  await cache.get("old", async () => "old", 1000)
  await cache.get("new", async () => "new", 1000)
  assert.equal(cache.get("active", () => { throw new Error("duplicate") }, 1000), active)
  assert.equal(await cache.get("old", async () => "reloaded", 1000), "reloaded")
  pending.resolve("done")
  await active
})

test("clearing a session removes both settled and pending cached reads", async () => {
  const cache = new ApiReadCache()
  const old = deferred()
  const stale = cache.get("dataset", () => old.promise, 1000)
  await cache.get("organization", async () => "old-org", 1000)
  cache.clear()
  old.resolve("old")
  await stale
  assert.equal(await cache.get("dataset", async () => "new", 1000), "new")
  assert.equal(await cache.get("organization", async () => "new-org", 1000), "new-org")
})
