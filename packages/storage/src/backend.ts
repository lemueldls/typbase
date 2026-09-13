// `entries()` is part of the File System Access API but lib.dom does not
// declare it (nor the permission methods used by the folder backend).
declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }

  interface FileSystemHandle {
    queryPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
    requestPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  }

  interface Window {
    showDirectoryPicker?(options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: string;
    }): Promise<FileSystemDirectoryHandle>;
  }
}

/**
 * Storage backends. The whole local tree is a flat set of byte-addressed
 * files; the registry decides what lives where.
 *
 * Layout mirrors the plan:
 *
 *   workspaces/<id>/workspace.loro
 *   workspaces/<id>/pages/<pageId>.loro
 *   workspaces/<id>/blobs/<sha256>   (future: media cache)
 */

export interface StorageEntryStat {
  kind: "file" | "directory";
  /** Bytes for files, 0 for directories. */
  size: number;
  /** Epoch milliseconds; absent when the backend has no timestamps. */
  modifiedAt?: number;
}

export interface StorageBackend {
  /** Returns the file bytes, or null when the file does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  /**
   * Entry names (files and directories) directly under `path`. `""` lists the
   * root. Used by the workspace registry to enumerate and remove workspaces.
   */
  list(path: string): Promise<string[]>;
  /** Metadata for one entry, or null when it does not exist. */
  stat(path: string): Promise<StorageEntryStat | null>;
}

export function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** In-memory backend. Useful for tests and browsers without OPFS. */
export class MemoryBackend implements StorageBackend {
  private files = new Map<string, { data: Uint8Array; modifiedAt: number }>();

  async read(path: string): Promise<Uint8Array | null> {
    return this.files.get(path)?.data ?? null;
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, { data, modifiedAt: Date.now() });
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(path: string): Promise<string[]> {
    const prefix = path ? `${path}/` : "";
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name) names.add(name);
    }

    return [...names];
  }

  async stat(path: string): Promise<StorageEntryStat | null> {
    const file = this.files.get(path);
    if (file) {
      return { kind: "file", size: file.data.byteLength, modifiedAt: file.modifiedAt };
    }

    const prefix = `${path}/`;
    if ([...this.files.keys()].some((key) => key.startsWith(prefix))) {
      return { kind: "directory", size: 0 };
    }

    return null;
  }
}

/**
 * A backend over any `FileSystemDirectoryHandle` root: OPFS, or a directory
 * picked through the File System Access API. Directory handles are cached per
 * prefix so hot paths skip repeated `getDirectoryHandle` calls.
 */
export class DirectoryHandleBackend implements StorageBackend {
  protected readonly dirCache = new Map<string, FileSystemDirectoryHandle>();

  constructor(protected readonly root: FileSystemDirectoryHandle) {}

  /** Looks up a directory without creating it; null when a segment is missing. */
  protected async resolveDir(segments: string[]): Promise<FileSystemDirectoryHandle | null> {
    let dir = this.root;
    let prefix = "";

    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const cached = this.dirCache.get(prefix);
      if (cached) {
        dir = cached;
        continue;
      }
      try {
        dir = await dir.getDirectoryHandle(segment);
        this.dirCache.set(prefix, dir);
      } catch {
        return null;
      }
    }

    return dir;
  }

  protected async ensureDir(segments: string[]): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    let prefix = "";

    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const cached = this.dirCache.get(prefix);
      if (cached) {
        dir = cached;
        continue;
      }
      dir = await dir.getDirectoryHandle(segment, { create: true });
      this.dirCache.set(prefix, dir);
    }

    return dir;
  }

  async read(path: string): Promise<Uint8Array | null> {
    const segments = pathSegments(path);
    if (segments.length === 0) return null;

    const dir = await this.resolveDir(segments.slice(0, -1));
    if (!dir) return null;

    try {
      const handle = await dir.getFileHandle(segments.at(-1)!);
      const file = await handle.getFile();

      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const segments = pathSegments(path);
    const dir = await this.ensureDir(segments.slice(0, -1));
    const name = segments.at(-1)!;
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    // Copy into an ArrayBuffer-owned view; TS 5.9 types reject generic
    // Uint8Array views on the write API.
    await writable.write(new Uint8Array(data).buffer);
    await writable.close();
  }

  async delete(path: string): Promise<void> {
    const segments = pathSegments(path);
    if (segments.length === 0) return;

    const dir = await this.resolveDir(segments.slice(0, -1));
    if (!dir) return;

    try {
      await dir.removeEntry(segments.at(-1)!, { recursive: true });
    } catch {
      // Already gone; not worth surfacing.
    }
  }

  async list(path: string): Promise<string[]> {
    const dir = await this.resolveDir(pathSegments(path));
    if (!dir) return [];

    const names: string[] = [];
    for await (const [name] of dir.entries()) {
      names.push(name);
    }

    return names.sort();
  }

  async stat(path: string): Promise<StorageEntryStat | null> {
    const segments = pathSegments(path);
    if (segments.length === 0) {
      return { kind: "directory", size: 0 };
    }

    const dir = await this.resolveDir(segments.slice(0, -1));
    if (!dir) return null;
    const name = segments.at(-1)!;

    try {
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();

      return { kind: "file", size: file.size, modifiedAt: file.lastModified };
    } catch {
      // Not a file; fall through to the directory probe.
    }

    try {
      await dir.getDirectoryHandle(name);
      const entries = await this.list(path);

      return { kind: "directory", size: entries.length, modifiedAt: undefined };
    } catch {
      return null;
    }
  }
}

/** OPFS-backed storage. The root is the fixed `typbase` OPFS directory. */
export class OPFSBackend extends DirectoryHandleBackend {
  static async open(base = "typbase"): Promise<OPFSBackend> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(base, { create: true });

    return new OPFSBackend(dir);
  }
}
