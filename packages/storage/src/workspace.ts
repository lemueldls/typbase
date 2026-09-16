import type {
  AssetMeta,
  Category,
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
import type { LoroDoc, LoroList, LoroMap, VersionVector } from "loro-crdt";

import { createId } from "@paralleldrive/cuid2";
import { DEFAULT_SETTINGS } from "@typbase/typing";

import type { StorageBackend } from "./backend";

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

export function workspacePath(workspaceId: string): string {
  return `workspaces/${workspaceId}/workspace.loro`;
}

export function pagePath(workspaceId: string, pageId: string): string {
  return `workspaces/${workspaceId}/pages/${pageId}.loro`;
}

export function pluginPath(workspaceId: string, instanceId: string): string {
  return `workspaces/${workspaceId}/plugins/${instanceId}.loro`;
}

/** Doc id space for plugin instance docs; sync treats them like page docs. */
export function pluginDocId(instanceId: string): string {
  return `plugin:${instanceId}`;
}

/** Instance id behind a `plugin:<id>` doc id, or null for other docs. */
export function pluginInstanceOf(docId: string): string | null {
  return docId.startsWith("plugin:") ? docId.slice("plugin:".length) : null;
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
  /** Typst source. Defaults to a `= Title` heading. */
  content?: string;
}

/**
 * The local-first core: one workspace Loro doc plus one doc per page,
 * snapshotted to the storage backend on a debounce.
 */
export class WorkspaceStore {
  private pageDocs = new Map<string, LoroDoc>();
  private pluginDocs = new Map<string, LoroDoc>();
  private readonly pathForDoc = new Map<LoroDoc, string>();
  private readonly pageIdForDoc = new Map<LoroDoc, string>();
  private dirtyDocs = new Set<LoroDoc>();
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private structureListeners = new Set<() => void>();
  private pageListeners = new Map<string, Set<() => void>>();
  private pluginListeners = new Map<string, Set<() => void>>();
  private commitListeners = new Set<(docId: string) => void>();
  private commitTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingCommits = new Set<string>();
  private loro!: LoroModule;
  private sourceSync?: SourceSyncStore;
  private sourceHashes: Record<string, { pageId: string; hash: string }> | undefined;
  private sourceSyncPromise: Promise<SourceSyncResult> | undefined;

  private constructor(
    private readonly backend: StorageBackend,
    readonly workspaceId: string,
    private readonly doc: LoroDoc,
    private readonly snapshotDebounceMs = SNAPSHOT_DEBOUNCE_MS,
  ) {}

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
   * Writes pending snapshots and mirrors page sources to `sources/<path>`.
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

  /** Enables the `sources/<path>` mirror; call once the device state exists. */
  attachSourceSync(sync: SourceSyncStore): void {
    this.sourceSync = sync;
  }

  /** Current disk path for a page's mirrored source. */
  sourcePath(page: PageMeta): string {
    return `workspaces/${this.workspaceId}/sources/${page.path}`;
  }

  private async loadSourceHashes(): Promise<Record<string, { pageId: string; hash: string }>> {
    this.sourceHashes ??=
      (await this.sourceSync?.get<Record<string, { pageId: string; hash: string }>>(
        SOURCE_HASHES_KEY,
      )) ?? {};

    return this.sourceHashes;
  }

  private async saveSourceHashes(): Promise<void> {
    if (!this.sourceSync || !this.sourceHashes) return;

    await this.sourceSync.set(SOURCE_HASHES_KEY, this.sourceHashes);
  }

  private async writeSourceFile(page: PageMeta, text: string): Promise<void> {
    await this.backend.write(this.sourcePath(page), new TextEncoder().encode(text));
  }

  private async exportPageSource(pageId: string): Promise<void> {
    const page = this.getPage(pageId);
    if (!page) return;

    const text = await this.loadPageText(pageId);
    await this.writeSourceFile(page, text);

    const hashes = await this.loadSourceHashes();
    hashes[page.path] = { pageId, hash: hashText(text) };
    await this.saveSourceHashes();
  }

  /** Reads `sources/**.typ` recursively as `virtual path -> text`. */
  private async listSourceFiles(relative = ""): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const dir = `workspaces/${this.workspaceId}/sources${relative ? `/${relative}` : ""}`;
    let entries: string[] = [];
    try {
      entries = await this.backend.list(dir);
    } catch {
      return files;
    }

    for (const name of entries) {
      const path = `${dir}/${name}`;
      const stat = await this.backend.stat(path).catch(() => null);
      if (!stat) continue;
      const virtual = relative ? `${relative}/${name}` : name;

      if (stat.kind === "directory") {
        for (const [key, value] of await this.listSourceFiles(virtual)) files.set(key, value);
      } else if (name.endsWith(".typ")) {
        const bytes = await this.backend.read(path);
        if (bytes) files.set(virtual, new TextDecoder().decode(bytes));
      }
    }

    return files;
  }

  /**
   * Mirrors `sources/` and the page docs:
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

    for (const [virtualPath, text] of files) {
      const fileHash = hashText(text);
      const page = pagesByPath.get(virtualPath);
      const recorded = hashes[virtualPath];

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
        hashes[virtualPath] = { pageId: meta.id, hash: fileHash };
        result.created.push(meta.id);
        continue;
      }

      if (recorded && recorded.hash === fileHash) continue; // disk unchanged

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
        hashes[virtualPath] = { pageId: page.id, hash: fileHash };
      } else {
        result.conflicts.push(virtualPath);
        await this.writeSourceFile(page, docText);
        hashes[virtualPath] = { pageId: page.id, hash: docHash };
      }
    }

    // Pages with no file (new or externally deleted) get one exported.
    const known = new Set(files.keys());
    for (const page of pages) {
      if (known.has(page.path)) continue;

      const text = await this.loadPageText(page.id);
      await this.writeSourceFile(page, text);
      hashes[page.path] = { pageId: page.id, hash: hashText(text) };
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
    const themeName = map.get("themeName");
    settings.themeName = typeof themeName === "string" ? themeName : DEFAULT_SETTINGS.themeName;
    const themeCustom = decodeSetting<WorkspaceSettings["themeCustom"] | null>(
      map.get("themeCustom"),
    );
    settings.themeCustom =
      themeCustom && typeof themeCustom === "object" && Object.keys(themeCustom).length > 0
        ? themeCustom
        : DEFAULT_SETTINGS.themeCustom;

    return settings;
  }

  updateSettings(patch: Partial<WorkspaceSettings>): void {
    const map = this.doc.getMap("settings");
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (key === "publish") map.set("publish", encodeSetting(value));
      else if (key === "ai") map.set("ai", encodeSetting(value));
      else if (key === "search") map.set("search", encodeSetting(value));
      else if (key === "themeCustom") map.set("themeCustom", encodeSetting(value));
      else map.set(key, value);
    }
    this.doc.commit();
  }

  getPublishSettings() {
    return this.getSettings().publish;
  }

  getAiConfig() {
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

    return map.toJSON() as PageMeta;
  }

  private writePageMeta(meta: PageMeta): void {
    const pages = this.doc.getMap("pages");
    // Older docs hold regular op-id children at these keys;
    // ensureMergeableMap throws on those. Reuse what exists, create
    // deterministic mergeable children only for fresh keys.
    const map = (pages.get(meta.id) as LoroMap | undefined) ?? pages.ensureMergeableMap(meta.id);

    const tags = (map.get("tags") as LoroList | undefined) ?? map.ensureMergeableList("tags");
    for (let i = tags.length - 1; i >= 0; i--) tags.delete(i, 1);
    for (const tag of meta.tags) tags.push(tag);

    map.set("id", meta.id);
    map.set("path", meta.path);
    map.set("title", meta.title);
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
    const meta: PageMeta = {
      id: createId(),
      path: this.uniquePath(input.path ?? `pages/${slugify(input.title)}.typ`),
      title: input.title.trim() || "Untitled",
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

  /** Locale-aware date label: "Wednesday, 2026-09-02" in the workspace locale. */
  private formatDate(date: string): string {
    const parsed = new Date(`${date}T00:00:00Z`);
    return `${this.weekdayName(date)}, ${parsed.toISOString().slice(0, 10)}`;
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

  /** docId space: workspace id, page ids, and `plugin:<instanceId>` docs. */
  async getDocById(docId: string): Promise<LoroDoc | null> {
    if (docId === this.workspaceId) return this.doc;

    const instanceId = pluginInstanceOf(docId);
    if (instanceId !== null) {
      if (!this.getPluginInstance(instanceId)) return null;

      return this.openPluginDoc(instanceId);
    }

    if (!this.getPage(docId)) return null;

    return this.openPageDoc(docId);
  }

  async listDocIds(): Promise<string[]> {
    const ids = [this.workspaceId];
    for (const page of this.listPages()) ids.push(page.id);
    for (const instance of this.listPluginInstances()) ids.push(pluginDocId(instance.id));

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
    const entry = (map.get(ref) as LoroMap | undefined) ?? map.ensureMergeableMap(ref);
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
    const map =
      (plugins.get(install.id) as LoroMap | undefined) ?? plugins.ensureMergeableMap(install.id);
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
    const map =
      (instances.get(instance.id) as LoroMap | undefined) ??
      instances.ensureMergeableMap(instance.id);
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
      const collection =
        (collections.get(op.collection) as LoroMap | undefined) ??
        collections.ensureMergeableMap(op.collection);

      if (op.op === "append") {
        const map =
          (collection.get(op.record.id) as LoroMap | undefined) ??
          collection.ensureMergeableMap(op.record.id);
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

      const map =
        (collection.get(op.id) as LoroMap | undefined) ?? collection.ensureMergeableMap(op.id);

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
    const dir = `workspaces/${this.workspaceId}/blobs`;
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
      for (const match of text.matchAll(/typbase-blob\/([0-9a-f]{64})/g)) add(match[1]!, page.id);

      for (const asset of Object.values(this.getAssets(page.id))) {
        if (asset.hash) add(asset.hash, page.id);
      }
    }

    return references;
  }

  private async seed(name = "My workspace"): Promise<void> {
    const welcome = [
      "= Welcome to typbase",
      "",
      "This is a *Typst* document. The whole app is Typst:",
      "",
      '- `#typbase.query("pages")` reads app data as JSON',
      '- `#typbase.embed("<page-id>")` includes another page',
      "",
      "Every page in this workspace:",
      "",
      '#let pages = typbase.query("pages")',
      "",
      "#for page in pages [",
      "  - #page.title (#page.path)",
      "]",
      "",
      "== Your turn",
      "",
      "Create a page from the sidebar, or open today's daily note. The page",
      "list above came from the app: Typst asked for data through the request",
      "channel and the app answered with JSON.",
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
