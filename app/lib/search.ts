import type { WorkspaceStore } from "@typbase/storage";
import type { TypstState } from "@typbase/wasm";

import type { IndexedBlock, SearchHit } from "~/workers/index.worker";

import { useTypst } from "~/composables/typst";

/**
 * Search manager: owns the index worker connection, feeds it flattened
 * blocks from the wasm syntax pass, and answers palette queries with a
 * hybrid (BM25 + optional semantic) merge. Indexing is incremental off the
 * store's commit batches, debounced, one transaction per page.
 */

export interface SearchResultItem {
  docId: string;
  path: string;
  title: string;
  blockIndex: number;
  kind: string;
  /** Snippet with [[ ]] highlights from FTS. */
  snippet: string;
  /** Raw source range for the best hit in the block. */
  rawRange: { from: number; to: number } | null;
  bm25: number | null;
  semantic: number | null;
}

export interface SearchStatus {
  ready: boolean;
  mode: "opfs" | "memory" | "starting";
  docs: number;
  blocks: number;
  semantic: boolean;
  model: "idle" | "downloading" | "ready" | "error";
  error: string | null;
}

const INDEX_DEBOUNCE_MS = 2000;
const MAX_HITS = 24;

export class SearchManager {
  private worker: Worker | undefined;
  private embedWorker: Worker | undefined;
  private embedSeq = 0;
  private embedPending = new Map<number, (vectors: number[][]) => void>();
  private pendingDocs = new Set<string>();
  private indexMaps = new Map<string, Map<number, Uint8Array>>();
  private blockIds = new Map<string, number[]>();
  // Debounce via the global useDebounceFn; outside a component scope it never
  // auto-disposes, which is fine: the manager lives for the app's lifetime.
  private flushIndexDebounced = useDebounceFn(() => void this.flushIndex(), INDEX_DEBOUNCE_MS);
  private statusValue: SearchStatus = {
    ready: false,
    mode: "starting",
    docs: 0,
    blocks: 0,
    semantic: false,
    model: "idle",
    error: null,
  };
  private listeners = new Set<() => void>();
  private typst: Promise<TypstState> | undefined;

  constructor(private readonly store: WorkspaceStore) {}

  /** The workspace this index belongs to; switches rebuild the manager. */
  get workspaceId(): string {
    return this.store.workspaceId;
  }

  get status(): SearchStatus {
    return this.statusValue;
  }

