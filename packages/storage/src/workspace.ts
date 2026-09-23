import type {
  AssetMeta,
  Category,
  ChatMessage,
  ChatThread,
  PageKind,
  PageMeta,
  PluginInstall,
  PluginInstance,
  PluginPatchOp,
  PluginRecord,
  PluginState,
  PluginSurfaceKind,
  Section,
  WorkspaceSettings,
} from "@typbase/typing";
import type { LoroDoc, LoroMap, VersionVector } from "loro-crdt";

import { createId } from "@paralleldrive/cuid2";
import { DEFAULT_SETTINGS } from "@typbase/typing";

import type { StorageBackend, StorageEntryStat } from "./backend";

import { pathSegments } from "./backend";
import { blobPath, hashBytes, isBlobHash, type BlobEntry } from "./blobs";
import { type LoroModule, loadLoro } from "./loro";

const SNAPSHOT_DEBOUNCE_MS = 500;

/** Nested settings are stored as JSON strings in the `settings` map. */
function encodeSetting(value: unknown): string {
  return JSON.stringify(value);
}

function decodeSetting<T>(value: unknown): T {
  if (typeof value !== "string") return JSON.parse("{}") as T;

  try {
    return JSON.parse(value) as T;
  } catch {
    return JSON.parse("{}") as T;
  }
}

/** Like `decodeSetting`, but with a caller-chosen fallback for array fields. */
function decodeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** `"hello world" -> "hello-world"`, lowercase, safe for virtual paths. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

/**
 * Default source for a new notebook: one markup cell with the title, then an
 * empty code cell to type into. The marker line is a comment, so the file
 * still compiles anywhere.
 */
export function notebookTemplate(title: string): string {
  return `// %% [markup]\n= ${title}\n\n// %% [code]\n`;
}

/**
 * Device-local key/value state the store uses to remember which source file
 * it last exported. `LocalState` satisfies this shape.
 */
export interface SourceSyncStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface SourceSyncResult {
  /** Existing pages updated from a changed file. */
  imported: string[];
  /** Pages created from files that had no page. */
  created: string[];
  /** Files that changed while the page also changed; the doc won. */
  conflicts: string[];
  /** Source files written from the doc (new or re-exported). */
  exported: number;
}

/**
 * One mirrored source: its page, content hash, and the file stat seen when the
 * hash was recorded. A matching stat means the file cannot have changed, so
 * the sync skips reading it. Records written before stat tracking have no size
 * and force one re-read.
 */
interface SourceHashRecord {
  pageId: string;
  hash: string;
  size?: number;
  modifiedAt?: number;
}

/** A mirrored `.typ` file's path and stat, without its contents. */
interface SourceFileInfo {
  path: string;
  size: number;
  modifiedAt?: number;
}

/** FNV-1a, hex. Change detection only; not security relevant. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16);
}

function firstHeading(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const match = /^=\s+(.+)$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }

  return undefined;
}

const SOURCE_HASHES_KEY = "sourceHashes";

/**
 * Directories the app owns inside a workspace. Page paths never enter them:
 * `state/` holds the CRDT snapshots, `typbase/` the generated project view,
 * `blobs/` content-addressed media, and `artifacts/` is only claimed in
 * export bundles, which reuse page paths.
 */
export const RESERVED_ROOTS = ["state", "typbase", "blobs", "artifacts"] as const;

/** Backend-relative path of a workspace directory. */
export function workspaceRoot(workspaceId: string): string {
  return `workspaces/${workspaceId}`;
}

export function workspacePath(workspaceId: string): string {
  return `${workspaceRoot(workspaceId)}/state/workspace.loro`;
}

export function pagePath(workspaceId: string, pageId: string): string {
  return `${workspaceRoot(workspaceId)}/state/pages/${pageId}.loro`;
}

export function pluginPath(workspaceId: string, instanceId: string): string {
  return `${workspaceRoot(workspaceId)}/state/plugins/${instanceId}.loro`;
}

/**
 * True when a workspace-relative path is a page source: a visible `.typ` file
 * outside the app-owned roots. Backends pass raw change paths here, so the
 * same rule answers "is this event worth a sync pass". Kept in step with the
 * Rust filter in `apps/native/src/storage.rs`.
 */
export function isSourceChange(relativePath: string): boolean {
  const parts = pathSegments(relativePath);
  if (!parts.length) return false;
  if (parts.some((part) => part.startsWith("."))) return false;
  if ((RESERVED_ROOTS as readonly string[]).includes(parts[0]!)) return false;

  return parts.at(-1)!.endsWith(".typ");
}

/** Doc id space for plugin instance docs; sync treats them like page docs. */
export function pluginDocId(instanceId: string): string {
  return `plugin:${instanceId}`;
}

/** Instance id behind a `plugin:<id>` doc id, or null for other docs. */
export function pluginInstanceOf(docId: string): string | null {
  return docId.startsWith("plugin:") ? docId.slice("plugin:".length) : null;
}

export function chatPath(workspaceId: string, threadId: string): string {
  return `${workspaceRoot(workspaceId)}/state/chats/${threadId}.loro`;
}

/** Doc id space for chat threads; sync treats them like page docs. */
export function chatDocId(threadId: string): string {
  return `chat:${threadId}`;
}

/** Thread id behind a `chat:<id>` doc id, or null for other docs. */
export function chatIdOf(docId: string): string | null {
  return docId.startsWith("chat:") ? docId.slice("chat:".length) : null;
}

export interface WorkspaceStoreOptions {
  /** Snapshot writes are debounced by this much; a crash loses at most this window. */
  snapshotDebounceMs?: number;
  /** Settings name for a workspace doc created from scratch; ignored otherwise. */
  name?: string;
}

export interface CreatePageInput {
  title: string;
  /** Virtual Typst path. Defaults to `pages/<slug>.typ`. */
  path?: string;
  categoryId?: string | null;
  /** "notebook" writes the cell-marker template as the default content. */
  kind?: PageKind;
  /** Typst source. Defaults to a `= Title` heading (or the notebook template). */
  content?: string;
}

/**
 * The local-first core: one workspace Loro doc plus one doc per page,
 * snapshotted to the storage backend on a debounce.
 */
export class WorkspaceStore {
  private pageDocs = new Map<string, LoroDoc>();
  private pluginDocs = new Map<string, LoroDoc>();
  private chatDocs = new Map<string, LoroDoc>();
  private readonly pathForDoc = new Map<LoroDoc, string>();
  private readonly pageIdForDoc = new Map<LoroDoc, string>();
  private dirtyDocs = new Set<LoroDoc>();
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private structureListeners = new Set<() => void>();
  private pageListeners = new Map<string, Set<() => void>>();
  private pluginListeners = new Map<string, Set<() => void>>();
  private chatListeners = new Map<string, Set<() => void>>();
  private commitListeners = new Set<(docId: string) => void>();
  private commitTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingCommits = new Set<string>();
  private loro!: LoroModule;
  private sourceSync?: SourceSyncStore;
  private sourceHashes: Record<string, SourceHashRecord> | undefined;
  private sourceSyncPromise: Promise<SourceSyncResult> | undefined;
  private unwatchSources: (() => void) | undefined;

