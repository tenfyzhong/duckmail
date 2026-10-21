// Cache one browser snapshot per provider mount. getServerSnapshot never calls
// this function, so SSR stays anonymous and never accesses browser storage.
export function createRestoredSnapshot<T>(restore: () => T) {
  let snapshot: { value: T } | undefined
  return () => {
    if (!snapshot) snapshot = { value: restore() }
    return snapshot.value
  }
}
