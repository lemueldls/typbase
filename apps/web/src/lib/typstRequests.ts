import type { WorkspaceStore } from "@typbase/storage";
import type { InstalledPackage, Section } from "@typbase/typing";
import type { TypstRequest } from "@typbase/wasm";

import { parseQueryPath } from "@typbase/typing";

import { fetchPackageBytes, samePackage, specString } from "~/lib/packages";
import { getPluginSource } from "~/lib/plugins/registry";
import { mirrorRequestPayload } from "~/lib/projectMirror";

interface TypstRequestHandler {
  (requests: TypstRequest[], spaceId: string): Promise<boolean> | boolean;
}

/** Plugin surfaces only see their own plugin data; notes see everything. */
export interface RequestScope {
  pluginId: string;
  /** False strips page content from the channel (no `pages.read`). */
  allowPages?: boolean;
}

// Included pages are raw sources: the `#import "/typbase/lib.typ" as typbase`
// lives in the compiling doc's prelude, not in the page text. Without this
// an embedded page that calls `typbase.query(...)` fails with
// "unknown variable: typbase".
const EMBED_PRELUDE = '#import "/typbase/lib.typ" as typbase\n';

/**
 * Answers the Typst engine's requests with workspace data.
 *
 * - `typbase/query/<kind>.json` file requests are synthesized JSON from the
 *   workspace (the `#typbase.query` stdlib loads them).
 * - `typbase/src/<id>.typ` source requests are other pages' content
 *   (the `#typbase.embed` stdlib includes them).
 *
 * The inserted query files go stale when workspace data changes; callers
 * `purge()` them and force a recompile.
 */
export interface TypstRequestService {
  handler: TypstRequestHandler;
  purge(): void;
  setCurrentPage(id: string | null): void;
}

/**
 * Raw payloads a request resolves to, without touching any wasm instance.
 * The editor service inserts them into its own TypstState; the publish
 * worker forwards them to the worker's instance.
 */
export type RequestPayload =
  | { type: "source"; path: string; text: string }
  | { type: "file"; path: string; bytes: Uint8Array }
  | { type: "package"; spec: InstalledPackage; bytes: Uint8Array };

