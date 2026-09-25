import { isTauri } from "@typbase/storage";

export type UpdateChannel =
  | "desktop"
  | "desktop-package-managed"
  | "android-play"
  | "android-sideload"
  | "unsupported";

export interface UpdateInfo {
  /** New version when the channel reports a semver. Play reports a code only. */
  version?: string;
  currentVersion?: string;
  /** Changelog body, plain text. */
  notes?: string;
  date?: string;
  /** Download size in bytes; the Android manifest carries it per ABI. */
  size?: number;
  /** Play owns the download and install UI. */
  play?: boolean;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** How a start attempt ended. Play reports a cancel; the installer paths do not. */
export type UpdateOutcome = "installed" | "canceled";

export interface AppUpdate {
  info: UpdateInfo;
  /** Downloads and hands the update to the installer. */
  start(handlers: { onProgress: (progress: UpdateProgress) => void }): Promise<UpdateOutcome>;
}

/** Thrown when the user declined the "install unknown apps" grant. */
export const UPDATE_PERMISSION_DENIED = "update-permission-denied";

type AndroidDownloadEvent =
  | { event: "started"; data: { total: number | null } }
  | { event: "progress"; data: { downloaded: number; total: number | null } }
  | { event: "finished"; data: { total: number | null } };

interface SideloadUpdate {
  currentVersion: string;
  version: string;
  abi: string;
  url: string;
  sha256: string;
  size: number;
  notes?: string | null;
  publishedAt?: string | null;
}

interface PlayUpdate {
  available: boolean;
  versionCode: number;
  priority: number;
}

interface PlayResult {
  status: string;
  code: number;
}

async function tauriCore() {
  return import("@tauri-apps/api/core");
}

/** Which updater this install should use. */
export async function updateChannel(): Promise<UpdateChannel> {
  if (!isTauri()) return "unsupported";

  try {
    const { invoke } = await tauriCore();
    return await invoke<UpdateChannel>("update_channel");
  } catch (cause) {
    console.warn("[updates] could not resolve the update channel:", cause);
    return "unsupported";
  }
}

/** Checks the channel for a newer build. `null` means the app is current. */
export async function checkForUpdate(channel: UpdateChannel): Promise<AppUpdate | null> {
  switch (channel) {
    case "desktop":
      return checkDesktop();
    case "android-sideload":
      return checkSideload();
    case "android-play":
      return checkPlay();
    default:
      return null;
  }
}

async function checkDesktop(): Promise<AppUpdate | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;

  return {
    info: {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body || undefined,
      date: update.date,
    },
    async start({ onProgress }) {
      let total: number | null = null;
      let downloaded = 0;
      onProgress({ downloaded, total });

      try {
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? null;
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
          }
          onProgress({ downloaded, total });
        });
      } finally {
        void update.close().catch(() => {});
      }

      // Windows hands off to the NSIS installer, which restarts the app itself.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch().catch(() => {});
      return "installed";
    },
  };
}

async function checkSideload(): Promise<AppUpdate | null> {
  const { invoke } = await tauriCore();
  const update = await invoke<SideloadUpdate | null>("android_update_check");
  if (!update) return null;

  return {
    info: {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.notes ?? undefined,
      date: update.publishedAt ?? undefined,
      size: update.size,
    },
    async start({ onProgress }) {
      const { Channel } = await tauriCore();

      if (!(await invoke<boolean>("android_update_can_install"))) {
        await invoke("android_update_request_permission");
        if (!(await invoke<boolean>("android_update_can_install"))) {
          throw new Error(UPDATE_PERMISSION_DENIED);
        }
      }

      const channel = new Channel<AndroidDownloadEvent>();
      channel.onmessage = (event) => {
        if (event.event === "started") {
          onProgress({ downloaded: 0, total: event.data.total });
        } else if (event.event === "progress") {
          onProgress({ downloaded: event.data.downloaded, total: event.data.total });
        }
      };

      const path = await invoke<string>("android_update_download", {
        url: update.url,
        sha256: update.sha256,
        onEvent: channel,
      });

      // The system installer replaces the app; this call may never resolve.
      await invoke("android_update_install", { path });
      return "installed";
    },
  };
}

async function checkPlay(): Promise<AppUpdate | null> {
  const { invoke } = await tauriCore();
  const update = await invoke<PlayUpdate>("android_play_update_check");
  if (!update.available) return null;

  return {
    info: { play: true },
    async start() {
      const result = await invoke<PlayResult>("android_play_update_start");
      return result.status === "success" ? "installed" : "canceled";
    },
  };
}

/** One decimal place under 10, rounded above it, e.g. `42.5 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["kB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }

  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

/** Reads between 0 and 1, or `null` when the total is unknown. */
export function downloadFraction(progress: UpdateProgress | null): number | null {
  if (!progress || !progress.total) return null;
  return Math.min(1, progress.downloaded / progress.total);
}