  private constructor(
    private readonly backend: StorageBackend,
    readonly workspaceId: string,
    private readonly doc: LoroDoc,
    private readonly snapshotDebounceMs = SNAPSHOT_DEBOUNCE_MS,
  ) {}

  /** Backend-relative root of this workspace's own directory. */
  private get root(): string {
    return workspaceRoot(this.workspaceId);
  }

  static async open(
    backend: StorageBackend,
    workspaceId: string,
    options: WorkspaceStoreOptions = {},
  ): Promise<WorkspaceStore> {
    const loro = await loadLoro();
    const { LoroDoc } = loro;

    const path = workspacePath(workspaceId);
    const bytes = await backend.read(path);
    const doc = bytes ? LoroDoc.fromSnapshot(bytes) : new LoroDoc();

    const store = new WorkspaceStore(
      backend,
      workspaceId,
      doc,
      options.snapshotDebounceMs ?? SNAPSHOT_DEBOUNCE_MS,
    );
    store.loro = loro;
    store.pathForDoc.set(doc, path);

    doc.subscribe(() => {
      store.scheduleSave(doc);
      store.scheduleCommit(workspaceId);
      store.emitStructure();
    });

    if (!bytes) await store.seed(options.name);

    return store;
  }

  /**
   * Writes pending snapshots and mirrors page sources to their `page.path`.
   * Called on the snapshot debounce and on page hide so a crash loses little.
   */
  async flush(): Promise<void> {
    for (const doc of this.dirtyDocs) {
      const path = this.pathForDoc.get(doc);
      if (!path) continue;
      const snapshot = doc.export({ mode: "snapshot" });
      await this.backend.write(path, snapshot);
      this.dirtyDocs.delete(doc);

      const pageId = this.pageIdForDoc.get(doc);
      if (pageId && this.sourceSync) await this.exportPageSource(pageId);
    }
  }

  /** Enables the source mirror; call once the device state exists. */
  attachSourceSync(sync: SourceSyncStore): void {
    this.sourceSync = sync;
  }

  /** Disk path of a page's mirrored source. */
  sourcePath(page: PageMeta): string {
    return `${this.root}/${page.path}`;
  }

  /**
   * Watches the page tree for external edits and calls `onChanged` for every
   * change that looks like a source edit. Backends without change
   * notifications (OPFS, memory) return a no-op disposer. Calling this again
   * replaces the previous watcher.
   */
  watchSources(onChanged: () => void): () => void {
    this.unwatchSources?.();

    const watch = this.backend.watch?.bind(this.backend);
    if (!watch) return () => {};

    let dispose: (() => void) | undefined;
    let closed = false;

    void watch(this.root, (relative) => {
      if (isSourceChange(relative)) onChanged();
    })
      .then((result) => {
        if (closed) result();
        else dispose = result;
      })
      .catch((cause) => console.warn("[sources] watch failed:", cause));

    const close = (): void => {
      closed = true;
      dispose?.();
      dispose = undefined;
      this.unwatchSources = undefined;
    };
    this.unwatchSources = close;

    return close;
  }

  /**
   * Writes a file into the generated project view. Request payloads arrive
   * root-absolute (`/typbase/...`); anything outside `typbase/` is rejected so
   * a stray path cannot land on a page source.
   */
  async writeProjectFile(path: string, bytes: Uint8Array): Promise<void> {
    const relative = pathSegments(path).join("/");
    if (!relative.startsWith("typbase/")) {
      throw new Error(`Refusing to write outside typbase/: ${path}`);
    }

    await this.backend.write(`${this.root}/${relative}`, bytes);
  }

  private async loadSourceHashes(): Promise<Record<string, SourceHashRecord>> {
    this.sourceHashes ??=
      (await this.sourceSync?.get<Record<string, SourceHashRecord>>(SOURCE_HASHES_KEY)) ?? {};

    return this.sourceHashes;
  }

  private async saveSourceHashes(): Promise<void> {
    if (!this.sourceSync || !this.sourceHashes) return;

    await this.sourceSync.set(SOURCE_HASHES_KEY, this.sourceHashes);
  }

  private async writeSourceFile(page: PageMeta, text: string): Promise<StorageEntryStat | null> {
    const path = this.sourcePath(page);
    await this.backend.write(path, new TextEncoder().encode(text));

    return this.backend.stat(path).catch(() => null);
  }

  private async exportPageSource(pageId: string): Promise<void> {
    const page = this.getPage(pageId);
    if (!page) return;

    const text = await this.loadPageText(pageId);
    const stat = await this.writeSourceFile(page, text);

    const hashes = await this.loadSourceHashes();
    hashes[page.path] = {
      pageId,
      hash: hashText(text),
      size: stat?.size,
      modifiedAt: stat?.modifiedAt,
    };
    await this.saveSourceHashes();
  }

