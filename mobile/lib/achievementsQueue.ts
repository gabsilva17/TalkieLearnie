// Cross-screen queue for achievements newly unlocked during a session.
//
// Mirrors [[planCompletionQueue]]: a `pending` buffer holds entries until the
// user finishes the post-record flow, then `flushPendingAchievements` moves
// them into the live queue so the root-level overlay can render them.
//
// Why pending vs. a "suppressed" flag (the previous design): the achievement
// is enqueued the moment `submitSession`'s post-upload `getProfile` resolves,
// which can land while the user is still in the CelebrationFlow on the
// session screen — BEFORE the result screen has even mounted. A boolean
// "suppress on result-screen mount" flag therefore had a race window where
// the celebration card painted during the upload choreography. With a
// pending buffer, enqueued items are simply invisible to subscribers until
// the result screen unmounts and explicitly flushes. No flag, no race.

import type { ProfileAchievement } from "@/lib/api";

const queue: ProfileAchievement[] = [];
const pending: ProfileAchievement[] = [];
const subscribers = new Set<() => void>();
// Gate covering the whole post-record flow (CelebrationFlow → result.tsx).
// While `true`, enqueues sit silently in `pending`; flipping back to `false`
// auto-promotes them to the live queue so the overlay paints over /plans.
//
// Two ends drive this:
//   - submitSession flips it `true` SYNCHRONOUSLY before kicking off its
//     background profile-refresh IIFE. The IIFE eventually calls
//     `enqueueAchievements`, and we don't know whether that happens during
//     the CelebrationFlow (before result.tsx mounts), during result viewing,
//     or after the user has already navigated away. Setting the gate up
//     front means the IIFE always lands in `pending` regardless of timing.
//   - result.tsx flips it `false` on unmount. That promotes whatever is in
//     pending AND opens the gate so any IIFE that finishes AFTER unmount
//     (slow network, very fast user) lands directly in the live queue and
//     the overlay paints immediately.
//
// The previous design — flipping the gate from result.tsx mount/unmount only
// — had a race: a fast IIFE could finish before result.tsx mounted, with the
// gate still open, and the card would paint OVER the CelebrationFlow.
let gateActive = false;

function notify() {
  subscribers.forEach((fn) => fn());
}

function promotePendingToQueue(): boolean {
  if (pending.length === 0) return false;
  const liveIds = new Set(queue.map((a) => a.id));
  for (const a of pending) {
    if (!liveIds.has(a.id)) {
      queue.push(a);
      liveIds.add(a.id);
    }
  }
  pending.length = 0;
  return true;
}

export function enqueueAchievements(items: ProfileAchievement[]): void {
  if (items.length === 0) return;
  pending.push(...items);
  if (!gateActive) {
    if (promotePendingToQueue()) notify();
  }
}

// Promote everything in the pending buffer to the live queue. Called by the
// result screen's unmount cleanup, so achievements only ever surface after
// the user has read the feedback and left the result page.
export function flushPendingAchievements(): void {
  if (promotePendingToQueue()) notify();
}

export function setAchievementsResultScreenActive(active: boolean): void {
  if (gateActive === active) return;
  gateActive = active;
  if (!active) {
    if (promotePendingToQueue()) notify();
  }
}

export function peekAchievement(): ProfileAchievement | null {
  return queue[0] ?? null;
}

export function dismissAchievement(): void {
  if (queue.length === 0) return;
  queue.shift();
  notify();
}

export function subscribeAchievements(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
