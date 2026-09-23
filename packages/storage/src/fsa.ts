import { DirectoryHandleBackend, pathSegments } from "./backend";

/**
 * A directory the user picked through the File System Access API, persisted
 * as a handle in IndexedDB. Permissions do not survive a reload: callers must
 * re-request them from a user gesture before opening the backend (see
 * `storedDirectory` / `requestDirectoryPermission`).
 */

const DB_NAME = "typbase";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const HANDLE_KEY = "storage-directory";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open IndexedDB"));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = run(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export function isFsaSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/** Opens the picker and remembers the chosen directory. Null when cancelled. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFsaSupported()) return null;

  try {
    const handle = await window.showDirectoryPicker!({ id: "typbase", mode: "readwrite" });
    await saveDirectoryHandle(handle);

    return handle;
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") return null;
    throw reason;
  }
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
  } catch {
    // Persistence can fail (private windows, storage pressure). The handle
    // still works for this session; the next boot falls back to OPFS.
  }
}

export async function storedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === "undefined") return null;

  try {
    const handle = await withStore<FileSystemDirectoryHandle | undefined>("readonly", (store) =>
      store.get(HANDLE_KEY),
    );

    return handle && typeof handle === "object" && "kind" in handle ? handle : null;
  } catch {
    return null;
  }
}

export async function forgetDirectoryHandle(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(HANDLE_KEY));
  } catch {
    // Nothing to forget when IndexedDB is unavailable.
  }
}

export async function directoryPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  // Engines without the permission methods only hand out accessible handles.
  if (typeof handle.queryPermission !== "function") return "granted";

  return handle.queryPermission({ mode: "readwrite" });
}

export async function requestDirectoryPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  if (typeof handle.requestPermission !== "function") return "granted";

  return handle.requestPermission({ mode: "readwrite" });
}

export class FileSystemAccessBackend extends DirectoryHandleBackend {
  get name(): string {
    return this.root.name;
  }

  /**
   * Watches through Chromium's `FileSystemObserver`. Older engines and
   * Firefox/Safari have no equivalent, so they keep the focus sweep.
   */
  async watch(path: string, listener: (relativePath: string) => void): Promise<() => void> {
    if (typeof FileSystemObserver === "undefined") return () => {};

    // A fresh workspace may not have flushed its first snapshot yet.
    const dir = await this.ensureDir(pathSegments(path));
    const observer = new FileSystemObserver((records) => {
      for (const record of records) {
        const parts = record.relativePathComponents;
        if (parts?.length) listener(parts.join("/"));
      }
    });
    await observer.observe(dir, { recursive: true });

    return () => observer.disconnect();
  }
}