  /** Reads one mirrored source file, or null when it vanished. */
  private async readSourceFile(path: string): Promise<string | null> {
    const bytes = await this.backend.read(path);

    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  /** Mirrored `.typ` files as `virtual path -> stat`, without reading. */
  private async listSourceFiles(relative = ""): Promise<Map<string, SourceFileInfo>> {
    const files = new Map<string, SourceFileInfo>();
    const dir = relative ? `${this.root}/${relative}` : this.root;
    let entries: string[] = [];
    try {
      entries = await this.backend.list(dir);
    } catch {
      return files;
    }

    for (const name of entries) {
      // Hidden entries are never page content (a `.git` a user dropped in, or
      // anything the app may hide later).
      if (name.startsWith(".")) continue;
      // The app-owned roots are not page content: `typbase/` is generated,
      // `state/` and `blobs/` are internal, `artifacts/` exists in exports.
      if (!relative && (RESERVED_ROOTS as readonly string[]).includes(name)) continue;

      const path = `${dir}/${name}`;
      const stat = await this.backend.stat(path).catch(() => null);
      if (!stat) continue;
      const virtual = relative ? `${relative}/${name}` : name;

      if (stat.kind === "directory") {
        for (const [key, info] of await this.listSourceFiles(virtual)) files.set(key, info);
      } else if (name.endsWith(".typ")) {
        files.set(virtual, { path, size: stat.size, modifiedAt: stat.modifiedAt });
      }
    }

    return files;
  }

  /**
   * Mirrors the page tree and the page docs:
   * - a file with no page creates one;
   * - a changed file imports when the doc has not changed since the last export;
   * - when both changed, the doc wins and the file is re-exported;
   * - pages with no file are exported, so the tree is complete.
   *
   * Deleting a file never deletes a page; remove those in the app.
   */
  syncSources(): Promise<SourceSyncResult> {
    this.sourceSyncPromise ??= this.doSyncSources().finally(() => {
      this.sourceSyncPromise = undefined;
    });

    return this.sourceSyncPromise;
  }

  private async doSyncSources(): Promise<SourceSyncResult> {
    const result: SourceSyncResult = { imported: [], created: [], conflicts: [], exported: 0 };
    if (!this.sourceSync) return result;

    // Compare before flushing: doc text is live, and the recorded hashes
    // describe what was last exported. A dirty doc plus a changed file is a
    // conflict, not an import.
    const hashes = await this.loadSourceHashes();
    const files = await this.listSourceFiles();
    const pages = this.listPages();
    const pagesByPath = new Map(pages.map((page) => [page.path, page]));

    for (const [virtualPath, file] of files) {
      const page = pagesByPath.get(virtualPath);
      const recorded = hashes[virtualPath];

      // A matching stat means the file cannot have changed. Records written
      // before stat tracking have no size, so they fall through to one read.
      if (
        page &&
        recorded?.size !== undefined &&
        recorded.modifiedAt !== undefined &&
        recorded.size === file.size &&
        recorded.modifiedAt === file.modifiedAt
      ) {
        continue;
      }

      const text = await this.readSourceFile(file.path);
      if (text === null) continue;

      const fileHash = hashText(text);

      if (!page) {
        const fallback =
          virtualPath
            .split("/")
            .pop()
            ?.replace(/\.typ$/, "") ?? "Untitled";
        const meta = await this.createPage({
          title: firstHeading(text) ?? fallback,
          path: virtualPath,
          content: text,
        });
        hashes[virtualPath] = {
          pageId: meta.id,
          hash: fileHash,
          size: file.size,
          modifiedAt: file.modifiedAt,
        };
        result.created.push(meta.id);
        continue;
      }

      if (recorded && recorded.hash === fileHash) {
        // Same content under a new stat (a touch, or a record from before
        // stat tracking). Remember the stat so the next sync skips the read.
        recorded.size = file.size;
        recorded.modifiedAt = file.modifiedAt;
        continue;
      }

      const docText = await this.loadPageText(page.id);
      const docHash = hashText(docText);
      const docChanged = !recorded || docHash !== recorded.hash;

      if (!docChanged) {
        if (docText !== text) {
          await this.setPageText(page.id, text);
          // Stale section ranges would point into the old text.
          await this.setSections(page.id, []);
          result.imported.push(page.id);
        }
        hashes[virtualPath] = {
          pageId: page.id,
          hash: fileHash,
          size: file.size,
          modifiedAt: file.modifiedAt,
        };
      } else {
        result.conflicts.push(virtualPath);
        const stat = await this.writeSourceFile(page, docText);
        hashes[virtualPath] = {
          pageId: page.id,
          hash: docHash,
          size: stat?.size,
          modifiedAt: stat?.modifiedAt,
        };
      }
    }

    // Pages with no file (new or externally deleted) get one exported.
    const known = new Set(files.keys());
    for (const page of pages) {
      if (known.has(page.path)) continue;

      const text = await this.loadPageText(page.id);
      const stat = await this.writeSourceFile(page, text);
      hashes[page.path] = {
        pageId: page.id,
        hash: hashText(text),
        size: stat?.size,
        modifiedAt: stat?.modifiedAt,
      };
      result.exported++;
    }

    // Export any dirty docs last; this re-records their hashes too.
    await this.flush();
    await this.saveSourceHashes();

    return result;
  }

  getSettings(): WorkspaceSettings {
    const map = this.doc.getMap("settings");
    const settings = { ...DEFAULT_SETTINGS };

    for (const key of map.keys()) {
      const value = map.get(key);
      if (typeof value !== "object" && value != null) {
        (settings as Record<string, unknown>)[key] = value;
      }
    }

    // Nested configs are JSON strings in the map so partial writes stay
    // last-write-wins per whole config without Loro container surgery.
    settings.publish = {
      ...DEFAULT_SETTINGS.publish,
      ...decodeSetting<Partial<WorkspaceSettings["publish"]>>(map.get("publish")),
    };
    settings.ai = {
      ...DEFAULT_SETTINGS.ai,
      ...decodeSetting<Partial<WorkspaceSettings["ai"]>>(map.get("ai")),
    };
    settings.search = {
      ...DEFAULT_SETTINGS.search,
      ...decodeSetting<Partial<WorkspaceSettings["search"]>>(map.get("search")),
    };
    settings.notebook = {
      ...DEFAULT_SETTINGS.notebook,
      ...decodeSetting<Partial<WorkspaceSettings["notebook"]>>(map.get("notebook")),
    };
    const themeName = map.get("themeName");
    settings.themeName = typeof themeName === "string" ? themeName : DEFAULT_SETTINGS.themeName;
    const themeCustom = decodeSetting<WorkspaceSettings["themeCustom"] | null>(
      map.get("themeCustom"),
    );
    settings.themeCustom =
      themeCustom && typeof themeCustom === "object" && Object.keys(themeCustom).length > 0
        ? themeCustom
        : DEFAULT_SETTINGS.themeCustom;

    const installedPackages = decodeSetting<WorkspaceSettings["installedPackages"] | null>(
      map.get("installedPackages"),
    );
    settings.installedPackages = Array.isArray(installedPackages) ? installedPackages : [];

    // Array fields ride the same JSON-string path; bad entries from another
    // writer are dropped rather than trusted.
    const words = decodeJson<unknown>(map.get("spellcheckWords"), []);
    settings.spellcheckWords = Array.isArray(words)
      ? words.filter((word): word is string => typeof word === "string")
      : [];

    const ignoredLints = decodeJson<unknown>(map.get("spellcheckIgnoredLints"), []);
    settings.spellcheckIgnoredLints = Array.isArray(ignoredLints)
      ? ignoredLints.filter(
          (entry): entry is WorkspaceSettings["spellcheckIgnoredLints"][number] =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { hash?: unknown }).hash === "string",
        )
      : [];

    return settings;
  }

