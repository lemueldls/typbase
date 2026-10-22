import { isTauri } from "@typbase/storage";

export type UpdateChannel =
  | "desktop"
  | "desktop-package-managed"
  | "android-play"
  | "android-sideload"
  | "unsupported";

/** The package manager that owns the executable, when the shell finds one. */
export interface PackageManagerInfo {
  id: string;
  /** Copyable update command. The app never runs it. */
  command?: string;
}

export interface UpdateChannelInfo {
  channel: UpdateChannel;
  currentVersion: string;
  manager?: PackageManagerInfo;
}

export interface UpdateInfo {
  /** New version when the channel reports a semver. Play reports a code only. */
  version?: string;
  currentVersion?: string;
  /** Changelog body, plain text. */
  notes?: string;
  date?: string;
  /** Download size in bytes. The Android manifest carries it per ABI. */
  size?: number;
  /** Play owns the download and install UI. */
  play?: boolean;
  /** The package manager owns the install, so the app only shows instructions. */
  managed?: boolean;
  manager?: PackageManagerInfo;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** How a start attempt ended. Play reports a cancel, but the installer paths do not. */
export type UpdateOutcome = "installed" | "canceled";

export interface AppUpdate {
  info: UpdateInfo;
  /** Downloads and hands the update to the installer. Absent for managed installs. */
  start?(handlers: { onProgress: (progress: UpdateProgress) => void }): Promise<UpdateOutcome>;
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

/** The stable release feed. The updater plugin reads `latest.json`. This is
 *  the API equivalent for installs the app is not allowed to update itself. */
const RELEASE_API = "https://api.github.com/repos/lemueldls/typbase/releases/latest";

interface GitHubRelease {
  tag_name?: string;
  body?: string | null;
  published_at?: string | null;
}

async function tauriCore() {
  return import("@tauri-apps/api/core");
}

/** Which updater this install should use, plus the owning package manager. */
export async function updateChannelInfo(): Promise<UpdateChannelInfo> {
  if (!isTauri()) return { channel: "unsupported", currentVersion: "" };

  try {
    const { invoke } = await tauriCore();
    return await invoke<UpdateChannelInfo>("update_channel");
  } catch (cause) {
    console.warn("[updates] could not resolve the update channel:", cause);
    return { channel: "unsupported", currentVersion: "" };
  }
}

/** Checks the channel for a newer build. `null` means the app is current. */
export async function checkForUpdate(
  channel: UpdateChannel,
  { manager, currentVersion }: { manager: PackageManagerInfo | null; currentVersion: string },
): Promise<AppUpdate | null> {
  switch (channel) {
    case "desktop":
      return checkDesktop();
    case "desktop-package-managed":
      return checkManaged(manager, currentVersion);
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

async function checkManaged(
  manager: PackageManagerInfo | null,
  currentVersion: string,
): Promise<AppUpdate | null> {
  const response = await fetch(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`release check failed (${response.status})`);

  const release = (await response.json()) as GitHubRelease;
  const version = (release.tag_name ?? "")
    .trim()
    .replace(/^typbase-v/, "")
    .replace(/^v/, "");
  if (!version || !isNewerVersion(version, currentVersion)) return null;

  return {
    info: {
      version,
      currentVersion,
      notes: release.body?.trim() || undefined,
      date: release.published_at ?? undefined,
      managed: true,
      manager: manager ?? undefined,
    },
  };
}

/** Semver ordering for the release tag and the installed package version. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const length = Math.max(a.numbers.length, b.numbers.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }

  if (a.prerelease.length === 0 && b.prerelease.length > 0) return true;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return false;

  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined) return false;
    if (right === undefined) return true;
    if (left === right) continue;

    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber) return Number(left) > Number(right);
    if (leftNumber !== rightNumber) return leftNumber;

    return left > right;
  }

  return false;
}

function parseVersion(value: string): { numbers: number[]; prerelease: string[] } {
  const clean = value
    .trim()
    .replace(/^typbase-v/, "")
    .replace(/^v/, "");
  const [core = "", ...rest] = clean.split("-");

  return {
    numbers: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: rest.join("-").split(".").filter(Boolean),
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

      // The system installer replaces the app. This call may never resolve.
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