export async function resolveRequestPayloads(
  requests: TypstRequest[],
  store: WorkspaceStore,
  currentPage: string | null,
  scope?: RequestScope,
): Promise<RequestPayload[]> {
  const payloads: RequestPayload[] = [];

  for (const request of requests) {
    if (request.type === "package") {
      const spec: InstalledPackage = {
        namespace: request.value.namespace,
        name: request.value.name,
        version: request.value.version,
      };

      try {
        payloads.push({ type: "package", spec, bytes: await fetchPackageBytes(spec) });
      } catch (error) {
        console.warn(`[typbase] could not fetch ${specString(spec)}:`, error);
      }
      continue;
    }

    // Request paths are root-absolute ("/typbase/src/<id>.typ"), so strip
    // the leading slash before matching.
    const path = request.value.replace(/^\//, "");

    if (request.type === "source") {
      if (path.startsWith("typbase/src/")) {
        if (scope && scope.allowPages === false) continue;
        const id = path.slice("typbase/src/".length, -".typ".length);
        // Self-embeds would recurse forever; a comment keeps the include quiet.
        const text =
          id === currentPage
            ? "// self-embed\n"
            : store.getPage(id)
              ? // Page docs load lazily; the embed must not depend on the
                // editor having opened this page already.
                EMBED_PRELUDE + (await store.loadPageText(id))
              : `// no page named ${JSON.stringify(id)}\n`;

        payloads.push({ type: "source", path, text });
        continue;
      }

      // Plugin modules, so notes can `#import "/typbase/plugin/..."`.
      if (path.startsWith("typbase/plugin/") || path === "typbase/ui.typ") {
        const text = getPluginSource(`/${path}`);
        if (text !== undefined) payloads.push({ type: "source", path, text });
        continue;
      }
    } else if (request.type === "file") {
      // Local media: `#image("/typbase/blob/<hash>.<ext>")`.
      if (path.startsWith("typbase/blob/")) {
        const name = path.slice("typbase/blob/".length);
        const hash = name.replace(/\.[^.]*$/, "");
        const bytes = await store.getBlob(hash);
        if (bytes) payloads.push({ type: "file", path, bytes });
        continue;
      }

      if (path.startsWith("typbase/query/")) {
        const parsed = parseQueryPath(path);
        if (!parsed) continue;
        if (scope && scope.allowPages === false && parsed.kind !== "plugin-data") continue;

        const json = await buildQueryJson(path, store, scope);
        if (json === null) continue;
        payloads.push({
          type: "file",
          path,
          bytes: new TextEncoder().encode(json),
        });
      }
    }
  }

  return payloads;
}

export function createTypstRequestService(
  typstState: {
    createFileId(path: string): unknown;
    insertSource(id: unknown, source: string): void;
    insertFile(id: unknown, bytes: Uint8Array): void;
    removeFile(id: unknown): void;
    installPackage(spec: string, bytes: Uint8Array): void;
  },
  store: WorkspaceStore,
): TypstRequestService {
  const insertedFiles = new Set<string>();
  const insertedSources = new Set<string>();
  const mirroredBlobs = new Set<string>();
  let currentPage: string | null = null;

  async function handle(requests: TypstRequest[]): Promise<boolean> {
    const payloads = await resolveRequestPayloads(requests, store, currentPage);
    let changed = false;

    for (const payload of payloads) {
      if (payload.type === "package") {
        typstState.installPackage(specString(payload.spec), payload.bytes);
        rememberPackage(store, payload.spec);
        changed = true;
      } else if (payload.type === "source") {
        typstState.insertSource(typstState.createFileId(payload.path), payload.text);
        insertedSources.add(payload.path);
        mirrorRequestPayload(store, payload.path, new TextEncoder().encode(payload.text));
        changed = true;
      } else {
        typstState.insertFile(typstState.createFileId(payload.path), payload.bytes);
        insertedFiles.add(payload.path);
        // Blobs are content-addressed: mirror each one once per session
        // instead of rewriting large files on every recompile.
        if (!payload.path.startsWith("typbase/blob/")) {
          mirrorRequestPayload(store, payload.path, payload.bytes);
        } else if (!mirroredBlobs.has(payload.path)) {
          mirroredBlobs.add(payload.path);
          mirrorRequestPayload(store, payload.path, payload.bytes);
        }
        changed = true;
      }
    }

    return changed;
  }

  function purge(): void {
    // Embedded page sources and query JSON both go stale when workspace data
    // changes; dropping them forces a re-request on the next compile. Blobs
    // are content-addressed and immutable, so they stay in the world: media
    // does not need to be re-read and re-copied on every change.
    for (const path of insertedSources) {
      typstState.removeFile(typstState.createFileId(path));
    }
    insertedSources.clear();

    for (const path of insertedFiles) {
      if (path.startsWith("typbase/blob/")) continue;

      typstState.removeFile(typstState.createFileId(path));
    }
    insertedFiles.clear();
  }

  return {
    handler: handle,
    purge,
    setCurrentPage: (id) => {
      currentPage = id;
    },
  };
}

/**
 * Records an auto-installed package in the workspace list, so the manager
 * shows what the notes actually depend on instead of only what was installed
 * by hand.
 */
function rememberPackage(store: WorkspaceStore, spec: InstalledPackage): void {
  const installed = store.getSettings().installedPackages;
  if (installed.some((pkg) => samePackage(pkg, spec))) return;

  store.updateSettings({ installedPackages: [...installed, spec] });
}

export async function buildQueryJson(
  path: string,
  store: WorkspaceStore,
  scope?: RequestScope,
): Promise<string | null> {
  const query = parseQueryPath(path);
  if (!query) return null;

  const pages = store.listPages();
  const daily = pages.filter((page) => page.path.startsWith("daily/"));
  // Single-segment filters carry the value in filterName (e.g. sections/<id>).
  const filterValue = query.filterValue ?? query.filterName;

  switch (query.kind) {
    case "config": {
      const settings = store.getSettings();

      return JSON.stringify({
        name: settings.name,
        homePageId: settings.homePageId,
        font: settings.font,
      });
    }
    case "pages": {
      if (query.filterName === "by-id" && query.filterValue) {
        const page = pages.find((candidate) => candidate.id === query.filterValue);
        // Typst's json() turns "null" into none; #typbase.page-link uses that
        // for missing pages instead of failing the compile.
        return page ? JSON.stringify(page) : "null";
      }

      const list =
        query.filterName === "by-category" && query.filterValue
          ? pages.filter((page) => page.categoryId === query.filterValue)
          : pages;

      return JSON.stringify(list);
    }
    case "categories":
      return JSON.stringify(store.listCategories());
    case "daily": {
      const list =
        query.filterName === "by-month" && query.filterValue
          ? daily.filter((page) => page.path.startsWith(`daily/${query.filterValue}-`))
          : daily;

      return JSON.stringify(list);
    }
    case "sections": {
      // One page's sections, or every page's when no filter is given.
      if (filterValue) return JSON.stringify(store.getSections(filterValue));

      const all: Array<Section & { pageId: string }> = [];
      for (const page of pages) {
        for (const section of store.getSections(page.id)) {
          all.push({ ...section, pageId: page.id });
        }
      }

      return JSON.stringify(all);
    }
    case "content": {
      if (!filterValue) return "null";
      // Accepts a page id or a date, so calendars can query `daily/` notes.
      const page =
        pages.find((candidate) => candidate.id === filterValue) ??
        pages.find((candidate) => candidate.path === `daily/${filterValue}.typ`);
      if (!page) return "null";

      return JSON.stringify({
        id: page.id,
        title: page.title,
        path: page.path,
        text: await store.loadPageText(page.id),
      });
    }
    case "plugin-data": {
      if (!filterValue) return "null";
      const instance = store.getPluginInstance(filterValue);
      if (!instance) return "null";
      // Plugin surfaces read their own data only; note content reads all.
      if (scope && instance.pluginId !== scope.pluginId) return "null";

      return JSON.stringify(await store.readPluginState(filterValue));
    }
    case "backlinks": {
      if (!query.filterValue) return JSON.stringify([]);

      const target = pages.find((page) => page.id === query.filterValue);
      if (!target) return JSON.stringify([]);

      const search = await Promise.all(
        pages.map(async (page) => {
          if (page.id === target.id) return false;

          // Backlinks are only as fresh as the last index: scan raw source
          // for `#typbase.embed("<id>")` or a path mention, cheapest first.
          const text = await store.loadPageText(page.id);

          return (
            text.includes(`#typbase.embed("${target.id}")`) ||
            text.includes(target.path) ||
            text.includes(target.title)
          );
        }),
      );

      return JSON.stringify(pages.filter((_, index) => search[index]));
    }
  }

  // Every query kind returns above; keep the fallthrough explicit.
  return null;
}