  updateSettings(patch: Partial<WorkspaceSettings>): void {
    const map = this.doc.getMap("settings");
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (key === "publish") map.set("publish", encodeSetting(value));
      else if (key === "ai") map.set("ai", encodeSetting(value));
      else if (key === "search") map.set("search", encodeSetting(value));
      else if (key === "notebook") map.set("notebook", encodeSetting(value));
      else if (key === "themeCustom") map.set("themeCustom", encodeSetting(value));
      else if (
        key === "installedPackages" ||
        key === "spellcheckWords" ||
        key === "spellcheckIgnoredLints"
      )
        map.set(key, encodeSetting(value));
      else map.set(key, value);
    }
    this.doc.commit();
  }

  getPublishSettings() {
    return this.getSettings().publish;
  }

  getAiSettings() {
    return this.getSettings().ai;
  }

  getSearchSettings() {
    return this.getSettings().search;
  }

  listPages(): PageMeta[] {
    const pages = this.doc.getMap("pages");
    const list: PageMeta[] = [];

    for (const id of pages.keys() as string[]) {
      const meta = this.readPageMeta(id);
      if (meta) list.push(meta);
    }

    return list.sort((a, b) => a.updatedAt - b.updatedAt);
  }

  getPage(id: string): PageMeta | undefined {
    return this.readPageMeta(id);
  }

  private readPageMeta(id: string): PageMeta | undefined {
    const map = this.doc.getMap("pages").get(id) as LoroMap | undefined;
    if (!map || map.isDeleted()) return undefined;

    const meta = map.toJSON() as PageMeta;

    return { ...meta, kind: meta.kind === "notebook" ? "notebook" : "document" };
  }

  private writePageMeta(meta: PageMeta): void {
    const pages = this.doc.getMap("pages");
    const map = pages.ensureMergeableMap(meta.id);

    const tags = map.ensureMergeableList("tags");
    for (let i = tags.length - 1; i >= 0; i--) tags.delete(i, 1);
    for (const tag of meta.tags) tags.push(tag);

    map.set("id", meta.id);
    map.set("path", meta.path);
    map.set("title", meta.title);
    map.set("kind", meta.kind);
    map.set("categoryId", meta.categoryId);
    map.set("createdAt", meta.createdAt);
    map.set("updatedAt", meta.updatedAt);
    map.set("pinned", meta.pinned);
    map.set("publishedAt", meta.publishedAt);
    map.set("publishUri", meta.publishUri);

    this.doc.commit();
  }

  async createPage(input: CreatePageInput): Promise<PageMeta> {
    const now = Date.now();
    const kind = input.kind ?? "document";
    const meta: PageMeta = {
      id: createId(),
      path: this.uniquePath(input.path ?? `pages/${slugify(input.title)}.typ`),
      title: input.title.trim() || "Untitled",
      kind,
      categoryId: input.categoryId ?? null,
      tags: [],
      createdAt: now,
      updatedAt: now,
      pinned: false,
      publishedAt: null,
      publishUri: null,
    };

    this.writePageMeta(meta);
    const pageDoc = await this.openPageDoc(meta.id);

    if (input.content !== undefined) {
      pageDoc.getText("content").update(input.content);
    } else if (kind === "notebook") {
      pageDoc.getText("content").update(notebookTemplate(meta.title));
    } else {
      pageDoc.getText("content").update(`= ${meta.title}\n`);
    }
    // Without the commit no subscribe fires and the page snapshot never gets
    // written; a reload then finds the page doc missing and renders it blank.
    pageDoc.commit();

    return meta;
  }

  async updatePageTitle(id: string, title: string): Promise<void> {
    const meta = this.getPage(id);
    if (!meta) return;

    meta.title = title;
    meta.updatedAt = Date.now();
    this.writePageMeta(meta);
  }

  /**
   * Flips a page between document and notebook. The source is untouched:
   * `// %%` markers are plain comments in a document, so nothing is deleted
   * behind the editor's back.
   */
  async updatePageKind(id: string, kind: PageKind): Promise<void> {
    const meta = this.getPage(id);
    if (!meta || meta.kind === kind) return;

    meta.kind = kind;
    meta.updatedAt = Date.now();
    this.writePageMeta(meta);
  }

  /** Sets the publish state after a successful publish/unpublish. */
  async setPagePublished(
    id: string,
    publishedAt: number | null,
    publishUri: string | null,
  ): Promise<void> {
    const meta = this.getPage(id);
    if (!meta) return;

    meta.publishedAt = publishedAt;
    meta.publishUri = publishUri;
    meta.updatedAt = Date.now();
    this.writePageMeta(meta);
  }

  async deletePage(id: string): Promise<void> {
    const meta = this.getPage(id);

    this.doc.getMap("pages").delete(id);
    this.doc.commit();

    const pageDoc = this.pageDocs.get(id);
    if (pageDoc) {
      this.dirtyDocs.delete(pageDoc);
      this.pageIdForDoc.delete(pageDoc);
    }
    this.pageDocs.delete(id);
    await this.backend.delete(pagePath(this.workspaceId, id));

    if (meta) {
      await this.backend.delete(this.sourcePath(meta)).catch(() => {
        // A missing mirror is fine; the page is what matters.
      });
      if (this.sourceHashes) {
        delete this.sourceHashes[meta.path];
        await this.saveSourceHashes();
      }
    }
  }

  private uniquePath(path: string): string {
    const root = pathSegments(path)[0] ?? "";
    if ((RESERVED_ROOTS as readonly string[]).includes(root)) {
      throw new Error(`Page paths cannot start with ${root}/; that directory belongs to the app.`);
    }

    const existing = new Set(this.listPages().map((page) => page.path));
    if (!existing.has(path)) return path;

    const dot = path.lastIndexOf(".");
    const stem = dot === -1 ? path : path.slice(0, dot);
    const ext = dot === -1 ? "" : path.slice(dot);

    for (let i = 2; ; i++) {
      const candidate = `${stem}-${i}${ext}`;
      if (!existing.has(candidate)) return candidate;
    }
  }

  listCategories(): Category[] {
    return this.doc.getList("categories").toJSON() as Category[];
  }

  async addCategory(name: string): Promise<Category> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Category name is empty");

    const category: Category = { id: slugify(trimmed), name: trimmed };
    if (this.listCategories().some((c) => c.id === category.id)) return category;

    const list = this.doc.getList("categories");
    const map = list.insertContainer(list.length, new this.loro.LoroMap()) as LoroMap;
    map.set("id", category.id);
    map.set("name", category.name);
    this.doc.commit();

    return category;
  }

  async removeCategory(id: string): Promise<void> {
    const list = this.doc.getList("categories");
    const value: Category[] = list.toJSON();

    for (let i = value.length - 1; i >= 0; i--) {
      if (value[i]!.id === id) list.delete(i, 1);
    }

    for (const page of this.listPages()) {
      if (page.categoryId === id) page.categoryId = null;
      this.writePageMeta(page);
    }

    this.doc.commit();
  }

  /** Returns the daily note for `date` (YYYY-MM-DD), creating it when missing. */
  async createDailyNote(date: string): Promise<PageMeta> {
    const path = `daily/${date}.typ`;
    const existing = this.listPages().find((page) => page.path === path);
    if (existing) return existing;

    const title = this.formatDate(date);
    const settings = this.getSettings();

    // Neighbor links point at the nearest EXISTING daily note, not the raw
    // next/prev calendar date, so a sparse journal still links to something
    // navigable instead of "none".
    const previous = this.nearestDailyPage(date, -1);
    const next = this.nearestDailyPage(date, 1);

    const content = settings.dailyNoteTemplate
      .replaceAll("{title}", title)
      .replaceAll("{date}", date)
      .replaceAll("{weekday}", this.weekdayName(date))
      .replaceAll("{previous}", previous ?? "none")
      .replaceAll("{next}", next ?? "none");

    return this.createPage({ title, path, content });
  }

  /** Nearest existing daily note strictly before/after `date`, by path order. */
  private nearestDailyPage(date: string, direction: -1 | 1): string | undefined {
    let best: PageMeta | undefined;
    for (const page of this.listPages()) {
      const match = /^daily\/(\d{4}-\d{2}-\d{2})\.typ$/.exec(page.path);
      if (!match) continue;
      const day = match[1]!;
      if (direction === -1 && day >= date) continue;
      if (direction === 1 && day <= date) continue;
      if (!best) {
        best = page;
      } else {
        const bestDay = /^daily\/(\d{4}-\d{2}-\d{2})\.typ$/.exec(best.path)![1]!;
        if (direction === -1 ? day > bestDay : day < bestDay) best = page;
      }
    }

    return best?.id;
  }

  /** Locale-aware title: "Wednesday, Sep 16, 2026" in the workspace locale. */
  private formatDate(date: string): string {
    const settings = this.getSettings();
    const locale = settings.locale && settings.locale !== "auto" ? settings.locale : undefined;
    try {
      return new Intl.DateTimeFormat(locale, {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`));
    } catch {
      return date;
    }
  }

  /** Long weekday via Intl ("auto" locale = environment default, browser in app). */
  private weekdayName(date: string): string {
    const settings = this.getSettings();
    const locale = settings.locale && settings.locale !== "auto" ? settings.locale : undefined;
    try {
      return new Intl.DateTimeFormat(locale, {
        weekday: "long",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`));
    } catch {
      return date;
    }
  }

  private shiftDate(date: string, days: number): string {
    const parsed = new Date(`${date}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);

    return parsed.toISOString().slice(0, 10);
  }

  private async readDoc(path: string): Promise<LoroDoc> {
    const { LoroDoc } = await loadLoro();
    const bytes = await this.backend.read(path);

    return bytes ? LoroDoc.fromSnapshot(bytes) : new LoroDoc();
  }

  private async openPageDoc(pageId: string): Promise<LoroDoc> {
    const cached = this.pageDocs.get(pageId);
    if (cached) return cached;

    const path = pagePath(this.workspaceId, pageId);
    const doc = await this.readDoc(path);

    this.pageDocs.set(pageId, doc);
    this.pathForDoc.set(doc, path);
    this.pageIdForDoc.set(doc, pageId);

    doc.subscribe(() => {
      this.scheduleSave(doc);
      this.emitPage(pageId);
      this.scheduleCommit(pageId);
    });

    return doc;
  }

  private async openPluginDoc(instanceId: string): Promise<LoroDoc> {
    const cached = this.pluginDocs.get(instanceId);
    if (cached) return cached;

    const path = pluginPath(this.workspaceId, instanceId);
    const doc = await this.readDoc(path);

    this.pluginDocs.set(instanceId, doc);
    this.pathForDoc.set(doc, path);

    doc.subscribe(() => {
      this.scheduleSave(doc);
      this.emitPlugin(instanceId);
      this.scheduleCommit(pluginDocId(instanceId));
    });

    return doc;
  }

  private async openChatDoc(threadId: string): Promise<LoroDoc> {
    const cached = this.chatDocs.get(threadId);
    if (cached) return cached;

    const path = chatPath(this.workspaceId, threadId);
    const doc = await this.readDoc(path);

    this.chatDocs.set(threadId, doc);
    this.pathForDoc.set(doc, path);

    doc.subscribe(() => {
      this.scheduleSave(doc);
      this.emitChat(threadId);
      this.scheduleCommit(chatDocId(threadId));
    });

    return doc;
  }

  getPageText(pageId: string): string {
    const doc = this.pageDocs.get(pageId);
    if (!doc) return "";

    return doc.getText("content").toString();
  }

  /** Opens the page doc if needed, then returns its content. */
  async loadPageText(pageId: string): Promise<string> {
    await this.openPageDoc(pageId);

    return this.getPageText(pageId);
  }

  async setPageText(pageId: string, text: string): Promise<void> {
    const doc = await this.openPageDoc(pageId);
    const content = doc.getText("content");
    if (content.toString() === text) return;

    content.update(text);
    doc.commit();
  }

  /** Subscribe to a page doc's changes (content or meta). */
  async onPageDocChange(pageId: string, listener: () => void): Promise<() => void> {
    await this.openPageDoc(pageId);
    let listeners = this.pageListeners.get(pageId);
    if (!listeners) {
      listeners = new Set();
      this.pageListeners.set(pageId, listeners);
    }
    listeners.add(listener);

    return () => listeners.delete(listener);
  }

  /**
   * Fires once per debounced commit batch with the doc id that changed. The
   * sync engine exports an update per batch from here; a crash between
   * commits loses nothing because exports are relative to the last exported
   * version, not to a queue of snapshots.
   */
  onLocalCommit(listener: (docId: string) => void): () => void {
    this.commitListeners.add(listener);

    return () => this.commitListeners.delete(listener);
  }

  /** docId space: workspace id, page ids, `plugin:<id>` and `chat:<id>` docs. */
  async getDocById(docId: string): Promise<LoroDoc | null> {
    if (docId === this.workspaceId) return this.doc;

    const instanceId = pluginInstanceOf(docId);
    if (instanceId !== null) {
      if (!this.getPluginInstance(instanceId)) return null;

      return this.openPluginDoc(instanceId);
    }

    const threadId = chatIdOf(docId);
    if (threadId !== null) {
      if (!this.getChat(threadId)) return null;

      return this.openChatDoc(threadId);
    }

    if (!this.getPage(docId)) return null;

    return this.openPageDoc(docId);
  }

  async listDocIds(): Promise<string[]> {
    const ids = [this.workspaceId];
    for (const page of this.listPages()) ids.push(page.id);
    for (const instance of this.listPluginInstances()) ids.push(pluginDocId(instance.id));
    for (const thread of this.listChats()) ids.push(chatDocId(thread.id));

    return ids;
  }

  /**
   * Exports local changes since `sinceVersion` (null = from the beginning).
   * Returns null when nothing changed. Version strings are
   * `JSON.stringify(Object.fromEntries(versionVector))`, matching how the
   * sync engine compares them.
   */
  async exportUpdatesSince(
    docId: string,
    sinceVersion: string | null,
  ): Promise<{ bytes: Uint8Array; version: string } | null> {
    const doc = await this.getDocById(docId);
    if (!doc) return null;

    const since = sinceVersion ? this.versionFromJson(sinceVersion) : null;
    const bytes = doc.export({
      mode: "update",
      ...(since ? { from: since } : {}),
    });
    if (bytes.length === 0 && sinceVersion === null) return null;

    if (sinceVersion !== null && bytes.length === 0) return null;

    return { bytes, version: this.versionToJson(doc) };
  }

  async exportDocSnapshot(docId: string): Promise<{ bytes: Uint8Array; version: string }> {
    const doc = await this.getDocById(docId);
    if (!doc) throw new Error(`No doc named ${docId}`);

    return {
      bytes: doc.export({ mode: "snapshot" }),
      version: this.versionToJson(doc),
    };
  }

  async importDocBytes(docId: string, bytes: Uint8Array): Promise<void> {
    const doc = await this.getDocById(docId);
    if (!doc) {
      // A remote update for a page we have never opened: the page registry
      // decides what exists, so this is a no-op rather than a ghost doc.
      return;
    }

    if (bytes.length === 0) return;

    doc.import(bytes);
  }

  async getDocVersion(docId: string): Promise<string> {
    const doc = await this.getDocById(docId);
    if (!doc) return "";

    return this.versionToJson(doc);
  }

  private versionToJson(doc: LoroDoc): string {
    const vv = doc.version();

    return JSON.stringify(Object.fromEntries(vv.toJSON()));
  }

  private versionFromJson(json: string): VersionVector {
    const { VersionVector } = this.loro;
    try {
      const entries = Object.entries(JSON.parse(json) as Record<string, number>);

      return VersionVector.parseJSON(new Map(entries.map(([k, v]) => [k as never, v])));
    } catch {
      // The wasm binding requires the argument (even for "none"); undefined
      // means an empty vector.
      return new VersionVector(undefined);
    }
  }

  /** Assets map: reference path -> blob metadata. Written when media is used. */
  getAssets(pageId: string): Record<string, AssetMeta> {
    const doc = this.pageDocs.get(pageId);
    if (!doc) return {};

    const map = doc.getMap("assets");
    const out: Record<string, AssetMeta> = {};
    for (const key of map.keys() as string[]) {
      const value = map.get(key);
      if (!value || typeof value !== "object") continue;

      // Mergeable children read back as LoroMap; plain values are already data.
      const plain =
        typeof (value as LoroMap).toJSON === "function"
          ? (value as LoroMap).toJSON()
          : (value as unknown);
      out[key] = plain as AssetMeta;
    }

    return out;
  }

  async setAsset(pageId: string, ref: string, asset: AssetMeta): Promise<void> {
    const doc = await this.openPageDoc(pageId);
    const map = doc.getMap("assets");
    const entry = map.ensureMergeableMap(ref);
    for (const [key, value] of Object.entries(asset)) entry.set(key, value);
    doc.commit();
  }

  async removeAsset(pageId: string, ref: string): Promise<void> {
    const doc = await this.openPageDoc(pageId);
    doc.getMap("assets").delete(ref);
    doc.commit();
  }

  /** Typed sections extracted from the Typst AST, stored per page doc. */
  getSections(pageId: string): Section[] {
    const doc = this.pageDocs.get(pageId);
    if (!doc) return [];

    return doc.getList("sections").toJSON() as Section[];
  }

  async setSections(pageId: string, sections: Section[]): Promise<void> {
    const doc = await this.openPageDoc(pageId);
    const list = doc.getList("sections");
    for (let i = list.length - 1; i >= 0; i--) list.delete(i, 1);
    for (const section of sections) {
      const map = list.insertContainer(list.length, new this.loro.LoroMap()) as LoroMap;
      for (const [k, v] of Object.entries(section)) map.set(k, v);
    }
    doc.commit();
  }

  // ---- Plugins -----------------------------------------------------------
  //
  // Installed plugins and their instances live in the workspace doc, so the
  // registry syncs like pages and categories. Instance data lives in its own
  // doc (`plugin:<instanceId>`), which the sync engine already handles
  // generically through listDocIds/getDocById.

  listPluginInstalls(): PluginInstall[] {
    const plugins = this.doc.getMap("plugins");
    const list: PluginInstall[] = [];

    for (const id of plugins.keys() as string[]) {
      const install = this.readPluginInstall(id);
      if (install) list.push(install);
    }

    return list.sort((a, b) => a.installedAt - b.installedAt);
  }

  getPluginInstall(id: string): PluginInstall | undefined {
    return this.readPluginInstall(id);
  }

  setPluginInstall(install: PluginInstall): void {
    const plugins = this.doc.getMap("plugins");
    const map = plugins.ensureMergeableMap(install.id);
    map.set("id", install.id);
    map.set("version", install.version);
    map.set("enabled", install.enabled);
    map.set("source", install.source);
    map.set("installedAt", install.installedAt);
    map.set("manifest", install.manifest);
    this.doc.commit();
  }

  /** Removes the install and every instance that belongs to it. */
  async uninstallPlugin(pluginId: string): Promise<void> {
    for (const instance of this.listPluginInstances()) {
      if (instance.pluginId === pluginId) await this.deletePluginInstance(instance.id);
    }

    this.doc.getMap("plugins").delete(pluginId);
    this.doc.commit();
  }

  listPluginInstances(): PluginInstance[] {
    const instances = this.doc.getMap("instances");
    const list: PluginInstance[] = [];

    for (const id of instances.keys() as string[]) {
      const map = instances.get(id) as LoroMap | undefined;
      if (!map || map.isDeleted()) continue;
      list.push(map.toJSON() as PluginInstance);
    }

    return list.sort((a, b) => a.createdAt - b.createdAt);
  }

  getPluginInstance(id: string): PluginInstance | undefined {
    const map = this.doc.getMap("instances").get(id) as LoroMap | undefined;
    if (!map || map.isDeleted()) return undefined;

    return map.toJSON() as PluginInstance;
  }

  async createPluginInstance(input: {
    pluginId: string;
    surface: PluginSurfaceKind;
    title: string;
    icon?: string;
    config?: Record<string, unknown>;
  }): Promise<PluginInstance> {
    const instance: PluginInstance = {
      id: createId(),
      pluginId: input.pluginId,
      surface: input.surface,
      title: input.title,
      icon: input.icon ?? "",
      config: JSON.stringify(input.config ?? {}),
      createdAt: Date.now(),
    };

    this.writePluginInstance(instance);
    await this.openPluginDoc(instance.id);

    return instance;
  }

  async updatePluginInstance(
    id: string,
    patch: Partial<Pick<PluginInstance, "title" | "icon" | "config">>,
  ): Promise<void> {
    const instance = this.getPluginInstance(id);
    if (!instance) return;

    this.writePluginInstance({ ...instance, ...patch });
  }

  async deletePluginInstance(id: string): Promise<void> {
    this.doc.getMap("instances").delete(id);
    this.doc.commit();

    const doc = this.pluginDocs.get(id);
    if (doc) this.dirtyDocs.delete(doc);
    this.pluginDocs.delete(id);
    await this.backend.delete(pluginPath(this.workspaceId, id));
  }

  private readPluginInstall(id: string): PluginInstall | undefined {
    const map = this.doc.getMap("plugins").get(id) as LoroMap | undefined;
    if (!map || map.isDeleted()) return undefined;

    return map.toJSON() as PluginInstall;
  }

  private writePluginInstance(instance: PluginInstance): void {
    const instances = this.doc.getMap("instances");
    const map = instances.ensureMergeableMap(instance.id);
    map.set("id", instance.id);
    map.set("pluginId", instance.pluginId);
    map.set("surface", instance.surface);
    map.set("title", instance.title);
    map.set("icon", instance.icon);
    map.set("config", instance.config);
    map.set("createdAt", instance.createdAt);
    this.doc.commit();
  }

  /** Materializes every collection as arrays of plain records for the plugin. */
  async readPluginState(instanceId: string): Promise<PluginState> {
    if (!this.getPluginInstance(instanceId)) return {};

    const doc = await this.openPluginDoc(instanceId);
    const collections = doc.getMap("collections");
    const state: PluginState = {};

    for (const name of collections.keys() as string[]) {
      const collection = collections.get(name) as LoroMap | undefined;
      if (!collection) continue;

      const records: PluginRecord[] = [];
      for (const id of collection.keys() as string[]) {
        const record = collection.get(id) as LoroMap | undefined;
        if (!record || record.isDeleted()) continue;
        records.push({ id, ...(record.toJSON() as Record<string, unknown>) });
      }
      state[name] = records;
    }

    return state;
  }

  /**
   * Applies one render's patch ops. Fields are validated by the caller: this
   * layer only knows collections, record ids, and scalar values.
   */
  async applyPluginPatch(instanceId: string, ops: PluginPatchOp[]): Promise<void> {
    if (ops.length === 0) return;

    const doc = await this.openPluginDoc(instanceId);
    const collections = doc.getMap("collections");

    for (const op of ops) {
      const collection = collections.ensureMergeableMap(op.collection);

      if (op.op === "append") {
        const map = collection.ensureMergeableMap(op.record.id);
        for (const [key, value] of Object.entries(op.record)) {
          if (key === "id" || value === undefined) continue;
          map.set(key, value);
        }
        continue;
      }

      if (op.op === "remove") {
        collection.delete(op.id);
        continue;
      }

      const map = collection.ensureMergeableMap(op.id);

      if (op.op === "set") {
        map.set(op.key, op.value);
      } else if (op.op === "merge") {
        for (const [key, value] of Object.entries(op.record)) {
          if (value === undefined) continue;
          map.set(key, value);
        }
      } else if (op.op === "inc") {
        const current = map.get(op.key);
        map.set(op.key, (typeof current === "number" ? current : 0) + op.value);
      }
    }

    doc.commit();
  }

  async onPluginDocChange(instanceId: string, listener: () => void): Promise<() => void> {
    await this.openPluginDoc(instanceId);
    let listeners = this.pluginListeners.get(instanceId);
    if (!listeners) {
      listeners = new Set();
      this.pluginListeners.set(instanceId, listeners);
    }
    listeners.add(listener);

    return () => listeners.delete(listener);
  }

  // ---- Chats -------------------------------------------------------------
  //
  // Thread metadata is a record in the workspace doc's `chats` map; messages
  // live in the thread's own doc (`chat:<threadId>`). The sync engine already
  // walks listDocIds/getDocById, so threads sync like page and plugin docs.

  listChats(): ChatThread[] {
    const chats = this.doc.getMap("chats");
    const list: ChatThread[] = [];

    for (const id of chats.keys() as string[]) {
      const chat = this.readChat(id);
      if (chat) list.push(chat);
    }

    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getChat(id: string): ChatThread | undefined {
    return this.readChat(id);
  }

  private readChat(id: string): ChatThread | undefined {
    const map = this.doc.getMap("chats").get(id) as LoroMap | undefined;
    if (!map || map.isDeleted()) return undefined;

    return map.toJSON() as ChatThread;
  }

  private writeChat(thread: ChatThread): void {
    const chats = this.doc.getMap("chats");
    const map = chats.ensureMergeableMap(thread.id);
    map.set("id", thread.id);
    map.set("title", thread.title);
    map.set("providerId", thread.providerId);
    map.set("model", thread.model);
    map.set("pageId", thread.pageId);
    map.set("createdAt", thread.createdAt);
    map.set("updatedAt", thread.updatedAt);
    this.doc.commit();
  }

  async createChat(input: {
    title?: string;
    providerId?: string | null;
    model?: string | null;
    pageId?: string | null;
  }): Promise<ChatThread> {
    const now = Date.now();
    const thread: ChatThread = {
      id: createId(),
      title: input.title?.trim() || "New chat",
      providerId: input.providerId ?? null,
      model: input.model ?? null,
      pageId: input.pageId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.writeChat(thread);
    await this.openChatDoc(thread.id);

    return thread;
  }

  updateChat(
    id: string,
    patch: Partial<Pick<ChatThread, "title" | "providerId" | "model" | "pageId">>,
  ): void {
    const thread = this.getChat(id);
    if (!thread) return;

    this.writeChat({ ...thread, ...patch, updatedAt: Date.now() });
  }

  async deleteChat(id: string): Promise<void> {
    this.doc.getMap("chats").delete(id);
    this.doc.commit();

    const doc = this.chatDocs.get(id);
    if (doc) this.dirtyDocs.delete(doc);
    this.chatDocs.delete(id);
    await this.backend.delete(chatPath(this.workspaceId, id));
  }

  private readChatMessage(id: string, map: LoroMap): ChatMessage {
    const plain = map.toJSON() as Record<string, unknown>;

    return {
      id,
      role: plain.role === "user" ? "user" : "assistant",
      seq: typeof plain.seq === "number" ? plain.seq : 0,
      source: typeof plain.source === "string" ? plain.source : "",
      status:
        typeof plain.status === "string" ? (plain.status as ChatMessage["status"]) : "streaming",
      providerId: typeof plain.providerId === "string" ? plain.providerId : null,
      model: typeof plain.model === "string" ? plain.model : null,
      createdAt: typeof plain.createdAt === "number" ? plain.createdAt : 0,
      updatedAt: typeof plain.updatedAt === "number" ? plain.updatedAt : 0,
      repairOf: typeof plain.repairOf === "string" ? plain.repairOf : null,
      diagnostics: decodeJson<ChatMessage["diagnostics"]>(plain.diagnostics, []),
      tools: decodeJson<ChatMessage["tools"]>(plain.tools, []),
      error: typeof plain.error === "string" ? plain.error : null,
    };
  }

  private writeChatMessage(threadId: string, message: ChatMessage): void {
    const messages = this.getChatDocMessages(threadId);
    const map = messages.ensureMergeableMap(message.id);
    map.set("id", message.id);
    map.set("role", message.role);
    map.set("seq", message.seq);
    map.set("source", message.source);
    map.set("status", message.status);
    map.set("providerId", message.providerId);
    map.set("model", message.model);
    map.set("createdAt", message.createdAt);
    map.set("updatedAt", message.updatedAt);
    map.set("repairOf", message.repairOf);
    map.set("diagnostics", encodeSetting(message.diagnostics));
    map.set("tools", encodeSetting(message.tools));
    map.set("error", message.error);
  }

  private getChatDocMessages(threadId: string): LoroMap {
    const doc = this.chatDocs.get(threadId);
    if (!doc) throw new Error(`Chat doc ${threadId} is not open`);

    return doc.getMap("messages");
  }

  async readChatMessages(threadId: string): Promise<ChatMessage[]> {
    const doc = await this.openChatDoc(threadId);
    const messages = doc.getMap("messages");
    const list: ChatMessage[] = [];

    for (const id of messages.keys() as string[]) {
      const map = messages.get(id) as LoroMap | undefined;
      if (!map || map.isDeleted()) continue;
      list.push(this.readChatMessage(id, map));
    }

    return list.sort((a, b) => a.seq - b.seq);
  }

  async appendChatMessage(threadId: string, message: ChatMessage): Promise<void> {
    const doc = await this.openChatDoc(threadId);
    this.writeChatMessage(threadId, message);
    doc.commit();

    const thread = this.getChat(threadId);
    if (thread) {
      this.writeChat({
        ...thread,
        updatedAt: Date.now(),
        // The first user turn names the thread after its first line.
        title:
          thread.title === "New chat" && message.role === "user" && message.source.trim()
            ? message.source.trim().split("\n")[0]!.slice(0, 80)
            : thread.title,
      });
    }
  }

  async updateChatMessage(
    threadId: string,
    messageId: string,
    patch: Partial<
      Pick<
        ChatMessage,
        | "source"
        | "status"
        | "providerId"
        | "model"
        | "diagnostics"
        | "tools"
        | "error"
        | "repairOf"
      >
    >,
  ): Promise<void> {
    const doc = await this.openChatDoc(threadId);
    const messages = doc.getMap("messages");
    const map = messages.get(messageId) as LoroMap | undefined;
    if (!map || map.isDeleted()) return;

    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (key === "diagnostics" || key === "tools") map.set(key, encodeSetting(value));
      else map.set(key, value);
    }
    map.set("updatedAt", Date.now());
    doc.commit();
  }

  async onChatDocChange(threadId: string, listener: () => void): Promise<() => void> {
    await this.openChatDoc(threadId);
    let listeners = this.chatListeners.get(threadId);
    if (!listeners) {
      listeners = new Set();
      this.chatListeners.set(threadId, listeners);
    }
    listeners.add(listener);

    return () => listeners.delete(listener);
  }

  // ---- Blobs -------------------------------------------------------------

  /**
   * Stores bytes under their content hash. Writing the same bytes twice is a
   * no-op, so callers can upload freely.
   */
  async putBlob(bytes: Uint8Array): Promise<BlobEntry> {
    const hash = await hashBytes(bytes);
    const path = blobPath(this.workspaceId, hash);
    const existing = await this.backend.stat(path).catch(() => null);
    if (!existing) await this.backend.write(path, bytes);

    return { hash, size: bytes.byteLength, modifiedAt: existing?.modifiedAt ?? Date.now() };
  }

  async getBlob(hash: string): Promise<Uint8Array | null> {
    if (!isBlobHash(hash)) return null;

    return this.backend.read(blobPath(this.workspaceId, hash));
  }

  async listBlobs(): Promise<BlobEntry[]> {
    const dir = `${this.root}/blobs`;
    let names: string[] = [];
    try {
      names = await this.backend.list(dir);
    } catch {
      return [];
    }

    const entries: BlobEntry[] = [];
    for (const name of names) {
      if (!isBlobHash(name)) continue;
      const stat = await this.backend.stat(`${dir}/${name}`).catch(() => null);
      if (!stat || stat.kind !== "file") continue;
      entries.push({ hash: name, size: stat.size, modifiedAt: stat.modifiedAt });
    }

    return entries.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
  }

  async deleteBlob(hash: string): Promise<void> {
    if (!isBlobHash(hash)) return;

    await this.backend.delete(blobPath(this.workspaceId, hash));
  }

  /** Blob hash -> page ids that mention it in source or asset records. */
  async findBlobReferences(): Promise<Map<string, string[]>> {
    const references = new Map<string, string[]>();
    const add = (hash: string, pageId: string) => {
      if (!isBlobHash(hash)) return;
      const list = references.get(hash) ?? [];
      if (!list.includes(pageId)) list.push(pageId);
      references.set(hash, list);
    };

    for (const page of this.listPages()) {
      const text = await this.loadPageText(page.id);
      for (const match of text.matchAll(/typbase\/blob\/([0-9a-f]{64})/g)) add(match[1]!, page.id);

      for (const asset of Object.values(this.getAssets(page.id))) {
        if (asset.hash) add(asset.hash, page.id);
      }
    }

    return references;
  }

  private async seed(name = "My workspace"): Promise<void> {
    const welcome = [
      "= Welcome to Typbase",
      "",
      "Every page here is a Typst document, and the app reads them as data.",
      "The list below is live: this page asked the workspace for its pages.",
      "",
      '#let pages = typbase.query("pages")',
      "",
      "#for page in pages [",
      "  - #page.title (#typbase.page-link(page.id, body: page.path))",
      "]",
      "",
      "== Try this",
      "",
      "- Create a page with *+* next to Pages.",
      "- Open today's daily note from the sidebar.",
      '- Pull app data into a document: `#typbase.query("pages")` returns JSON.',
      '- Interactive link to another page: `#typbase.page-link("<id>")`',
      // '- Inline another page: `#typbase.embed("<id>")`.',
      "",
      // "== Around the app",
      // "",
      // "- *Sidebar*: daily notes, pages, plugins.",
      // "- *Toolbar*: view modes, formatting, export; Ctrl/Cmd+K searches.",
      // "- *Settings*: appearance, content, storage.",
      // "",
    ].join("\n");

    const home = await this.createPage({
      title: "Welcome",
      content: welcome,
    });

    this.updateSettings({
      name,
      homePageId: home.id,
      dailyNoteTemplate: DEFAULT_SETTINGS.dailyNoteTemplate,
      font: DEFAULT_SETTINGS.font,
      mathFont: DEFAULT_SETTINGS.mathFont,
      codeFont: null,
    });
  }

  private emitStructure(): void {
    for (const listener of this.structureListeners) listener();
  }

  private emitPage(pageId: string): void {
    for (const listener of this.pageListeners.get(pageId) ?? []) listener();
  }

  private emitPlugin(instanceId: string): void {
    for (const listener of this.pluginListeners.get(instanceId) ?? []) listener();
  }

  private emitChat(threadId: string): void {
    for (const listener of this.chatListeners.get(threadId) ?? []) listener();
  }

  /** Called on any workspace-level change (pages, categories, settings). */
  onStructureChange(listener: () => void): () => void {
    this.structureListeners.add(listener);

    return () => this.structureListeners.delete(listener);
  }

  private scheduleSave(doc: LoroDoc): void {
    this.dirtyDocs.add(doc);

    // A max-wait window, not a resettable debounce: further changes while a
    // flush is pending do not push the deadline out, so continuous typing
    // still snapshots once per window instead of never.
    if (this.snapshotTimer) return;

    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      void this.flush();
    }, this.snapshotDebounceMs);
  }

  /** Debounced commit batch: one event per word of typing, exported by sync. */
  private scheduleCommit(docId: string): void {
    this.pendingCommits.add(docId);
    if (this.commitTimer) return;

    this.commitTimer = setTimeout(() => {
      this.commitTimer = undefined;
      const batch = [...this.pendingCommits];
      this.pendingCommits.clear();
      for (const listener of this.commitListeners) {
        for (const id of batch) listener(id);
      }
    }, this.snapshotDebounceMs);
  }
}
