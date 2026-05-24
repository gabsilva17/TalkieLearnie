import { Plan, api } from "@/lib/api";

// In-memory store that powers the optimistic /plan/pending screen. The
// onboarding form calls `start(input)` to kick off the real `POST /plans`
// request and immediately navigates to /plan/pending; the pending screen
// renders N skeleton DayCards while subscribing to this store. Once the
// plan resolves, the screen drains the warm cache into /plan/[id] so the
// detail screen mounts already populated (no spinner flash).

export type PendingInput = {
  device_id: string;
  prep_for: string;
  target_date: string; // ISO yyyy-mm-dd
  audience_info: string;
  n_days: number; // computed on the client: min(7, daysUntil(target_date))
};

export type PendingState =
  | { status: "idle" }
  | {
      status: "loading";
      input: PendingInput;
      startedAt: number;
    }
  | {
      status: "ready";
      input: PendingInput;
      startedAt: number;
      plan: Plan;
    }
  | {
      status: "error";
      input: PendingInput;
      startedAt: number;
      error: string;
    };

let state: PendingState = { status: "idle" };
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function getPendingPlan(): PendingState {
  return state;
}

export function subscribePendingPlan(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startPendingPlan(input: PendingInput): void {
  state = { status: "loading", input, startedAt: Date.now() };
  notify();
  api
    .createPlan({
      device_id: input.device_id,
      prep_for: input.prep_for,
      target_date: input.target_date,
      audience_info: input.audience_info,
    })
    .then((plan) => {
      if (state.status !== "loading" || state.input !== input) {
        // A newer request superseded this one. Drop the stale result.
        return;
      }
      state = { status: "ready", input, startedAt: state.startedAt, plan };
      notify();
    })
    .catch((e: unknown) => {
      if (state.status !== "loading" || state.input !== input) return;
      const message = e instanceof Error ? e.message : String(e);
      state = { status: "error", input, startedAt: state.startedAt, error: message };
      notify();
    });
}

export function clearPendingPlan(): void {
  if (state.status === "idle") return;
  state = { status: "idle" };
  notify();
}

// One-shot warm cache: /plan/[id] calls this on mount. If the resolved plan
// matches the requested id, the screen uses it as initial state and clears
// the store (so a later visit fetches fresh data from the server).
//
// This is called from a `useState` lazy initializer (during render of
// PlanDetailScreen), so we MUST NOT notify subscribers synchronously — the
// still-mounted PendingPlanScreen subscribes via `useSyncExternalStore` and
// any sync notify here triggers React's "cannot update a component while
// rendering a different component" warning. Defer the reset to a microtask
// so PendingPlanScreen unmounts in peace.
export function consumePendingPlan(planId: string): Plan | null {
  if (state.status !== "ready") return null;
  if (state.plan.id !== planId) return null;
  const plan = state.plan;
  queueMicrotask(() => {
    if (state.status === "ready" && state.plan.id === planId) {
      state = { status: "idle" };
      notify();
    }
  });
  return plan;
}
