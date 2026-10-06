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
  Section,
  WorkspaceSettings,
} from "@typbase/typing";
import type { LoroDoc, LoroMap, VersionVector } from "loro-crdt";

import { DEFAULT_SETTINGS } from "@typbase/typing";

import type { StorageBackend, StorageEntryStat } from "./backend";

import { pathSegments } from "./backend";
import { blobId, blobPath, hashBytes, isBlobHash, type BlobEntry } from "./blobs";
import { createId } from "./ids";
import { type LoroModule, loadLoro } from "./loro";

const SNAPSHOT_DEBOUNCE_MS = 500;

/**
 * A container path inside a Loro doc, root first. Top-level containers are one
 * segment (`["categories"]`). Nested containers add the key or index
 * (`["categories", 0]`, `["pages", "<id>"]`).
 */
export type LoroPath = readonly (string | number)[];

/**
 * True when one path is a prefix of the other. A change to a nested container
 * matches a listener on its ancestor, and a change that replaces an ancestor
 * (a page deleted from the `pages` map) matches a listener on the nested path.
 */
export function pathsOverlap(left: LoroPath, right: LoroPath): boolean {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) return false;
  }

  return true;
}

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

/**
 * `"hello world" -> "hello-world"`, lowercase, safe for virtual paths.
 *
 * Unicode letters and marks survive, so a page in a non-English workspace gets
 * a file named after its title instead of an ASCII approximation of it.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

/** The path a page gets by default: the file name follows the title. */
export function derivedPagePath(title: string): string {
  return `pages/${slugify(title)}.typ`;
}

/**
 * Where renaming this page's title would put its file, or null when the file
 * keeps the name it has.
 *
 * Only a path that is still the old title's default follows the title. Once the
 * file has been renamed by hand, or imported from the workspace tree, the name
 * belongs to whoever set it, and a daily note's date is not a title at all.
 */
export function renamePagePathFor(page: PageMeta, title: string): string | null {
  if (page.path !== derivedPagePath(page.title)) return null;

  const next = derivedPagePath(title);

  return next === page.path ? null : next;
}

/**
 * Default source for a new notebook.
 */