  async start(): Promise<void> {
    this.worker = new Worker(new URL("../workers/index.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("message", (event: MessageEvent) =>
      this.handleWorkerMessage(event.data),
    );

    this.worker.postMessage({ type: "init", dbName: this.store.workspaceId });

    const semanticNow = this.store.getSearchSettings().semantic;
    this.statusValue.semantic = semanticNow;

    this.store.onLocalCommit((docId) => {
      this.markDirty(docId);
    });
    this.store.onStructureChange(() => {
      // Page renames/titles change search metadata and possibly contents.
      for (const page of this.store.listPages()) this.markDirty(page.id);
      this.emit();
    });

    // Initial sweep: index every doc the first time, cursors live in the
    // store's local state? No: search freshness is per-device honest by
    // re-indexing anything that changed since the last local build.
    for (const docId of await this.store.listDocIds()) {
      this.markDirty(docId);
    }
  }

  private markDirty(docId: string): void {
    this.pendingDocs.add(docId);
    void this.flushIndexDebounced();
  }

  private async flushIndex(): Promise<void> {
    const batch = [...this.pendingDocs];
    this.pendingDocs.clear();

    this.typst ??= useTypst();
    const typstState = await this.typst;

    for (const docId of batch) {
      // eslint-disable-next-line no-await-in-loop
      await this.indexDoc(docId, typstState);
    }
  }

  private async indexDoc(docId: string, typstState: TypstState): Promise<void> {
    if (docId === this.store.workspaceId) {
      // The workspace doc holds metadata, not page content; pages index it.
      await this.indexWorkspaceMeta(typstState);
      return;
    }

    const page = this.store.getPage(docId);
    if (!page) {
      this.worker?.postMessage({ type: "delete", docId });
      return;
    }

    const text = await this.store.loadPageText(docId);

    const blocks = typstState.flattenDocument(text) as unknown as IndexedBlock[];
    const maps = new Map<number, Uint8Array>();
    for (const [i, block] of blocks.entries()) {
      const map = new Uint8Array(new Uint32Array(block.map).buffer);
      maps.set(i, map);
    }
    this.indexMaps.set(docId, maps);

    this.worker?.postMessage({
      type: "upsert",
      docId,
      path: page.path,
      title: page.title,
      updatedAt: page.updatedAt,
      blocks,
    });

    if (this.statusValue.semantic) {
      await this.embedAndStore(docId, blocks);
    }
  }

  private async indexWorkspaceMeta(typstState: TypstState): Promise<void> {
    // No full-text content in the workspace doc; page upserts keep the
    // pages table current.
    void typstState;
    this.emit();
  }

  /** Re-indexes and re-embeds everything (setting flip or model change). */
  async reembedAll(): Promise<void> {
    await this.rebuild();
  }

  private async embedAndStore(docId: string, blocks: IndexedBlock[]): Promise<void> {
    const rowIds = this.blockIds.get(docId);
    if (!rowIds || rowIds.length === 0 || !this.ensureEmbedWorker()) return;

    const vectors = await this.requestVectors(blocks.map((block) => block.plain));
    if (!vectors) return;

    for (let i = 0; i < blocks.length && i < vectors.length; i++) {
      const rowid = rowIds[i];
      if (rowid !== undefined) {
        this.worker?.postMessage({
          type: "put-vector",
          blockId: rowid,
          vector: vectors[i],
        });
      }
    }
  }

  private ensureEmbedWorker(): boolean {
    const settings = this.store.getSearchSettings();
    if (!settings.semantic) return false;

    if (!this.embedWorker) {
      this.embedWorker = new Worker(new URL("../workers/embed.worker.ts", import.meta.url), {
        type: "module",
      });
      this.embedWorker.addEventListener("message", (event: MessageEvent) => {
        const message = event.data as {
          id: number;
          type: string;
          vectors?: number[][];
          error?: string;
        };
        const entry = this.embedPending.get(message.id);
        if (!entry) return;

        this.embedPending.delete(message.id);
        this.statusValue.model = message.type === "result" ? "ready" : "error";
        this.statusValue.error = message.error ?? null;
        if (message.vectors) entry(message.vectors);
        this.emit();
      });
      this.statusValue.model = "downloading";
      this.emit();
    }

    return true;
  }

  private requestVectors(texts: string[]): Promise<number[][] | null> {
    if (!this.embedWorker || texts.length === 0) return Promise.resolve(null);
    const id = ++this.embedSeq;

    return new Promise((resolve) => {
      this.embedPending.set(id, resolve);
      this.embedWorker!.postMessage({
        id,
        type: "embed",
        texts: texts.slice(0, 64),
        model: this.store.getSearchSettings().embeddingModel,
      });
    });
  }

  /** Full-text + optional semantic query, fused by reciprocal rank fusion. */
  async query(text: string, limit = MAX_HITS): Promise<SearchResultItem[]> {
    if (!this.worker) return [];

    const query = text.trim();
    if (!query) return [];

    const ftsHits = await this.queryWorker<SearchHit[]>("query", {
      type: "query",
      text: query,
      limit: MAX_HITS,
    });

    let semanticHits: SearchHit[] = [];
    if (this.statusValue.semantic && this.ensureEmbedWorker()) {
      const vectors = await this.requestVectors([query]);
      if (vectors?.[0]) {
        semanticHits = await this.queryWorker<SearchHit[]>("semantic-query", {
          type: "semantic-query",
          vector: vectors[0],
          limit: MAX_HITS,
        });
      }
    }

    const fused = this.fuse(ftsHits, semanticHits, limit);

    return fused.map((hit) => this.toItem(hit));
  }

  private queryWorker<T>(channel: "query" | "semantic-query", request: unknown): Promise<T> {
    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent) => {
        const message = event.data as {
          type?: string;
          hits?: T;
          error?: string;
        };
        if (message.type !== channel) return;

        this.worker!.removeEventListener("message", onMessage);
        if (message.error) {
          resolve([] as T);
          return;
        }

        resolve(message.hits as T);
      };
      this.worker!.addEventListener("message", onMessage);
      this.worker!.postMessage(request);
    });
  }

  private fuse(
    fts: SearchHit[],
    semantic: SearchHit[],
    limit: number,
  ): Array<SearchHit & { combined: number; snippet: string }> {
    type Fused = SearchHit & { combined: number; snippet: string };
    const map = new Map<string, Fused>();

    const add = (hit: SearchHit, rank: number, kind: "fts" | "sem") => {
      const key = `${hit.docId}:${hit.blockIndex}`;
      const existing = map.get(key);
      const score = 1 / (60 + rank);
      if (existing) {
        if (kind === "fts") existing.bm25 = hit.bm25;
        else existing.semantic = hit.semantic ?? existing.semantic;
        existing.combined += score;
      } else {
        map.set(key, {
          ...hit,
          combined: score,
          snippet: this.snippetFor(hit),
        });
      }
    };

    fts.forEach((hit, index) => add(hit, index, "fts"));
    semantic.forEach((hit, index) => add(hit, index, "sem"));

    return [...map.values()].sort((a, b) => b.combined - a.combined).slice(0, limit);
  }

  private snippetFor(hit: SearchHit): string {
    const [first] = hit.offsets;
    if (!first) return hit.plain.slice(0, 120);

    const from = Math.max(0, first[0] - 24);
    const to = Math.min(hit.plain.length, first[1] + 60);

    return `${from > 0 ? "…" : ""}${hit.plain.slice(from, to)}${to < hit.plain.length ? "…" : ""}`;
  }

  private toItem(hit: SearchHit & { snippet: string }): SearchResultItem {
    let rawRange: SearchResultItem["rawRange"] = null;
    const [first] = hit.offsets;
    const maps = this.indexMaps.get(hit.docId);
    if (first && maps) {
      const map = maps.get(hit.blockIndex);
      if (map) {
        const u32 = new Uint32Array(map.buffer, map.byteOffset, map.byteLength / 4);
        const from = u32[Math.min(first[0], u32.length - 1)];
        const to = u32[Math.min(first[1] - 1, u32.length - 1)];
        if (from !== undefined && to !== undefined) {
          rawRange = { from, to: to + 1 };
        }
      }
    }

    return {
      docId: hit.docId,
      path: hit.path,
      title: hit.title,
      blockIndex: hit.blockIndex,
      kind: hit.kind,
      snippet: hit.snippet,
      rawRange,
      bm25: hit.bm25,
      semantic: hit.semantic ?? null,
    };
  }

  async rebuild(): Promise<void> {
    this.worker?.postMessage({ type: "wipe" });
    this.indexMaps.clear();
    this.blockIds.clear();
    for (const docId of await this.store.listDocIds()) this.markDirty(docId);
  }

  /** Terminates both workers. Called when the shared composable disposes. */
  stop(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.embedWorker?.terminate();
    this.embedWorker = undefined;
  }

  private handleWorkerMessage(message: {
    type: string;
    status?: SearchStatus;
    blockIds?: number[];
    docId?: string;
  }): void {
    if (message.type === "status" && message.status) {
      this.statusValue.ready = true;
      this.statusValue.mode = message.status.mode;
      this.statusValue.docs = message.status.docs;
      this.statusValue.blocks = message.status.blocks;
      this.emit();
    }
    if (message.type === "upserted" && message.docId && message.blockIds) {
      this.blockIds.set(message.docId, message.blockIds);
      if (this.statusValue.semantic && this.embedWorker) {
        const page = this.store.getPage(message.docId);
        if (page) void this.reindexVectors(message.docId);
      }
    }
  }

  /** A page just landed in the index; seed (or refresh) its vectors. */
  private async reindexVectors(docId: string): Promise<void> {
    const page = this.store.getPage(docId);
    if (!page) return;

    const text = await this.store.loadPageText(docId);
    this.typst ??= useTypst();
    const typstState = await this.typst;
    const blocks = typstState.flattenDocument(text) as unknown as IndexedBlock[];
    await this.embedAndStore(docId, blocks);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
