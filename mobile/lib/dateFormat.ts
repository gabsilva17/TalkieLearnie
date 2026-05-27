// Locale-aware date / month / weekday helpers. Reads the current language
// from the locale store and returns the right Intl tag + names so screens
// don't hardcode "pt-PT" or PT month arrays.

import type { Language } from "@/lib/locale";
import { peekLanguage } from "@/lib/locale";

export function localeTag(lang?: Language): string {
  return (lang ?? peekLanguage()) === "en" ? "en-US" : "pt-PT";
}

// Full month names, lowercase to match the existing pt-PT visual treatment
// (capitalized via textTransform at the call site). 0-indexed (January = 0).
export function monthNamesFull(lang?: Language): string[] {
  if ((lang ?? peekLanguage()) === "en") {
    return [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ];
  }
  return [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
}

// One-letter weekday headers, ISO order (Monday first).
export function weekdayInitials(lang?: Language): string[] {
  if ((lang ?? peekLanguage()) === "en") {
    return ["M", "T", "W", "T", "F", "S", "S"];
  }
  return ["S", "T", "Q", "Q", "S", "S", "D"];
}

// Short weekday names (3 chars), 0-indexed (Sunday = 0) to match Date.getDay().
export function shortWeekdays(lang?: Language): string[] {
  if ((lang ?? peekLanguage()) === "en") {
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  }
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
}

export function formatShortDate(iso: string, lang?: Language): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(localeTag(lang), {
    day: "2-digit",
    month: "short",
  });
}

export function formatLongMonthDay(d: Date, lang?: Language): string {
  return d.toLocaleDateString(localeTag(lang), {
    day: "numeric",
    month: "long",
  });
}
