// Persistent baseline for "which achievements has this device earned?".
//
// Used by `submitSession` to diff before/after a session and surface only the
// achievements that were *just* unlocked. The full profile cache could give
// us this baseline too, but it's volatile: pre-warm may be in-flight when the
// user submits, hydration may miss, the cache may have been cleared. A
// dedicated set of IDs in AsyncStorage is small, reliable, and trivial to
// reason about.
//
// Contract:
// - Every successful `getProfile` response writes its earned IDs here.
// - `submitSession` reads the stored set *before* the post-submit refresh,
//   then diffs against the fresh response and enqueues the delta.
// - The first run on a fresh install reads an empty set, so the very first
//   session legitimately celebrates "first_session" (no false-positive
//   floods because the set genuinely contains nothing).

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ProfileAchievement } from "@/lib/api";

const KEY = "earned_achievement_ids_v1";

export async function readEarnedAchievementIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export async function writeEarnedAchievementIds(
  list: ProfileAchievement[],
): Promise<void> {
  try {
    const ids = list.filter((a) => a.earned).map((a) => a.id);
    await AsyncStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // ignore — best-effort
  }
}
