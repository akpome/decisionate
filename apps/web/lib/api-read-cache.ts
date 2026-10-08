type ReadCacheEntry = {
  expiresAt: number
  promise: Promise<unknown>
}

export class ApiReadCache {
  private entries = new Map<string, ReadCacheEntry>()

  constructor(
    private readonly maxEntries = 128,
    private readonly now = () => Date.now(),
  ) {}

  get<T>(key: string, loader: () => Promise<T>, ttlMs: number): Promise<T> {
    this.prune()
    const cached = this.entries.get(key)
    if (cached) {
      return cached.promise as Promise<T>
    }

    let promise: Promise<T>
    try {
      promise = loader()
    } catch (error) {
      return Promise.reject(error)
    }

    const entry: ReadCacheEntry = {
      // Pending requests remain shared even when their load exceeds the TTL.
      expiresAt: Infinity,
      promise,
    }
    entry.promise = entry.promise.then(
      value => {
        if (this.entries.get(key) === entry) {
          entry.expiresAt = this.now() + ttlMs
          this.prune()
        }
        return value
      },
      error => {
        if (this.entries.get(key) === entry) {
          this.entries.delete(key)
        }
        throw error
      },
    )
    this.entries.set(key, entry)
    this.prune()
    return entry.promise as Promise<T>
  }

  invalidate(prefixes: string[]) {
    for (const key of this.entries.keys()) {
      if (prefixes.some(prefix => key.startsWith(prefix))) {
        this.entries.delete(key)
      }
    }
  }

  clear() {
    this.entries.clear()
  }

  private prune() {
    const now = this.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key)
      }
    }
    if (this.entries.size <= this.maxEntries) return

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== Infinity) {
        this.entries.delete(key)
      }
      if (this.entries.size <= this.maxEntries) break
    }
  }
}
