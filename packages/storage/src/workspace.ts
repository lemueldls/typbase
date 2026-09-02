import type { AssetMeta, Category, PageMeta, Section, WorkspaceSettings } from "@typbase/typing";
import type { LoroDoc, LoroList, LoroMap, VersionVector } from "loro-crdt";

import { createId } from "@paralleldrive/cuid2";
import { DEFAULT_SETTINGS } from "@typbase/typing";

import type { StorageBackend } from "./backend";

import { type LoroModule, loadLoro } from "./loro";

const SNAPSHOT_DEBOUNCE_MS = 1000;

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

export function workspacePath(workspaceId: string): string {
  return `workspaces/${workspaceId}/workspace.loro`;
}

export function pagePath(workspaceId: string, pageId: string): string {
  return `workspaces/${workspaceId}/pages/${pageId}.loro`;
}

export interface WorkspaceStoreOptions {
  /** Snapshot writes are debounced by this much; a crash loses at most this window. */
  snapshotDebounceMs?: number;
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
  private readonly pathForDoc = new Map<LoroDoc, string>();
  private dirtyDocs = new Set<LoroDoc>();
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private structureListeners = new Set<() => void>();
  private pageListeners = new Map<string, Set<() => void>>();
  private commitListeners = new Set<(docId: string) => void>();
  private commitTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingCommits = new Set<string>();
  private loro!: LoroModule;

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

    console.log("[loro] open: loaded", !!bytes);
    if (!bytes) await store.seed();
    console.log("[loro] open: done");

    return store;
  }

  /** Writes any pending snapshots. Called on page hide so a crash loses little. */
  async flush(): Promise<void> {
    for (const doc of this.dirtyDocs) {
      const path = this.pathForDoc.get(doc);
      if (!path) continue;
      const snapshot = doc.export({ mode: "snapshot" });
      await this.backend.write(path, snapshot);
      this.dirtyDocs.delete(doc);
    }
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
    this.doc.getMap("pages").delete(id);
    this.doc.commit();

    const pageDoc = this.pageDocs.get(id);
    if (pageDoc) this.dirtyDocs.delete(pageDoc);
    this.pageDocs.delete(id);
    await this.backend.delete(pagePath(this.workspaceId, id));
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
      if (value[i].id === id) list.delete(i, 1);
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
      .replaceAll("{yesterday}", previous ?? "none")
      .replaceAll("{tomorrow}", next ?? "none");

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

  private formatDate(date: string): string {
    const parsed = new Date(`${date}T00:00:00Z`);

    return `${this.weekdayName(date)}, ${parsed.toISOString().slice(0, 10)}`;
  }

  private weekdayName(date: string): string {
    const weekday = new Date(`${date}T00:00:00Z`).toUTCString().slice(0, 3);
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const full = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    return full[names.indexOf(weekday)] ?? date;
  }

  private shiftDate(date: string, days: number): string {
    const parsed = new Date(`${date}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);

    return parsed.toISOString().slice(0, 10);
  }

  private async openPageDoc(pageId: string): Promise<LoroDoc> {
    const cached = this.pageDocs.get(pageId);
    if (cached) return cached;

    const { LoroDoc } = await loadLoro();
    const path = pagePath(this.workspaceId, pageId);
    const bytes = await this.backend.read(path);
    const doc = bytes ? LoroDoc.fromSnapshot(bytes) : new LoroDoc();

    this.pageDocs.set(pageId, doc);
    this.pathForDoc.set(doc, path);

    doc.subscribe(() => {
      this.scheduleSave(doc);
      this.emitPage(pageId);
      this.scheduleCommit(pageId);
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

  /** docId space: the workspace doc answers to the workspace id, page docs to page ids. */
  async getDocById(docId: string): Promise<LoroDoc | null> {
    if (docId === this.workspaceId) return this.doc;
    if (!this.getPage(docId)) return null;

    return this.openPageDoc(docId);
  }

  async listDocIds(): Promise<string[]> {
    const ids = [this.workspaceId];
    for (const page of this.listPages()) ids.push(page.id);

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
      if (value && typeof value === "object") out[key] = value as AssetMeta;
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

  private async seed(): Promise<void> {
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
      name: "My workspace",
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

  /** Called on any workspace-level change (pages, categories, settings). */
  onStructureChange(listener: () => void): () => void {
    this.structureListeners.add(listener);

    return () => this.structureListeners.delete(listener);
  }

  private scheduleSave(doc: LoroDoc): void {
    this.dirtyDocs.add(doc);

    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);

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
