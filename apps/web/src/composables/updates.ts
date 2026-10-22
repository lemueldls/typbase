import type { AppUpdate, PackageManagerInfo, UpdateInfo, UpdateProgress } from "~/lib/updates";

import {
  checkForUpdate,
  UPDATE_PERMISSION_DENIED,
  updateChannelInfo,
  type UpdateChannel,
} from "~/lib/updates";

import { pushToast } from "./toasts";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "error";

/**
 * One update state for the whole app: the boot check, the Settings row, and
 * the dialog all read and drive this shared instance.
 */
export const useAppUpdates = createSharedComposable(() => {
  const channel = ref<UpdateChannel>("unsupported");
  const manager = ref<PackageManagerInfo | null>(null);
  const currentVersion = ref("");
  const status = ref<UpdateStatus>("idle");
  const info = ref<UpdateInfo | null>(null);
  const progress = ref<UpdateProgress | null>(null);
  const error = ref<string | null>(null);
  const open = ref(false);

  let detected = false;
  let pending: AppUpdate | null = null;

  async function detect(): Promise<UpdateChannel> {
    if (!detected) {
      const result = await updateChannelInfo();
      channel.value = result.channel;
      currentVersion.value = result.currentVersion;
      manager.value = result.manager ?? null;
      detected = true;
    }

    return channel.value;
  }

  function describe(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }

  /** `silent` skips the up-to-date toast and error dialog for the boot check. */
  async function check({ silent = false } = {}): Promise<void> {
    const active = await detect();
    if (active === "unsupported") return;
    // Package repositories lag the release feed, so a managed install only
    // checks when the user asks from Settings.
    if (active === "desktop-package-managed" && silent) return;
    if (status.value === "checking" || status.value === "downloading") return;

    status.value = "checking";
    error.value = null;

    try {
      const update = await checkForUpdate(active, {
        manager: manager.value,
        currentVersion: currentVersion.value,
      });
      if (!update) {
        pending = null;
        info.value = null;
        status.value = "idle";
        if (!silent) pushToast({ titleKey: "updates.upToDate", duration: 2500 });
        return;
      }

      pending = update;
      info.value = update.info;
      status.value = "available";
      open.value = true;
    } catch (cause) {
      pending = null;
      info.value = null;
      status.value = "error";
      error.value = describe(cause);
      if (!silent) open.value = true;
    }
  }

  async function start(): Promise<void> {
    const update = pending;
    if (!update?.start || status.value === "downloading" || status.value === "installing") return;

    status.value = "downloading";
    error.value = null;
    progress.value = { downloaded: 0, total: info.value?.size ?? null };

    try {
      const outcome = await update.start({
        onProgress: (next) => {
          progress.value = next;
        },
      });

      if (outcome === "canceled") {
        status.value = "available";
        return;
      }

      // Desktop relaunches here. The Android installer replaces the process.
      status.value = "installing";
      open.value = false;
    } catch (cause) {
      status.value = "error";
      error.value = describe(cause);
    }
  }

  function dismiss(): void {
    open.value = false;
  }

  /** Retry after an error: re-check when the failure was the check itself. */
  function retry(): void {
    if (pending) void start();
    else void check();
  }

  function isPermissionError(): boolean {
    return error.value === UPDATE_PERMISSION_DENIED;
  }

  return {
    channel,
    manager,
    currentVersion,
    status,
    info,
    progress,
    error,
    open,
    detect,
    check,
    start,
    retry,
    dismiss,
    isPermissionError,
  };
});
