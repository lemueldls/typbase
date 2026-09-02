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

export interface StorageBackend {
  /** Returns the file bytes, or null when the file does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
}

export function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** In-memory backend. Useful for tests and browsers without OPFS. */
export class MemoryBackend implements StorageBackend {
  private files = new Map<string, Uint8Array>();

  async read(path: string): Promise<Uint8Array | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
}

/** OPFS-backed storage. Directory handles are cached per prefix. */
export class OPFSBackend implements StorageBackend {
  private constructor(
    private readonly root: FileSystemDirectoryHandle,
    private readonly dirCache = new Map<string, FileSystemDirectoryHandle>(),
  ) {}

  static async open(base = "typbase"): Promise<OPFSBackend> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(base, { create: true });

    return new OPFSBackend(dir);
  }

  private async ensureDir(segments: string[]): Promise<FileSystemDirectoryHandle> {
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

    const dir = await this.ensureDir(segments.slice(0, -1));
    const name = segments.at(-1)!;

    try {
      const handle = await dir.getFileHandle(name);
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
    const dir = await this.ensureDir(segments.slice(0, -1));

    try {
      await dir.removeEntry(segments.at(-1)!);
    } catch {
      // Already gone; not worth surfacing.
    }
  }
}
