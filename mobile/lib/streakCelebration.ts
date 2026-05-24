// Cross-screen queue for the "streak activated today" celebration.
//
// Trigger: the user's first successful session of a new local day flips
// `profile.streak_active_today` from false → true. The backend detects this
// in `POST /sessions` and returns `celebrations.streak_just_activated` on
// the response; mobile parks the event via `setPendingStreakUnlock`. There
// is no AsyncStorage gate — the transition is intrinsically once-per-day
// because the flag only flips false → true once per local day on the
// server.
//
// Unlike [[planCompletionQueue]] and [[achievementsQueue]], the streak
// overlay is **not** held until the result screen unmounts. We want the
// fire-ignition moment to land **during** the CelebrationFlow loading
// phases (the user explicitly asked for this — it makes the streak read as
// a reward of the recording itself, not as a card stacked after the
// feedback). So `setPendingStreakUnlock` promotes straight into the live
// queue and notifies subscribers, and the StreakUnlockedOverlay surfaces
// on top of the celebration choreography immediately.

export type StreakUnlockedEvent = {
  streak_current: number;
  streak_best: number;
  is_new_best: boolean;
};

const queue: StreakUnlockedEvent[] = [];
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

export function setPendingStreakUnlock(event: StreakUnlockedEvent): void {
  // Last write wins — guards against double-detection on retry.
  queue.push(event);
  notify();
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
