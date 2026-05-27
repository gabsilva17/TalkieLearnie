// App language: per-user PT / EN toggle persisted in AsyncStorage.
//
// Tiny store with subscribe/peek so screens can re-render via
// useSyncExternalStore (no Context provider, no rerender of the whole tree on
// every change). Mirrors the existing pattern in achievementsQueue /
// planCompletionQueue. Default is "pt" so legacy launches behave identically.
//
// Boot wiring lives in app/_layout.tsx — a one-time AsyncStorage read seeds
// the store before any screen mounts.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type Language = "pt" | "en";
export const DEFAULT_LANGUAGE: Language = "pt";
const KEY = "app_language";

let current: Language = DEFAULT_LANGUAGE;
let warmed = false;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

export function peekLanguage(): Language {
  return current;
}

export function subscribeLanguage(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// One-time async warm-up from disk. Safe to call multiple times; subsequent
// calls are no-ops. Resolves to the seeded value.
export async function warmLanguage(): Promise<Language> {
  if (warmed) return current;
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === "pt" || v === "en") {
      current = v;
    }
  } catch {
    // ignore — keep the default
  }
  warmed = true;
  notify();
  return current;
}

export async function getLanguage(): Promise<Language> {
  if (!warmed) await warmLanguage();
  return current;
}

export async function setLanguage(lang: Language): Promise<void> {
  if (current === lang) return;
  current = lang;
  warmed = true;
  try {
    await AsyncStorage.setItem(KEY, lang);
  } catch {
    // best-effort persistence; runtime value still updated
  }
  notify();
}
