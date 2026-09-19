import { bytesToBase64, base64ToBytes } from "./base64";

/**
 * The sync loop. Loro is the merge engine, airspace is the transport: every
 * device exports local changes as `at.typbase.update` records in its own
 * repo inside the workspace space, and pulls what the other devices wrote.
 * Compaction writes a snapshot and deletes the updates it covers.
 *
 * Pulling lists records newest first and stops at the last rkey seen; update
 * and snapshot keys are TIDs, so that is enough for an incremental poll. Every
 * few minutes the engine scans the whole collection anyway, so an update from
 * a device whose clock trails ours is still picked up.
 *
 * The queue lives in device-local storage, not memory: an edit made offline is
 * uploaded on the next flush, and typing never waits on the network.
 */

export interface SyncStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface SyncHost {
  listDocIds(): Promise<string[]>;
  /** Export every local change since `sinceVersion` (null = none sent yet). */
  exportUpdatesSince(
    docId: string,
    sinceVersion: string | null,
  ): Promise<{ bytes: Uint8Array; version: string } | null>;
  exportSnapshot(docId: string): Promise<{ bytes: Uint8Array; version: string }>;
  /** Apply a remote update. Order does not matter: Loro merges by version. */
  importUpdate(docId: string, bytes: Uint8Array): Promise<void>;
  /** Replace local state with a full snapshot. */
  importSnapshot(docId: string, bytes: Uint8Array): Promise<void>;
  /** Version vector JSON of the local doc, "" when empty/unknown. */
  localVersion(docId: string): Promise<string>;
  /** Called after imported changes landed; the app refreshes editors/previews. */
  onImported(docIds: string[]): void;
  engineLog(level: "info" | "warn" | "error", message: string): void;
}

export interface SyncUpdate {
  rkey: string;
  docId: string;
  /** Base64-encoded Loro update bytes. */
  update: string;
  /** Version vector JSON after the update, for cover checks. */
  version: string;
  createdAt?: string;
}

export interface SyncSnapshot {
  rkey: string;
  docId: string;
  /** Base64-encoded Loro snapshot bytes. */
  snapshot: string;
  version: string;
  createdAt?: string;
}

/** The record operations the engine needs. See `createAirspaceTransport`. */
export interface SyncTransport {
  listUpdates(cursor: string | null): Promise<{
    records: SyncUpdate[];
    cursor: string | null;
  }>;
  listSnapshots(cursor: string | null): Promise<{
    records: SyncSnapshot[];
    cursor: string | null;
  }>;
  createUpdate(record: Omit<SyncUpdate, "rkey">): Promise<string>;
  createSnapshot(record: Omit<SyncSnapshot, "rkey">): Promise<string>;
  deleteUpdates(rkeys: string[]): Promise<void>;
  deleteSnapshots(rkeys: string[]): Promise<void>;
}

interface QueuedUpdate {
  docId: string;
  update: string; // base64
  version: string;
  createdAt: number;
}

interface DocSyncState {
  exportedVersion: string | null;
  /** Version of the newest snapshot this device imported. */
  importedVersion: string | null;
  /** Update rkeys written since the last snapshot, for compaction cleanup. */
  written: string[];
  /** Snapshot rkeys this device wrote; each new snapshot supersedes them. */
  snapshots: string[];
}

interface SyncState {
  docs: Record<string, DocSyncState>;
  queue: QueuedUpdate[];
  /** Newest update rkey seen, so a poll can stop early. */
  lastUpdateRkey: string | null;
  lastSnapshotRkey: string | null;
  lastFullScanAt: number;
  lastExportAt: number;
  lastImportAt: number;
}

export interface TypbaseSyncOptions {
  /** Compaction threshold: updates written since the last snapshot. */
  compactionThreshold?: number;
  pollIntervalMs?: number;
  /** How often a poll ignores the saved rkeys and scans everything. */
  fullScanIntervalMs?: number;
  now?: () => number;
}

const emptyState = (): SyncState => ({
  docs: {},
  queue: [],
  lastUpdateRkey: null,
  lastSnapshotRkey: null,
  lastFullScanAt: 0,
  lastExportAt: 0,
  lastImportAt: 0,
});

