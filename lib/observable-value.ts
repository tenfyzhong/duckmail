// A small store for mutable process state consumed by useSyncExternalStore.
export function createObservableValue<T>(initialValue: T) {
  let value = initialValue
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: T) => {
      if (Object.is(next, value)) return
      value = next
      listeners.forEach(listener => listener())
    },
  }
}