export function notebookTemplate(title: string): string {
  return `//% kind=hidden\n#set document(title: "${title}")\n\n= ${title}\n\n//% kind=code\n`;
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
  /** Files that changed while the page also changed. The doc won. */
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

/** FNV-1a, hex. Change detection only, not security relevant. */
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
export const RESERVED_ROOTS = ["state", "typbase", "blobs", "artifacts", "plugins"] as const;

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

/**
 * True when a path under `plugins/` is an authoring file the studio watches.
 * `plugins/` is a reserved root, so these never reach the page sync.
 */
export function isPluginChange(relativePath: string): boolean {
  const parts = pathSegments(relativePath);
  if (!parts.length || parts[0] !== "plugins") return false;
  if (parts.some((part) => part.startsWith("."))) return false;

  const name = parts.at(-1)!;

  return name.endsWith(".typ") || name.endsWith(".css") || name.endsWith(".json");
}

/** Doc id space for plugin instance docs. Sync treats them like page docs. */
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

/** Doc id space for chat threads. Sync treats them like page docs. */
export function chatDocId(threadId: string): string {
  return `chat:${threadId}`;
}

/** Thread id behind a `chat:<id>` doc id, or null for other docs. */
export function chatIdOf(docId: string): string | null {
  return docId.startsWith("chat:") ? docId.slice("chat:".length) : null;
}

export interface WorkspaceStoreOptions {
  /** Snapshot writes are debounced by this much. A crash loses at most this window. */
  snapshotDebounceMs?: number;
  /** Settings name for a workspace doc created from scratch. Ignored otherwise. */
  name?: string;
}

export interface CreatePageInput {
  title: string;
  /** Virtual Typst path. Defaults to `pages/<slug>.typ`. */
  path?: string;
  categoryId?: string | null;
  /** "notebook" writes the cell template as the default content. */
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
  private workspaceChangeListeners = new Set<{
    paths: readonly LoroPath[];
    listener: () => void;
  }>();
  private pageListeners = new Map<string, Set<(paths: LoroPath[]) => void>>();
  private pluginListeners = new Map<string, Set<(paths: LoroPath[]) => void>>();
  private chatListeners = new Map<string, Set<(paths: LoroPath[]) => void>>();
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

    doc.subscribe((batch) => {
      store.scheduleSave(doc);
      store.scheduleCommit(workspaceId);
      store.emitStructure(batch.events.map((event) => event.path));
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

  /** Enables the source mirror. Call once the device state exists. */
  attachSourceSync(sync: SourceSyncStore): void {
    this.sourceSync = sync;
  }

  /** Disk path of a page's mirrored source. */
  sourcePath(page: PageMeta): string {
    return this.sourcePathFor(page.path);
  }

  /** Disk path of a page source at a given path, current or not. */
  private sourcePathFor(path: string): string {
    return `${this.root}/${path}`;
  }

  /**
   * Watches the page tree for external edits and calls `onChanged` for every
   * change that looks like a source edit. Plugin authoring files under
   * `plugins/` call `onPluginChange` instead. Backends without change
   * notifications (OPFS, memory) return a no-op disposer. Calling this again
   * replaces the previous watcher.
   */
  watchSources(onChanged: () => void, onPluginChange?: () => void): () => void {
    this.unwatchSources?.();

    const watch = this.backend.watch?.bind(this.backend);
    if (!watch) return () => {};

    let dispose: (() => void) | undefined;
    let closed = false;

    void watch(this.root, (relative) => {
      if (isSourceChange(relative)) onChanged();
      else if (onPluginChange && isPluginChange(relative)) onPluginChange();
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
   * root-absolute (`/typbase/...`). Anything outside `typbase/` is rejected so
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
        files.set(virtual, {
          path,
          size: stat.size,
          modifiedAt: stat.modifiedAt,
        });
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
   * Deleting a file never deletes a page. Remove those in the app.
   */
  syncSources(): Promise<SourceSyncResult> {
    this.sourceSyncPromise ??= this.doSyncSources().finally(() => {
      this.sourceSyncPromise = undefined;
    });

    return this.sourceSyncPromise;
  }

  private async doSyncSources(): Promise<SourceSyncResult> {
    const result: SourceSyncResult = {
      imported: [],
      created: [],
      conflicts: [],
      exported: 0,
    };
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

    // Export any dirty docs last. This re-records their hashes too.
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

    // Templates from before the context binding are broken: the app no longer
    // substitutes `{title}` and friends. Swap the old shape for the current
    // default. A template without placeholders is left alone.
    if (settings.dailyNoteTemplate.includes("{title}")) {
      settings.dailyNoteTemplate = DEFAULT_SETTINGS.dailyNoteTemplate;
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
    settings.editor = {
      ...DEFAULT_SETTINGS.editor,
      ...decodeSetting<Partial<WorkspaceSettings["editor"]>>(map.get("editor")),
    };
    settings.graph = {
      ...DEFAULT_SETTINGS.graph,
      ...decodeSetting<Partial<WorkspaceSettings["graph"]>>(map.get("graph")),
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

    // Array fields ride the same JSON-string path. Bad entries from another
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
      else if (key === "editor") map.set("editor", encodeSetting(value));
      else if (key === "graph") map.set("graph", encodeSetting(value));
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

    // Manual order first, then the legacy `updatedAt` order for pages that
    // never got one (older docs, freshly imported sources).
    return list.sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.updatedAt - b.updatedAt,
    );
  }

  /**
   * Writes a manual order. Callers pass every page id in its new order, so a
   * reorder inside one sidebar group stays consistent with the global order.
   */
  reorderPages(ids: readonly string[]): void {
    const pages = this.doc.getMap("pages");

    ids.forEach((id, index) => {
      const map = pages.get(id) as LoroMap | undefined;
      if (map && !map.isDeleted()) map.set("order", index);
    });

    this.doc.commit();
  }

  getPage(id: string): PageMeta | undefined {
    return this.readPageMeta(id);
  }

  private readPageMeta(id: string): PageMeta | undefined {
    const map = this.doc.getMap("pages").get(id) as LoroMap | undefined;
    if (!map || map.isDeleted()) return undefined;

    const meta = map.toJSON() as PageMeta;

    return {
      ...meta,
      kind: meta.kind === "notebook" ? "notebook" : "document",
    };
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
    if (meta.order === undefined) map.delete("order");
    else map.set("order", meta.order);
    map.set("pinned", meta.pinned);
    map.set("publishedAt", meta.publishedAt);
    map.set("publishUri", meta.publishUri);

    this.doc.commit();
  }

  async createPage(input: CreatePageInput): Promise<PageMeta> {
    const now = Date.now();
    const kind = input.kind ?? "document";
    // New pages land at the end of the manual order. A workspace that has
    // never been reordered keeps the legacy `updatedAt` order instead, so the
    // first reorder is what normalizes every page.
    const orders = this.listPages()
      .map((page) => page.order)
      .filter((order): order is number => order !== undefined);
    const meta: PageMeta = {
      id: createId((id) => id === this.workspaceId || this.getPage(id) !== undefined),
      path: this.uniquePath(input.path ?? derivedPagePath(input.title)),
      title: input.title.trim() || "Untitled",
      kind,
      categoryId: input.categoryId ?? null,
      tags: [],
      createdAt: now,
      updatedAt: now,
      order: orders.length ? Math.max(...orders) + 1 : undefined,
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
    // written. A reload then finds the page doc missing and renders it blank.
    pageDoc.commit();

    return meta;
  }

  /**
   * Renames a page. Its file follows the title while the path is still the one
   * that title derived (see `renamePagePathFor`), unless the caller opts out.
   *
   * The old file goes first: `syncSources` creates a page for a file that has
   * none, so leaving it behind would duplicate the note. A crash in between
   * heals on the next sync, which exports any page whose path has no file.
   */
  async updatePageTitle(
    id: string,
    title: string,
    options: { renameFile?: boolean } = {},
  ): Promise<void> {
    const meta = this.getPage(id);
    if (!meta) return;

    const desired = options.renameFile === false ? null : renamePagePathFor(meta, title);
    const previousPath = meta.path;
    // `renamePagePathFor` already ruled out "same name", so a clash here is
    // another page's file.
    const nextPath = desired ? this.uniquePath(desired) : null;
    const moves = nextPath !== null && nextPath !== previousPath;

    if (moves) {
      await this.backend.delete(this.sourcePathFor(previousPath)).catch(() => {
        // A missing mirror is fine. The page is what matters.
      });
    }

    meta.title = title;
    meta.updatedAt = Date.now();
    if (nextPath) meta.path = nextPath;
    this.writePageMeta(meta);

    if (!moves) return;

    if (this.sourceHashes) delete this.sourceHashes[previousPath];
    // Writes the new file from the page's text and records its hash.
    await this.exportPageSource(id);
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

  /** Moves a page into a category, or out of one when `categoryId` is null. */
  async updatePageCategory(id: string, categoryId: string | null): Promise<void> {
    const meta = this.getPage(id);
    if (!meta) return;

    // A stale id would hide the page from both the category groups and the
    // uncategorized list, so anything unknown reads as "no category".
    const known =
      categoryId !== null && this.listCategories().some((category) => category.id === categoryId);
    const next = known ? categoryId : null;
    if (meta.categoryId === next) return;

    meta.categoryId = next;
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

    // The home page id outlives its page otherwise, and the shell would open a
    // page that is gone.
    if (this.getSettings().homePageId === id) {
      this.updateSettings({ homePageId: null });
    }

    const pageDoc = this.pageDocs.get(id);
    if (pageDoc) {
      this.dirtyDocs.delete(pageDoc);
      this.pageIdForDoc.delete(pageDoc);
    }
    this.pageDocs.delete(id);
    await this.backend.delete(pagePath(this.workspaceId, id));

    if (meta) {
      await this.backend.delete(this.sourcePathFor(meta.path)).catch(() => {
        // A missing mirror is fine. The page is what matters.
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
    // Manual order first; categories without one keep their list position.
    return (this.doc.getList("categories").toJSON() as Category[])
      .map((category, index) => ({ category, index }))
      .sort((a, b) => (a.category.order ?? a.index) - (b.category.order ?? b.index))
      .map((entry) => entry.category);
  }

  /** Writes a manual order. Callers pass every category id in its new order. */
  reorderCategories(ids: readonly string[]): void {
    const list = this.doc.getList("categories");
    const positions = new Map<string, number>();
    (list.toJSON() as Category[]).forEach((category, index) => positions.set(category.id, index));

    ids.forEach((id, order) => {
      const index = positions.get(id);
      if (index === undefined) return;
      const map = list.get(index) as LoroMap | undefined;
      map?.set("order", order);
    });

    this.doc.commit();
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

    // The template is plain Typst: its title and neighbor links come from the
    // prelude's `note` at compile time, so a note created before
    // its next day still links to it once that day exists.
    return this.createPage({
      title: this.formatDate(date),
      path,
      content: this.getSettings().dailyNoteTemplate,
    });
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

    doc.subscribe((batch) => {
      this.scheduleSave(doc);
      this.emitPage(
        pageId,
        batch.events.map((event) => event.path),
      );
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

    doc.subscribe((batch) => {
      this.scheduleSave(doc);
      this.emitPlugin(
        instanceId,
        batch.events.map((event) => event.path),
      );
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

    doc.subscribe((batch) => {
      this.scheduleSave(doc);
      this.emitChat(
        threadId,
        batch.events.map((event) => event.path),
      );
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

  /** Subscribe to a page doc's changes (content or meta). The listener gets
   *  the container paths that changed, for filtering. */
  async onPageDocChange(
    pageId: string,
    listener: (paths: LoroPath[]) => void,
  ): Promise<() => void> {
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
   * sync engine exports an update per batch from here. A crash between
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
      // The wasm binding requires the argument (even for "none"). Undefined
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

      // Mergeable children read back as LoroMap. Plain values are already data.
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
    title: string;
    icon?: string;
    config?: Record<string, unknown>;
  }): Promise<PluginInstance> {
    const instance: PluginInstance = {
      id: createId((id) => this.getPluginInstance(id) !== undefined),
      pluginId: input.pluginId,
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

  async onPluginDocChange(
    instanceId: string,
    listener: (paths: LoroPath[]) => void,
  ): Promise<() => void> {
    await this.openPluginDoc(instanceId);
    let listeners = this.pluginListeners.get(instanceId);
    if (!listeners) {
      listeners = new Set();
      this.pluginListeners.set(instanceId, listeners);
    }
    listeners.add(listener);

    return () => listeners.delete(listener);
  }

  //
  // Thread metadata is a record in the workspace doc's `chats` map. Messages
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
      id: createId((id) => this.getChat(id) !== undefined),
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

  async onChatDocChange(
    threadId: string,
    listener: (paths: LoroPath[]) => void,
  ): Promise<() => void> {
    await this.openChatDoc(threadId);
    let listeners = this.chatListeners.get(threadId);
    if (!listeners) {
      listeners = new Set();
      this.chatListeners.set(threadId, listeners);
    }
    listeners.add(listener);

    return () => listeners.delete(listener);
  }

  /**
   * Stores bytes under a truncated content address. Writing the same bytes
   * twice is a no-op. The first 16 hex chars of the SHA-256 give 64 bits of
   * address. If two different files ever land on the same address, the second
   * is stored under the full digest instead of aliasing the first.
   */
  async putBlob(bytes: Uint8Array): Promise<BlobEntry> {
    const full = await hashBytes(bytes);
    const id = blobId(full);
    const path = blobPath(this.workspaceId, id);
    const existing = await this.backend.stat(path).catch(() => null);

    if (existing) {
      const same = existing.size === bytes.byteLength && (await this.blobBytesMatch(path, bytes));
      if (same) {
        return { hash: id, size: bytes.byteLength, modifiedAt: existing.modifiedAt };
      }

      // A birthday hit: keep the two files apart under the full digest.
      const fullPath = blobPath(this.workspaceId, full);
      const fullExisting = await this.backend.stat(fullPath).catch(() => null);
      if (!fullExisting) await this.backend.write(fullPath, bytes);

      return {
        hash: full,
        size: bytes.byteLength,
        modifiedAt: fullExisting?.modifiedAt ?? Date.now(),
      };
    }

    await this.backend.write(path, bytes);

    return { hash: id, size: bytes.byteLength, modifiedAt: Date.now() };
  }

  /** Byte comparison for an existing blob. The caller compares sizes first. */
  private async blobBytesMatch(path: string, bytes: Uint8Array): Promise<boolean> {
    const stored = await this.backend.read(path);
    if (!stored || stored.byteLength !== bytes.byteLength) return false;

    for (let index = 0; index < bytes.length; index += 1) {
      if (stored[index] !== bytes[index]) return false;
    }

    return true;
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
      entries.push({
        hash: name,
        size: stat.size,
        modifiedAt: stat.modifiedAt,
      });
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
      for (const match of text.matchAll(/typbase\/blob\/([0-9a-f]{16,64})/g))
        add(match[1]!, page.id);

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

  private emitStructure(paths: LoroPath[]): void {
    for (const listener of this.structureListeners) listener();

    for (const entry of this.workspaceChangeListeners) {
      if (
        paths.some((changed) => entry.paths.some((declared) => pathsOverlap(declared, changed)))
      ) {
        entry.listener();
      }
    }
  }

  private emitPage(pageId: string, paths: LoroPath[]): void {
    for (const listener of this.pageListeners.get(pageId) ?? []) listener(paths);
  }

  private emitPlugin(instanceId: string, paths: LoroPath[]): void {
    for (const listener of this.pluginListeners.get(instanceId) ?? []) listener(paths);
  }

  private emitChat(threadId: string, paths: LoroPath[]): void {
    for (const listener of this.chatListeners.get(threadId) ?? []) listener(paths);
  }

  /** Called on any workspace-level change (pages, categories, settings). */
  onStructureChange(listener: () => void): () => void {
    this.structureListeners.add(listener);

    return () => this.structureListeners.delete(listener);
  }

  /**
   * Called only when a container at or below one of `paths` changes in the
   * workspace doc. Empty paths mean any change. Use it instead of
   * `onStructureChange` when the listener reads a known part of the doc, so a
   * category rename does not invalidate a page list.
   */
  onWorkspaceChange(paths: readonly LoroPath[], listener: () => void): () => void {
    const entry = { paths, listener };
    this.workspaceChangeListeners.add(entry);

    return () => this.workspaceChangeListeners.delete(entry);
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
