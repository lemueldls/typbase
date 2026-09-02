import type { TypstState } from "@typbase/wasm";

import { createTypstState, replaceTypstState } from "~/composables/typst";

/**
 * Panic recovery for the wasm compiler. On wasm32-unknown-unknown a Rust
 * panic aborts the instance (no unwinding), so every call into a dead
 * `TypstState` throws a trap. The only safe move is to build a fresh state
 * and remount everything that talked to the old one. `PageView` owns that
 * remount; this module owns the fresh instance + the singleton swap.
 */

export function tookPanic(state: TypstState): string | null {
  return state.takePanic() ?? null;
}

/** True when the error looks like a wasm trap (typed trap or runtime error). */
export function isWasmTrap(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === "RuntimeError" ||
      /unreachable|memory access out of bounds/i.test(error.message)
    );
  }
  return false;
}

let recovering: Promise<TypstState> | undefined;

/**
 * Creates a fresh TypstState (fonts included), swaps the singleton, and
 * returns it. Concurrent panics share one recovery.
 */
export function recreateTypstState(): Promise<TypstState> {
  recovering ??= createTypstState()
    .then((fresh) => {
      replaceTypstState(fresh);
      return fresh;
    })
    .finally(() => {
      recovering = undefined;
    });
  return recovering;
}
