// Cross-screen queue for plan-completion celebrations.
//
// Timing: `submitSession` detects the transition (last incomplete day just
// closed) and parks the event in a `pending` slot. The CelebrationFlow on the
// session record screen + the rating reveal on the result screen would both
// be shouted-over by a full-screen takeover, so we deliberately hold the
// event back. The result screen calls `flushPendingPlanCompleted` from its
// "VOLTAR AO PLANO" handler — moving the pending event into the live queue
// just before navigating to /plans. The root-level overlay then renders it
// over the plans home, which is exactly the choreography the user asked for
// (Sessão → Resultado → 🎉 PLANO COMPLETO 🎉 → /plans).
//
// Mirrors [[achievementsQueue]] in shape (queue + subscribers + peek/dismiss).

export type PlanCompletedEvent = {
  plan_id: string;
  prep_for: string;
  total_days: number;
};

const queue: PlanCompletedEvent[] = [];
const subscribers = new Set<() => void>();
let pending: PlanCompletedEvent | null = null;

function notify() {
  subscribers.forEach((fn) => fn());
}

export function setPendingPlanCompleted(event: PlanCompletedEvent): void {
  // Guard against double-detection if `submitSession` runs twice for the
  // same final day (network retry, double-tap, etc.). Last write wins —
  // they describe the same plan anyway.
  pending = event;
}

export function flushPendingPlanCompleted(): void {
  if (!pending) return;
  // Don't enqueue the same plan twice if the queue already holds it (e.g.
  // user dismissed once and the flush fires again from a re-render).
  if (!queue.some((e) => e.plan_id === pending!.plan_id)) {
    queue.push(pending);
    notify();
  }
  pending = null;
}

export function peekPlanCompleted(): PlanCompletedEvent | null {
  return queue[0] ?? null;
}

export function dismissPlanCompleted(): void {
  if (queue.length === 0) return;
  queue.shift();
  notify();
}

export function subscribePlanCompleted(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
