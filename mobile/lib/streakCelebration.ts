// Cross-screen queue for the "streak activated today" celebration.
//
// Trigger: the user's first successful session of a new local day flips
// `profile.streak_active_today` from false → true. `submitSession` detects
// this by diffing the pre-submit profile snapshot against the post-submit
// one. There is no AsyncStorage gate — the transition is intrinsically
// once-per-day because the flag only flips false → true once per local day
// on the server.
//
// Layout mirrors [[planCompletionQueue]] and [[achievementsQueue]]: a
// `pending` buffer holds the event during the post-record flow, then the
// result screen's unmount handler promotes pending → live, so the takeover
// paints over /plans instead of fighting the CelebrationFlow / rating
// reveal.

export type StreakUnlockedEvent = {
  streak_current: number;
  streak_best: number;
  is_new_best: boolean;
};

const queue: StreakUnlockedEvent[] = [];
const subscribers = new Set<() => void>();
let pending: StreakUnlockedEvent | null = null;
// Gate covering the whole post-record flow (CelebrationFlow → result.tsx).
// submitSession flips this `true` synchronously before its background
// IIFE so the async streak-detection lands in `pending` regardless of
// network timing. result.tsx flips it `false` on unmount, auto-promoting
// pending. If the IIFE finishes after unmount, the gate is already open
// and the event surfaces immediately.
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
