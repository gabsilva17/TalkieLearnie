import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// Stale-while-revalidate cache.
//
// Goal: any screen we revisit during the demo (or even on a warm cold-start)
// renders instantly from cache while a background refetch updates state.
// Keys we persist to AsyncStorage are restored on next launch, so the boot
// router can navigate straight into the last plan without a spinner.

type Entry<T> = { data: T; updatedAt: number };

const PERSIST_PREFIX = "swr:";
const memCache = new Map<string, Entry<unknown>>();
const persistKeys = new Set<string>();
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string) {
  subscribers.get(key)?.forEach((fn) => fn());
}

export function getCached<T>(key: string): T | undefined {
  return memCache.get(key)?.data as T | undefined;
}

export function setCached<T>(
  key: string,
  data: T,
  opts?: { persist?: boolean },
): void {
  memCache.set(key, { data, updatedAt: Date.now() });
  if (opts?.persist) {
    persistKeys.add(key);
    AsyncStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(data)).catch(
      () => {},
    );
  } else if (persistKeys.has(key)) {
    AsyncStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(data)).catch(
      () => {},
    );
  }
  notify(key);
}

export function deleteCached(key: string): void {
  memCache.delete(key);
  if (persistKeys.has(key)) {
    AsyncStorage.removeItem(PERSIST_PREFIX + key).catch(() => {});
    persistKeys.delete(key);
  }
  notify(key);
}

export function invalidatePrefix(prefix: string): void {
  for (const key of Array.from(memCache.keys())) {
    if (key.startsWith(prefix)) deleteCached(key);
  }
}

// Drop every entry under `prefix` that isn't in `keep`. Used after a full
// resync to clear orphan rows (plans/sessions that no longer exist on the
// server) without touching the entries we just wrote.
export function pruneCacheByPrefix(prefix: string, keep: Set<string>): void {
  for (const key of Array.from(memCache.keys())) {
    if (key.startsWith(prefix) && !keep.has(key)) deleteCached(key);
  }
}

export function updateCached<T>(key: string, updater: (prev: T | undefined) => T): void {
  const prev = getCached<T>(key);
  setCached(key, updater(prev), { persist: persistKeys.has(key) });
}

function subscribe(key: string, fn: () => void): () => void {
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribers.delete(key);
  };
}

let hydration: Promise<void> | null = null;

export function ensureCacheHydrated(): Promise<void> {
  if (!hydration) {
    hydration = (async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const persisted = keys.filter((k) => k.startsWith(PERSIST_PREFIX));
        if (persisted.length === 0) return;
        const items = await AsyncStorage.multiGet(persisted);
        for (const [storedKey, raw] of items) {
          if (!raw) continue;
          const key = storedKey.slice(PERSIST_PREFIX.length);
          try {
            const data = JSON.parse(raw);
            // updatedAt=0 marks the entry as stale so any focused screen will
            // still trigger a background refetch.
            memCache.set(key, { data, updatedAt: 0 });
            persistKeys.add(key);
          } catch {
            // ignore corrupt entries
          }
        }
      } catch {
        // ignore — cache is best-effort
      }
    })();
  }
  return hydration;
}

// React hook: returns cached value (if any) and re-renders when it changes.
// Doesn't fetch — call your loader separately and write through setCached.
//
// Backed by useSyncExternalStore. The previous implementation (useState +
// useEffect subscribe) had a render→effect race: if setCached fired in the
// window between render and the subscribe effect running, the notify hit
// zero subscribers, the subscription went up late, and nothing ever
// re-rendered the component even though the data was in memCache. That
// stranded the Perfil screen on its ActivityIndicator. useSyncExternalStore
// reconciles the snapshot across subscribe boundaries, so a write that lands
// mid-mount still propagates to the consumer.
export function useCached<T>(key: string | null): T | undefined {
  const sub = useCallback(
    (cb: () => void) => {
      if (!key) return () => {};
      return subscribe(key, cb);
    },
    [key],
  );
  const getSnapshot = useCallback(
    () => (key ? getCached<T>(key) : undefined),
    [key],
  );
  return useSyncExternalStore(sub, getSnapshot, getSnapshot);
}

// React hook: stale-while-revalidate.
// - Returns cached data immediately if present.
// - On focus (or first mount), runs the fetcher, writes to cache, returns fresh.
// - `loading` only flips to true when there is no cache to show.
export function useSWR<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts?: { persist?: boolean; auto?: boolean },
): {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
} {
  const cached = useCached<T>(key);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    if (!key) return;
    setRefreshing(true);
    try {
      const next = await fetcherRef.current();
      setCached(key, next, { persist: opts?.persist });
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setRefreshing(false);
    }
  }, [key, opts?.persist]);

  useEffect(() => {
    if (opts?.auto === false) return;
    void reload();
  }, [reload, opts?.auto]);

  return {
    data: cached,
    error,
    loading: cached === undefined && refreshing,
    refreshing,
    reload,
  };
}
