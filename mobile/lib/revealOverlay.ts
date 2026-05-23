// Cross-screen queue driving the Revolut-style circular reveal overlay.
//
// The TopBar (or any future trigger) measures its source icon's center on
// press and calls `openReveal({ kind, originX, originY })`. A root-level
// overlay subscribes via `useSyncExternalStore` and animates a circle from
// that origin out to cover the whole screen, then renders the reveal content
// inside the expanding circle.
//
// Mirrors [[achievementsQueue]] / [[planCompletionQueue]] in shape: module
// scope queue + subscribers + peek/dismiss. There is intentionally no
// suppression mechanism — only one reveal is ever live at a time and the
// user is the one driving open/close.

export type RevealKind = "ask" | "profile";

export type RevealEntry = {
  kind: RevealKind;
  originX: number;
  originY: number;
};

const queue: RevealEntry[] = [];
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

export function openReveal(entry: RevealEntry): void {
  queue.push(entry);
  notify();
}

export function peekReveal(): RevealEntry | null {
  return queue[0] ?? null;
}

export function dismissReveal(): void {
  if (queue.length === 0) return;
  queue.shift();
  notify();
}

export function subscribeReveal(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