/** Version vectors are `{ "<actor>": counter }` maps; compare by counters. */
function parseVersionVector(json: string): Record<string, number> {
  try {
    const value = JSON.parse(json) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(value)) {
        if (typeof v === "number") out[k] = v;
      }

      return out;
    }
  } catch {
    // Not JSON (empty or legacy format); treat as no version.
  }

  return {};
}

/** True when `base` includes every counter in `other`. */
export function versionCovers(baseJson: string, otherJson: string): boolean {
  const base = parseVersionVector(baseJson);
  const other = parseVersionVector(otherJson);
  if (Object.keys(other).length === 0) return false;

  for (const [actor, counter] of Object.entries(other)) {
    if ((base[actor] ?? 0) < counter) return false;
  }

  return true;
}

export class TypbaseSync {
  private state: SyncState = emptyState();
  private timer: ReturnType<typeof setInterval> | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;
  private pulling = false;
  private disposed = false;

  constructor(
    private readonly host: SyncHost,
    private readonly store: SyncStore,
    private readonly transport: SyncTransport,
    private readonly options: TypbaseSyncOptions = {},
  ) {}

  async start(): Promise<void> {
    await this.load();

    this.stop();
    this.timer = setInterval(() => void this.tick(), this.options.pollIntervalMs ?? 5000);
    this.pollTimer = undefined;

    await this.flushQueue();
    await this.pull();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  /** Status line for the settings UI, always safe to read. */
  status(): { lastExportAt: number; lastImportAt: number; pending: number } {
    return {
      lastExportAt: this.state.lastExportAt,
      lastImportAt: this.state.lastImportAt,
      pending: this.state.queue.length,
    };
  }

  /**
   * Pushes snapshots of every local doc so a fresh device has a starting
   * point, then marks each doc exported so the first local commit only sends
   * the delta. Safe to run once per account and workspace.
   */
  async bootstrapSnapshots(): Promise<void> {
    for (const docId of await this.host.listDocIds()) {
      const snapshot = await this.host.exportSnapshot(docId);
      const rkey = await this.transport.createSnapshot({
        docId,
        snapshot: bytesToBase64(snapshot.bytes),
        version: snapshot.version,
        createdAt: this.iso(),
      });
      const doc = this.docState(docId);
      doc.exportedVersion = snapshot.version;
      doc.written = [];
      doc.snapshots = [rkey];
    }
    await this.save();
  }

  /**
   * Called by the storage layer after each local commit batch (debounced
   * upstream). Exports the update into the durable queue immediately; the
   * upload happens on flush, so offline edits never block typing.
   */
  async onLocalCommit(docId: string): Promise<void> {
    await this.load();
    if (docId.startsWith("_")) return;

    const doc = this.docState(docId);
    const latest = await this.host.exportUpdatesSince(docId, doc.exportedVersion);
    if (!latest) return;

    doc.exportedVersion = latest.version;
    this.state.queue.push({
      docId,
      update: bytesToBase64(latest.bytes),
      version: latest.version,
      createdAt: this.now(),
    });
    await this.save();

    void this.flushQueue();
  }

  /** Online now: push queued updates, compact where needed. */
  async flushQueue(): Promise<void> {
    if (this.flushing || this.disposed) return;
    if (this.state.queue.length === 0) return;

    this.flushing = true;

    try {
      while (this.state.queue.length > 0) {
        const item = this.state.queue[0]!;
        const rkey = await this.transport.createUpdate({
          docId: item.docId,
          update: item.update,
          version: item.version,
          createdAt: new Date(item.createdAt).toISOString(),
        });

        this.state.queue.shift();
        const doc = this.docState(item.docId);
        doc.written.push(rkey);
        this.state.lastExportAt = this.now();
        await this.save();

        if (doc.written.length >= this.compactionThreshold()) {
          await this.compact(item.docId);
        }
      }
    } catch (error) {
      this.host.engineLog("warn", `update flush failed: ${String(error)}`);
    } finally {
      this.flushing = false;
    }
  }

  /** Pull records this device has not imported and apply them. */
  async pull(): Promise<number> {
    if (this.pulling || this.disposed) return 0;

    this.pulling = true;

    let imported = 0;
    try {
      const changed = new Set<string>();
      const full = this.needsFullScan();

      imported += await this.pullUpdates(changed, full);
      imported += await this.pullSnapshots(changed, full);

      this.state.lastFullScanAt = this.now();
      if (changed.size > 0) {
        this.state.lastImportAt = this.now();
        this.host.onImported([...changed]);
      }
      await this.save();
    } catch (error) {
      this.host.engineLog("error", `pull failed: ${String(error)}`);
    } finally {
      this.pulling = false;
    }

    return imported;
  }

  /** Relay poke: short-delay pull, or immediate when the poll is overdue. */
  poke(): void {
    if (this.pollTimer) return;

    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.tick();
    }, 250);
  }

  /** Called on visibilitychange/focus/wake. */
  async wake(): Promise<void> {
    await this.load();
    await this.flushQueue();
    await this.pull();
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;
    await this.flushQueue();
    await this.pull();
  }

  private async pullUpdates(changed: Set<string>, full: boolean): Promise<number> {
    let imported = 0;
    let cursor: string | null = null;
    let reachedOld = false;
    let newest = this.state.lastUpdateRkey;

    do {
      const page = await this.transport.listUpdates(cursor);
      for (const record of page.records) {
        if (!full && this.state.lastUpdateRkey && record.rkey <= this.state.lastUpdateRkey) {
          reachedOld = true;
          break;
        }
        if (!newest || record.rkey > newest) newest = record.rkey;

        const doc = this.docState(record.docId);
        const coveredByLocal = versionCovers(
          await this.host.localVersion(record.docId),
          record.version,
        );
        const coveredBySnapshot = doc.importedVersion
          ? versionCovers(doc.importedVersion, record.version)
          : false;
        if (!coveredByLocal && !coveredBySnapshot) {
          await this.host.importUpdate(record.docId, base64ToBytes(record.update));
          doc.importedVersion = record.version;
          changed.add(record.docId);
          imported++;
        }
      }
      cursor = page.cursor;
    } while (cursor && !reachedOld);

    this.state.lastUpdateRkey = newest;

    return imported;
  }

  private async pullSnapshots(changed: Set<string>, full: boolean): Promise<number> {
    let imported = 0;
    let cursor: string | null = null;
    let reachedOld = false;
    let newest = this.state.lastSnapshotRkey;

    do {
      const page = await this.transport.listSnapshots(cursor);
      for (const record of page.records) {
        if (!full && this.state.lastSnapshotRkey && record.rkey <= this.state.lastSnapshotRkey) {
          reachedOld = true;
          break;
        }
        if (!newest || record.rkey > newest) newest = record.rkey;

        const doc = this.docState(record.docId);
        if (!versionCovers(await this.host.localVersion(record.docId), record.version)) {
          await this.host.importSnapshot(record.docId, base64ToBytes(record.snapshot));
          doc.importedVersion = record.version;
          changed.add(record.docId);
          imported++;
        }
      }
      cursor = page.cursor;
    } while (cursor && !reachedOld);

    this.state.lastSnapshotRkey = newest;

    return imported;
  }

  private needsFullScan(): boolean {
    return this.now() - this.state.lastFullScanAt > this.fullScanInterval();
  }

  private async compact(docId: string): Promise<void> {
    const snapshot = await this.host.exportSnapshot(docId);
    const doc = this.docState(docId);
    const updates = doc.written;
    const snapshots = doc.snapshots;

    const rkey = await this.transport.createSnapshot({
      docId,
      snapshot: bytesToBase64(snapshot.bytes),
      version: snapshot.version,
      createdAt: this.iso(),
    });

    doc.written = [];
    doc.snapshots = [rkey];
    await this.save();

    // Superseded records are hygiene, not correctness: receivers skip them by
    // version. Delete best-effort and keep the queue moving.
    await this.transport.deleteUpdates(updates).catch(() => {});
    await this.transport.deleteSnapshots(snapshots).catch(() => {});
  }

  private docState(docId: string): DocSyncState {
    let doc = this.state.docs[docId];
    if (!doc) {
      doc = { exportedVersion: null, importedVersion: null, written: [], snapshots: [] };
      this.state.docs[docId] = doc;
    }

    return doc;
  }

  private compactionThreshold(): number {
    return this.options.compactionThreshold ?? 100;
  }

  private fullScanInterval(): number {
    return this.options.fullScanIntervalMs ?? 5 * 60_000;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private async load(): Promise<void> {
    const value = await this.store.get("sync");
    this.state = value ? { ...emptyState(), ...(value as SyncState) } : emptyState();
  }

  private async save(): Promise<void> {
    await this.store.set("sync", this.state);
  }
}
