import { bytesToBase64, base64ToBytes } from "./base64";
import { SPACE_COLLECTIONS } from "./constants";
import { SpaceCredential } from "./credentials";
import {
  deleteSpaceRecord,
  listRepoOpsPage,
  nextTid,
  putSpaceRecord,
  type RepoOpsPage,
} from "./repo";

/**
 * The sync loop. Transport-agnostic: host provides document access and
 * persistence, this module decides what to export, when to compact, and how
 * to replay a remote oplog. Loro is the merge engine; the PDS is the
 * transport; nothing else here knows about the protocol details beyond the
 * record shapes in the lexicons.
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
  /** Resolve a member DID to its PDS (required when a member is not cached). */
  getMemberPds?(did: string): Promise<string>;
  engineLog(level: "info" | "warn" | "error", message: string): void;
}

interface QueuedUpdate {
  tid: string;
  docId: string;
  update: string; // base64
  version: string;
  createdAt: number;
}

interface DocSyncState {
  exportedVersion: string | null;
  /** Written update rkeys since the last snapshot, for compaction cleanup. */
  written: string[];
  importedVersion: string | null;
}

interface MemberState {
  pdsUrl: string;
  rev: string | null;
  cursor: string | null;
}

interface SyncState {
  spaceUri: string | null;
  authorityDid: string | null;
  members: Record<string, MemberState>;
  docs: Record<string, DocSyncState>;
  queue: QueuedUpdate[];
  lastExportAt: number;
  lastImportAt: number;
}

export interface TypbaseSyncOptions {
  /** Compaction threshold: updates written since the last snapshot. */
  compactionThreshold?: number;
  pollIntervalMs?: number;
  now?: () => number;
}

