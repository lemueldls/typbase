import type { AssetKind, AssetRecord, AssetRemote } from "./assets";

/** Progress the sync panel and tests read. */
export interface AssetSyncStatus {
  syncing: boolean;
  pending: number;
  /** Bumped after a batch that wrote new blobs locally. */
  revision: number;
  lastSyncedAt: number;
  error: string | null;
}

/** The local side of asset sync. The app implements it over WorkspaceStore. */
export interface AssetSyncHost {
  listBlobs(): Promise<Array<{ hash: string }>>;
  /** Blob addresses that pages, settings, or plugin state currently use. */
  referencedBlobHashes(): Promise<Set<string>>;
  readBlob(hash: string): Promise<Uint8Array | null>;
  putBlob(bytes: Uint8Array): Promise<{ hash: string }>;
  hash(bytes: Uint8Array): Promise<string>;
  mime(bytes: Uint8Array): string;
  onBlobStored(listener: (hash: string) => void): () => void;
}

export interface AssetSyncOptions {
  /** How often to look for assets another device uploaded. */
  intervalMs?: number;
  onStatus?: (status: AssetSyncStatus) => void;
}

function kindFor(mime: string): AssetKind {
  if (mime.startsWith("font/")) return "font";
  if (mime.startsWith("image/")) return "image";
  return "file";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Moves content-addressed blobs between the local workspace and its PDS
 * asset collection. Local writes upload immediately. A full pass uploads
 * missing local blobs and downloads missing remote blobs that a page or the
 * workspace settings reference, so a fresh device gets fonts and images
 * without pulling every orphan the space has ever seen.
 */
export class AssetSync {
  private state: AssetSyncStatus = {
    syncing: false,
    pending: 0,
    revision: 0,
    lastSyncedAt: 0,
    error: null,
  };
  private timer: ReturnType<typeof setInterval> | undefined;
  private unsubscribe: (() => void) | undefined;
  private current: Promise<void> | null = null;
  private again = false;
  private importing = false;
  private stopped = false;

  constructor(
    private readonly host: AssetSyncHost,
    private readonly remote: AssetRemote,
    private readonly options: AssetSyncOptions = {},
  ) {}

  status(): AssetSyncStatus {
    return { ...this.state };
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.unsubscribe = this.host.onBlobStored((hash) => {
      void this.uploadAddress(hash).catch((cause) => {
        this.setState({ error: `Could not upload ${hash}: ${errorMessage(cause)}` });
      });
    });
    this.timer = setInterval(() => void this.syncNow(), this.options.intervalMs ?? 60_000);
    void this.syncNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  syncNow(): Promise<void> {
    if (this.current) {
      this.again = true;

      return this.current;
    }

    this.current = this.run().finally(() => {
      this.current = null;
      if (this.again) {
        this.again = false;
        void this.syncNow();
      }
    });

    return this.current;
  }

  private async run(): Promise<void> {
    if (this.stopped) return;
    this.setState({ syncing: true, pending: 0, error: null });

    let error: string | null = null;
    let downloaded = 0;

    try {
      const [remoteRecords, local, referenced] = await Promise.all([
        this.remote.list(),
        this.host.listBlobs(),
        this.host.referencedBlobHashes(),
      ]);
      const localAddresses = new Set(local.map((entry) => entry.hash));
      const remoteByAddress = new Map<string, AssetRecord>();
      const remoteHashes = new Set<string>();
      for (const record of remoteRecords) {
        remoteHashes.add(record.hash);
        if (!remoteByAddress.has(record.address)) remoteByAddress.set(record.address, record);
      }

      const downloads = [...remoteByAddress.values()].filter(
        (record) => referenced.has(record.address) && !localAddresses.has(record.address),
      );
      const uploads = local.filter((entry) => !remoteByAddress.has(entry.hash));
      this.setState({ pending: downloads.length + uploads.length });

      for (const record of downloads) {
        if (this.stopped) return;
        try {
          await this.download(record);
          downloaded += 1;
        } catch (cause) {
          error ??= `Could not download ${record.address}: ${errorMessage(cause)}`;
        }
        this.finishOne();
      }

      for (const entry of uploads) {
        if (this.stopped) return;
        try {
          await this.uploadAddress(entry.hash, remoteHashes);
        } catch (cause) {
          error ??= `Could not upload ${entry.hash}: ${errorMessage(cause)}`;
        }
        this.finishOne();
      }
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      this.setState({
        syncing: false,
        pending: 0,
        ...(downloaded ? { revision: this.state.revision + 1 } : {}),
        lastSyncedAt: Date.now(),
        error,
      });
    }
  }

  private async download(record: AssetRecord): Promise<void> {
    const bytes = await this.remote.download(record);
    const hash = await this.host.hash(bytes);
    if (hash !== record.hash) {
      throw new Error(`hash mismatch: expected ${record.hash}, got ${hash}`);
    }

    this.importing = true;
    try {
      await this.host.putBlob(bytes);
    } finally {
      this.importing = false;
    }
  }

  private async uploadAddress(address: string, known?: Set<string>): Promise<void> {
    if (this.importing || this.stopped) return;

    const bytes = await this.host.readBlob(address);
    if (!bytes) return;

    const hash = await this.host.hash(bytes);
    if (known?.has(hash) || (await this.remote.get(hash))) return;

    const mime = this.host.mime(bytes);
    await this.remote.upload(
      {
        hash,
        address,
        mime,
        size: bytes.byteLength,
        kind: kindFor(mime),
      },
      bytes,
    );
    this.setState({ lastSyncedAt: Date.now(), error: null });
  }

  private finishOne(): void {
    this.setState({ pending: Math.max(0, this.state.pending - 1) });
  }

  private setState(patch: Partial<AssetSyncStatus>): void {
    this.state = { ...this.state, ...patch };
    this.options.onStatus?.(this.status());
  }
}
