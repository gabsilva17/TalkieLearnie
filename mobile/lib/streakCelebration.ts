// Cross-screen queue + AsyncStorage gate for the "streak activated today"
// celebration.
//
// Trigger: the user's first successful session of a new local day flips
// `profile.streak_active_today` from false → true. `submitSession` detects
// this after the post-upload `getProfile` refresh and parks an event here
// (pending buffer). The result screen's unmount handler promotes pending →
// live, so the takeover paints over /plans — same choreography as
// [[planCompletionQueue]].
//
// Why an AsyncStorage gate on top of the queue: relying on
// `streak_active_today` alone would re-celebrate every time the user submits
// a second session the same day (the flag stays true). We persist the local
// ISO date of the last celebration; the diff only fires when stored !== today.
// Persisted so a relaunch mid-day doesn't replay the moment.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type StreakUnlockedEvent = {
  streak_current: number;
  streak_best: number;
  is_new_best: boolean;
};

// Key bumped from v1 → v2 to recover users who got their v1 gate stuck on
// today's date by an earlier buggy code path (pre-emptive write in
// submitSession before the celebration actually surfaced). The new gate is
// only ever written from the overlay's CONTINUAR handler — see
// [[StreakUnlockedOverlay]] — so a missed celebration retries on the next
// session instead of silently locking the user out.
const KEY = "last_streak_celebration_date_v2";

const queue: StreakUnlockedEvent[] = [];
const subscribers = new Set<() => void>();
let pending: StreakUnlockedEvent | null = null;
// Gate covering the whole post-record flow (CelebrationFlow → result.tsx).
// See [[achievementsQueue]] for the full rationale — same shape, same
// rationale. submitSession flips this `true` synchronously before its
// background IIFE so that the async streak-detection inside the IIFE always
// lands in `pending` regardless of network timing. result.tsx flips it back
// to `false` on unmount, which auto-promotes pending. If the IIFE finishes
// AFTER unmount, the gate is open and the event surfaces directly.
let gateActive = false;

function notify() {
  subscribers.forEach((fn) => fn());
}

function promotePendingToQueue(): boolean {
  if (!pending) return false;
  queue.push(pending);
  pending = null;
  return true;
}

export function setPendingStreakUnlock(event: StreakUnlockedEvent): void {
  // Last write wins — guards against double-detection on retry.
  pending = event;
  if (!gateActive) {
    // No gate. Surface right away — handles the race where the async IIFE
    // resolves AFTER result.tsx already unmounted, AND also fires the
    // celebration on subsequent enqueues that happen outside any session
    // flow (none currently, but defensive against future call sites).
    if (promotePendingToQueue()) notify();
  }
}

export function flushPendingStreakUnlock(): void {
  if (promotePendingToQueue()) notify();
}

export function setStreakResultScreenActive(active: boolean): void {
  if (gateActive === active) return;
  gateActive = active;
  if (!active) {
    // Gate opened — promote pending so the overlay paints over the next
    // screen (typically /plans).
    if (promotePendingToQueue()) notify();
  }
}

export function peekStreakUnlock(): StreakUnlockedEvent | null {
  return queue[0] ?? null;
}

export function dismissStreakUnlock(): void {
  if (queue.length === 0) return;
  queue.shift();
  notify();
}

export function subscribeStreakUnlock(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export async function readLastStreakCelebrationDate(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function writeLastStreakCelebrationDate(
  localISODate: string,
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, localISODate);
  } catch {
    // best-effort
  }
}
