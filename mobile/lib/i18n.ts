// Translation function + React hook.
//
// Usage:
//   const t = useT();
//   <Text>{t("plans.title")}</Text>
//   <Text>{t("plans.subtitle_many", { count: 3 })}</Text>
//
// Keys are typed against the PT dictionary (canonical key set). When EN is
// missing a key, the PT value is used as a fallback so the app never renders
// `undefined`.
//
// Re-renders: useT subscribes to the locale store via useSyncExternalStore,
// so flipping the language on the profile toggle triggers a re-render of
// every screen using it.

import { useSyncExternalStore } from "react";

import {
  peekLanguage,
  subscribeLanguage,
  type Language,
} from "@/lib/locale";
import { en } from "@/lib/locales/en";
import { pt } from "@/lib/locales/pt";

// Dotted path into the PT dictionary, narrowed to leaf string values.
type Path<T, P extends string = ""> = {
  [K in Extract<keyof T, string>]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends readonly string[]
      ? `${P}${K}`
      : T[K] extends object
        ? Path<T[K], `${P}${K}.`>
        : never;
}[Extract<keyof T, string>];

export type TranslationKey = Path<typeof pt>;

function get(obj: any, key: string): unknown {
  return key.split(".").reduce<any>((acc, part) => {
    if (acc == null) return undefined;
    return acc[part];
  }, obj);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

// Plain function — pass the language explicitly. Components use useT() for
// auto-rerender on toggle; non-component code (api client, etc.) calls this.
export function translate(
  lang: Language,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const dict = lang === "en" ? en : pt;
  const raw = get(dict, key);
  if (typeof raw === "string") return interpolate(raw, vars);
  // Fallback to PT if EN is missing a leaf or if the key isn't a string.
  const fallback = get(pt, key);
  if (typeof fallback === "string") return interpolate(fallback, vars);
  return key;
}

// Read an array (used for the hash-picked motivational lists). Returns PT
// fallback if EN is missing or the path doesn't point to an array.
export function translateList(lang: Language, key: TranslationKey): readonly string[] {
  const dict = lang === "en" ? en : pt;
  const raw = get(dict, key);
  if (Array.isArray(raw)) return raw as readonly string[];
  const fallback = get(pt, key);
  if (Array.isArray(fallback)) return fallback as readonly string[];
  return [];
}

export function useT(): {
  lang: Language;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  list: (key: TranslationKey) => readonly string[];
} {
  const lang = useSyncExternalStore(subscribeLanguage, peekLanguage, peekLanguage);
  return {
    lang,
    t: (key, vars) => translate(lang, key, vars),
    list: (key) => translateList(lang, key),
  };
}