const emptyState = (): SyncState => ({
  spaceUri: null,
  authorityDid: null,
  members: {},
  docs: {},
  queue: [],
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

export type SyncEngineRole = "authority" | "member";

export class TypbaseSync {
  private state: SyncState = emptyState();
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing = false;
  private pulling = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly host: SyncHost,
    private readonly store: SyncStore,
    private readonly credential: () => Promise<SpaceCredential>,
    /** DID whose repo this device writes to (the signed-in user). */
    private readonly memberDid: string,
    private readonly options: TypbaseSyncOptions = {},
  ) {}

  async start(spaceUri: string | null, authorityDid: string | null): Promise<void> {
    await this.load();
    this.state.spaceUri = spaceUri;
    this.state.authorityDid = authorityDid;
    await this.save();

    this.stop();
    const poll = this.options.pollIntervalMs ?? 5000;
    this.timer = setInterval(() => void this.pull().catch(() => {}), poll);
    this.pollTimer = undefined;

    await this.flushQueue();
    await this.pull();
  }

  async attach(spaceUri: string, authorityDid: string): Promise<void> {
    await this.load();
    this.state.spaceUri = spaceUri;
    this.state.authorityDid = authorityDid;
    this.state.members = {};
    await this.save();
  }

  async detach(): Promise<void> {
    await this.load();
    this.state.spaceUri = null;
    this.state.authorityDid = null;
    await this.save();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  get hasSpace(): boolean {
    return this.state.spaceUri !== null;
  }

  /** Status line for the settings UI, always safe to read. */
  status(): {
    lastExportAt: number;
    lastImportAt: number;
    pending: number;
    spaceUri: string | null;
  } {
    return {
      lastExportAt: this.state.lastExportAt,
      lastImportAt: this.state.lastImportAt,
      pending: this.state.queue.length,
      spaceUri: this.state.spaceUri,
    };
  }

  /**
   * Called by the storage layer after each local commit batch (debounced
   * upstream). Exports the update immediately into the durable queue; the
   * upload itself happens on flush, so offline edits never block typing.
   */
  async onLocalCommit(docId: string): Promise<void> {
    await this.load();
    if (docId.startsWith("_")) return;
    // internal docs are never synced

    const doc = this.docState(docId);
    const latest = await this.host.exportUpdatesSince(docId, doc.exportedVersion);
    if (!latest) return;

    doc.exportedVersion = latest.version;
    this.state.queue.push({
      tid: nextTid(),
      docId,
      update: bytesToBase64(latest.bytes),
      version: latest.version,
      createdAt: this.now(),
    });
    await this.save();

    if (this.state.spaceUri) void this.flushQueue();
  }

  /** Online now: push queued updates, compact where needed. */
  async flushQueue(): Promise<void> {
    if (this.flushing || this.disposed) return;

    if (!this.state.spaceUri || this.state.queue.length === 0) return;

    this.flushing = true;

    try {
      const credential = await this.credential();
      const pdsUrl = await this.resolveMemberPds(this.memberDid);
      const client = credential.client(pdsUrl);

      let index = 0;
      while (index < this.state.queue.length) {
        const item = this.state.queue[index];
        const doc = this.docState(item.docId);

        await putSpaceRecord(client, {
          space: this.state.spaceUri!,
          repoDid: this.memberDid,
          collection: SPACE_COLLECTIONS.update,
          rkey: item.tid,
          record: {
            docId: item.docId,
            update: item.update,
            version: item.version,
            createdAt: new Date(this.now()).toISOString(),
          },
        });

        this.state.queue.splice(index, 1);
        doc.written.push(item.tid);
        this.state.lastExportAt = this.now();
        await this.save();

        if (doc.written.length >= this.compactionThreshold()) {
          await this.compact(client, item.docId);
        }
      }
    } catch (error) {
      this.host.engineLog("warn", `update flush failed: ${String(error)}`);
    } finally {
      this.flushing = false;
    }
  }

  /** Pull every member repo's oplog and apply what is new. */
  async pull(): Promise<number> {
    if (this.pulling || this.disposed) return 0;
    if (!this.state.spaceUri || !this.state.authorityDid) return 0;
    this.pulling = true;

    let imported = 0;
    try {
      const credential = await this.credential();
      const changed = new Set<string>();

      const memberDids = Object.keys(this.state.members);
      if (memberDids.length === 0) {
        memberDids.push(this.state.authorityDid);
        this.state.members[this.state.authorityDid] = {
          pdsUrl: "",
          rev: null,
          cursor: null,
        };
      }

      for (const repoDid of memberDids) {
        const member = this.state.members[repoDid];
        if (!member) continue;
        try {
          const pdsUrl = member.pdsUrl || (await this.resolveMemberPds(repoDid));
          member.pdsUrl = pdsUrl;
          const client = credential.client(pdsUrl);

          let cursor: string | null = member.cursor;
          let rev: string | null = member.rev;
          let page: RepoOpsPage | null = null;

          do {
            page = await listRepoOpsPage(client, {
              space: this.state.spaceUri!,
              repoDid,
              since: cursor ? null : rev,
              cursor,
            });
            for (const op of page.ops) {
              if (op.cid === null) continue; // a delete: nothing to import
              const value = op.value as Record<string, unknown> | null | undefined;
              if (!value || typeof value !== "object") continue;
              const docId = typeof value.docId === "string" ? value.docId : "";
              if (!docId) continue;

              if (op.collection === SPACE_COLLECTIONS.snapshot) {
                const bytes = base64ToBytes(String(value.snapshot ?? ""));
                const version = String(value.version ?? "");
                const doc = this.docState(docId);
                if (!versionCovers(await this.host.localVersion(docId), version)) {
                  await this.host.importSnapshot(docId, bytes);
                  doc.importedVersion = version;
                  changed.add(docId);
                  imported++;
                }
              } else if (op.collection === SPACE_COLLECTIONS.update) {
                const bytes = base64ToBytes(String(value.update ?? ""));
                const version = String(value.version ?? "");
                const doc = this.docState(docId);
                const coveredByLocal = versionCovers(await this.host.localVersion(docId), version);
                const coveredBySnapshot = doc.importedVersion
                  ? versionCovers(doc.importedVersion, version)
                  : false;
                if (!coveredByLocal && !coveredBySnapshot) {
                  await this.host.importUpdate(docId, bytes);
                  doc.importedVersion = version;
                  changed.add(docId);
                  imported++;
                }
              }
            }
            cursor = page.cursor;
            if (page.commit) rev = page.commit.rev;
          } while (cursor && page.cursor);

          member.cursor = null;
          member.rev = rev;
        } catch (error) {
          this.host.engineLog("warn", `pull failed for ${repoDid}: ${String(error)}`);
        }
      }

      if (changed.size > 0) {
        this.state.lastImportAt = this.now();
        await this.save();
        this.host.onImported([...changed]);
      }
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
      void this.pull().catch(() => {});
    }, 250);
  }

  /** Called on visibilitychange/focus/wake. */
  async wake(): Promise<void> {
    await this.load();
    await this.flushQueue();
    await this.pull();
  }

  /**
   * Records that a doc's current content is already in the space (e.g. right
   * after the attach bootstrap uploaded snapshots), so the first local commit
   * exports only what changed since.
   */
  async markDocExported(docId: string, version: string): Promise<void> {
    await this.load();
    const doc = this.docState(docId);
    doc.exportedVersion = version;
    doc.written = [];
    await this.save();
  }

  private async compact(
    client: ReturnType<SpaceCredential["client"]>,
    docId: string,
  ): Promise<void> {
    const snapshot = await this.host.exportSnapshot(docId);
    const doc = this.docState(docId);
    const rkey = `snap-${nextTid()}`;

    await putSpaceRecord(client, {
      space: this.state.spaceUri!,
      repoDid: this.memberDid,
      collection: SPACE_COLLECTIONS.snapshot,
      rkey,
      record: {
        docId,
        snapshot: bytesToBase64(snapshot.bytes),
        version: snapshot.version,
        createdAt: new Date(this.now()).toISOString(),
      },
    });

    // Superseded update records are hygiene, not correctness: receivers skip
    // them by version. Delete best-effort, keep the queue moving.
    const toDelete = doc.written;
    doc.written = [];
    for (const oldRkey of toDelete.splice(0, 50_000)) {
      try {
        await deleteSpaceRecord(client, {
          space: this.state.spaceUri!,
          repoDid: this.memberDid,
          collection: SPACE_COLLECTIONS.update,
          rkey: oldRkey,
        });
      } catch {
        // Already deleted or transient; the snapshot makes them skippable.
      }
    }
    await this.save();
  }

  private async resolveMemberPds(did: string): Promise<string> {
    const member = this.state.members[did];
    if (member?.pdsUrl) return member.pdsUrl;
    const pdsUrl = await this.host.getMemberPds?.(did);
    if (!pdsUrl) throw new Error(`Cannot resolve PDS for ${did}`);
    this.state.members[did] = {
      ...(this.state.members[did] ?? { rev: null, cursor: null }),
      pdsUrl,
    };
    await this.save();

    return pdsUrl;
  }

  private docState(docId: string): DocSyncState {
    let doc = this.state.docs[docId];
    if (!doc) {
      doc = { exportedVersion: null, written: [], importedVersion: null };
      this.state.docs[docId] = doc;
    }

    return doc;
  }

  private compactionThreshold(): number {
    return this.options.compactionThreshold ?? 100;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async load(): Promise<void> {
    const value = await this.store.get("sync");
    this.state = value ? { ...emptyState(), ...(value as SyncState) } : emptyState();
  }

  private async save(): Promise<void> {
    await this.store.set("sync", this.state);
  }
}
