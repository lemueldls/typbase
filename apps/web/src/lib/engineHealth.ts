import { ref } from "vue";

import { pushToast } from "~/composables/toasts";
import { recreateTypstState } from "~/lib/typstRecovery";

export type EngineStatus = "ok" | "recovering" | "failed";
export type EngineFailure = "oom" | "trap" | "rebuild-failed";

export interface EngineHealth {
  status: EngineStatus;
  reason: EngineFailure | null;
  message: string;
  /** Traps since the last successful compile. The auto-rebuild breaker. */
  consecutiveFailures: number;
  lastFailureAt: number;
}

const ENGINE_TOAST_ID = "engine";

const health = ref<EngineHealth>({
  status: "ok",
  reason: null,
  message: "",
  consecutiveFailures: 0,
  lastFailureAt: 0,
});

export function useEngineHealth() {
  return health;
}

/** True when a trap may trigger an automatic rebuild: first in the burst, OOM. */
export function canAutoRebuild(isOom: boolean): boolean {
  return isOom && health.value.consecutiveFailures === 0;
}

export function noteTrap(reason: EngineFailure, message: string): void {
  health.value.consecutiveFailures += 1;
  health.value.reason = reason;
  health.value.message = message;
  health.value.lastFailureAt = Date.now();
}

export function beginRecovery(reason: EngineFailure): void {
  health.value.status = "recovering";
  health.value.reason = reason;
  pushToast({
    id: ENGINE_TOAST_ID,
    titleKey: "engine.restarting",
    duration: 0,
  });
}

export function failEngine(reason: EngineFailure, message: string): void {
  health.value.status = "failed";
  health.value.reason = reason;
  health.value.message = message;
  pushFailedToast();
}

function pushFailedToast(): void {
  pushToast({
    id: ENGINE_TOAST_ID,
    titleKey: "engine.failedTitle",
    descriptionKey: "engine.failedBody",
    variant: "danger",
    duration: 0,
    actions: [
      { labelKey: "engine.retry", onClick: requestEngineRetry },
      { labelKey: "engine.reload", onClick: () => window.location.reload() },
    ],
  });
}

/**
 * False while the engine is failed. Engine-backed surfaces bail out on false;
 * the failed toast comes back up so a user who dismissed it still learns why
 * their action did nothing.
 */
export function engineAvailable(): boolean {
  if (health.value.status !== "failed") return true;

  pushFailedToast();

  return false;
}

/** A successful compile clears the breaker and confirms a recovery. */
export function noteCompileSuccess(): void {
  if (health.value.status === "ok" && health.value.consecutiveFailures === 0) return;

  const recovered = health.value.status !== "ok";
  health.value.status = "ok";
  health.value.reason = null;
  health.value.message = "";
  health.value.consecutiveFailures = 0;

  if (recovered) {
    pushToast({ id: ENGINE_TOAST_ID, titleKey: "engine.restarted", duration: 4000 });
  }
}

let retryHandler: (() => void | Promise<void>) | undefined;

export function setEngineRetryHandler(handler: (() => void | Promise<void>) | undefined): void {
  retryHandler = handler;
}

/**
 * Retry from the failed toast or the editor strip. The editor registers a
 * handler so it can rebind after the rebuild; without one (no editor open),
 * rebuilding is enough because the next mount picks up the fresh state.
 */
export function requestEngineRetry(): void {
  if (retryHandler) {
    void retryHandler();

    return;
  }

  beginRecovery("trap");
  void recreateTypstState()
    .then(() => noteCompileSuccess())
    .catch((cause) =>
      failEngine("rebuild-failed", cause instanceof Error ? cause.message : String(cause)),
    );
}
