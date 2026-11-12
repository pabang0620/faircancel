// Keyed async mutex: operations on the same key run one after another.
export function createKeyedLock() {
  const tails = new Map()
  return async function withLock(key, fn) {
    const previous = tails.get(key) || Promise.resolve()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    tails.set(key, tail)
    await previous
    try {
      return await fn()
    } finally {
      release()
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}
