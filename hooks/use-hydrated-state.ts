"use client"

import { useCallback, useMemo, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react"

import { createRestoredSnapshot } from "@/lib/restored-snapshot"

const subscribe = () => () => {}
const serverIsHydrated = () => false
const clientIsHydrated = () => true

export function useHydrated() {
  return useSyncExternalStore(subscribe, clientIsHydrated, serverIsHydrated)
}

// Restore once per mounted provider. Later state updates retain the existing
// persistence behavior and do not turn cross-tab storage changes into logins.
export function useHydratedState<T>(initialValue: T, restore: () => T): [T, Dispatch<SetStateAction<T>>, boolean] {
  const snapshot = useMemo(() => createRestoredSnapshot(restore), [restore])
  const serverSnapshot = useCallback(() => initialValue, [initialValue])
  const restoredValue = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const hydrated = useHydrated()
  const [override, setOverride] = useState<{ value: T } | null>(null)
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setOverride(previous => ({
      value: typeof next === "function"
        ? (next as (value: T) => T)(previous ? previous.value : restoredValue)
        : next,
    }))
  }, [restoredValue])
  return [override ? override.value : restoredValue, setValue, hydrated]
}
