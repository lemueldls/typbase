import type { StorageBackend, StorageEntryStat } from "./backend";

/**
 * Storage through the Tauri shell's Rust commands (`apps/native/src/storage.rs`).
 * The Rust side owns the active root (app data, device documents, or a picked
 * folder) and all paths cross the IPC boundary relative to it, so nothing in
 * the webview ever handles an absolute path except to display it.
 *
 * Writes send the bytes as the raw IPC body with the path in a header; the
 * Rust command accepts both the raw body (desktop) and Android's JSON byte
 * array fallback. Reads return a raw `ArrayBuffer`, or null when missing.
 */

export type TauriStorageMode = "app" | "device" | "custom";

export interface TauriStorageState {
  mode: TauriStorageMode;
  root: string;
  appRoot: string;
  deviceRoot: string | null;
  configured: boolean;
  /** Desktop can open a native folder picker; mobile cannot. */
  canPickFolder: boolean;
}

type InvokeArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array;

interface InvokeOptions {
  headers: HeadersInit;
}

async function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  const core = await import("@tauri-apps/api/core");

  return core.invoke<T>(cmd, args, options);
}

/** True when the page is running inside a Tauri webview. */
export function isTauri(): boolean {
  const scope = globalThis as { isTauri?: boolean; __TAURI_INTERNALS__?: unknown };

  return scope.isTauri === true || "__TAURI_INTERNALS__" in scope;
}

export function tauriStorageState(): Promise<TauriStorageState> {
  return invoke<TauriStorageState>("storage_state");
}

/** Switches the root; `path` is required for `custom`. */
export function configureTauriStorage(
  mode: TauriStorageMode,
  path?: string,
): Promise<TauriStorageState> {
  return invoke<TauriStorageState>("storage_configure", { mode, path: path ?? null });
}

/** Opens the native folder picker (desktop only). Null when cancelled. */
export function pickTauriDirectory(): Promise<string | null> {
  return invoke<string | null>("storage_pick_directory");
}

/** Saves a copy of one storage file through the native dialog (desktop). */
export function exportTauriStorageFile(path: string): Promise<string | null> {
  return invoke<string | null>("storage_export", { path });
}

/** Saves arbitrary bytes through the native save dialog (desktop). */
export function saveExportFile(name: string, bytes: Uint8Array): Promise<string | null> {
  return invoke<string | null>("export_save_file", bytes, {
    headers: { name: encodeURIComponent(name) },
  });
}

/** Joins a relative storage path onto the native root for display or reveal. */
export function resolveStoragePath(state: TauriStorageState, path = ""): string {
  const separator = state.root.includes("\\") ? "\\" : "/";
  const root = state.root.replace(/[\\/]+$/, "");

  return path ? `${root}${separator}${path.split("/").join(separator)}` : state.root;
}

export class TauriBackend implements StorageBackend {
  static isAvailable(): boolean {
    return isTauri();
  }

  static async open(): Promise<TauriBackend> {
    return new TauriBackend();
  }

  async read(path: string): Promise<Uint8Array | null> {
    const buffer = await invoke<ArrayBuffer | null>("storage_read", { path });

    return buffer ? new Uint8Array(buffer) : null;
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    await invoke("storage_write", data, {
      headers: { path: encodeURIComponent(path) },
    });
  }

  async delete(path: string): Promise<void> {
    await invoke<void>("storage_delete", { path });
  }

  async list(path: string): Promise<string[]> {
    return invoke<string[]>("storage_list", { path });
  }

  async stat(path: string): Promise<StorageEntryStat | null> {
    return invoke<StorageEntryStat | null>("storage_stat", { path });
  }

  /**
   * Watches through the Rust `notify` watcher. The event payload carries the
   * watched root so events that race a workspace switch are dropped.
   */
  async watch(path: string, listener: (relativePath: string) => void): Promise<() => void> {
    const event = await import("@tauri-apps/api/event");
    const unlisten = await event.listen<{ root: string; relative: string }>(
      "storage-source-change",
      (message) => {
        if (message.payload.root === path) listener(message.payload.relative);
      },
    );

    try {
      await invoke("storage_watch", { path });
    } catch (cause) {
      unlisten();
      throw cause;
    }

    return () => {
      unlisten();
      void invoke("storage_unwatch", { path }).catch(() => {
        // A stale unwatch is harmless; the next watch replaces the watcher.
      });
    };
  }
}
