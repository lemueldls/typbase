<script setup lang="ts">
import type { StorageEntryStat } from "@typbase/storage";
import type { PageMeta, WorkspaceInfo } from "@typbase/typing";

import {
  WorkspaceRegistry,
  WorkspaceStore,
  exportTauriStorageFile,
  isTauri,
  pagePath,
} from "@typbase/storage";

import { formatAgo } from "~/lib/format";

/**
 * Debug surface for the active storage backend: a semantic view of the
 * workspace registry and Loro docs, and a raw tree over the same byte paths.
 * Actions that mutate workspace metadata go through the store; raw file
 * actions only touch bytes and can break a workspace if misused.
 */

interface FileNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt?: number;
  expanded: boolean;
  children?: FileNode[];
}

const { backend, storageLocation, workspaces, activeWorkspaceId, workspace, deleteWorkspace } =
  useWorkspace();
const { t, locale } = useI18n();

const view = ref<"data" | "files">("data");
const loading = ref(false);
const error = ref("");

const isNative = computed(() => storageLocation.value.environment === "native");

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return "";

  return formatAgo(timestamp, locale.value);
}

/* Data view: registry entries plus a lazily opened store per workspace. */

const workspaceSizes = ref(new Map<string, number>());
const expandedWorkspaceId = ref<string | null>(null);
const expandedPages = ref<PageMeta[]>([]);
const pageSizes = ref(new Map<string, number>());
const storeCache = new Map<string, WorkspaceStore>();

async function directorySize(path: string): Promise<number> {
  const active = backend.value;
  if (!active) return 0;

  let total = 0;
  for (const name of await active.list(path)) {
    const child = path ? `${path}/${name}` : name;
    const info = await active.stat(child);
    if (!info) continue;
    total += info.kind === "directory" ? await directorySize(child) : info.size;
  }

  return total;
}

async function refreshData(): Promise<void> {
  const active = backend.value;
  if (!active) return;

  error.value = "";
  const registry = new WorkspaceRegistry(active);
  const entries = await registry.list();

  const sizes = new Map<string, number>();
  for (const entry of entries) {
    sizes.set(entry.id, await directorySize(`workspaces/${entry.id}`));
  }
  workspaceSizes.value = sizes;
}

async function toggleWorkspace(info: WorkspaceInfo): Promise<void> {
  const active = backend.value;
  if (!active) return;

  if (expandedWorkspaceId.value === info.id) {
    expandedWorkspaceId.value = null;
    return;
  }

  error.value = "";
  try {
    let store = storeCache.get(info.id);
    if (!store) {
      store = await WorkspaceStore.open(active, info.id);
      storeCache.set(info.id, store);
    }
    const pages = store.listPages();
    const sizes = new Map<string, number>();
    for (const page of pages) {
      const stat = await active.stat(pagePath(info.id, page.id));
      if (stat) sizes.set(page.id, stat.size);
    }
    expandedPages.value = pages;
    pageSizes.value = sizes;
    expandedWorkspaceId.value = info.id;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function deletePageEntry(info: WorkspaceInfo, page: PageMeta): Promise<void> {
  const active = backend.value;
  if (!active) return;
  if (!window.confirm(t("explorer.deletePageConfirm", { title: page.title }))) return;

  error.value = "";
  try {
    if (activeWorkspaceId.value === info.id && workspace.value) {
      await workspace.value.deletePage(page.id);
    } else {
      const store = storeCache.get(info.id) ?? (await WorkspaceStore.open(active, info.id));
      storeCache.set(info.id, store);
      await store.deletePage(page.id);
    }
    await toggleWorkspaceReopen(info);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

/** Refreshes the expanded page list without collapsing the row. */
async function toggleWorkspaceReopen(info: WorkspaceInfo): Promise<void> {
  expandedWorkspaceId.value = null;
  await toggleWorkspace(info);
}

async function deleteWorkspaceEntry(info: WorkspaceInfo): Promise<void> {
  if (!window.confirm(t("explorer.deleteWorkspaceConfirm", { name: info.name }))) return;

  error.value = "";
  try {
    await deleteWorkspace(info.id);
    storeCache.delete(info.id);
    expandedWorkspaceId.value = null;
    await refreshData();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function reveal(relative: string): Promise<void> {
  try {
    const [{ revealItemInDir }, { resolveStoragePath, tauriStorageState }] = await Promise.all([
      import("@tauri-apps/plugin-opener"),
      import("@typbase/storage"),
    ]);
    await revealItemInDir(resolveStoragePath(await tauriStorageState(), relative));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

/* Files view: a lazy tree over `list` + `stat`. */

const nodes = ref<FileNode[]>([]);

async function readChildren(path: string): Promise<FileNode[]> {
  const active = backend.value;
  if (!active) return [];

  const result: FileNode[] = [];
  for (const name of await active.list(path)) {
    const child = path ? `${path}/${name}` : name;
    const info: StorageEntryStat | null = await active.stat(child);
    result.push({
      name,
      path: child,
      kind: info?.kind ?? "file",
      size: info?.size ?? 0,
      modifiedAt: info?.modifiedAt,
      expanded: false,
    });
  }

  return result;
}

async function refreshFiles(): Promise<void> {
  error.value = "";
  nodes.value = await readChildren("");
}

async function toggleFolder(node: FileNode): Promise<void> {
  if (node.kind !== "directory") return;

  error.value = "";
  try {
    if (!node.children) node.children = await readChildren(node.path);
    node.expanded = !node.expanded;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

interface FlatNode extends FileNode {
  depth: number;
}

const flatNodes = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  const walk = (list: FileNode[], depth: number) => {
    for (const node of list) {
      out.push({ ...node, depth });
      if (node.kind === "directory" && node.expanded && node.children) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes.value, 0);

  return out;
});

async function download(node: FileNode): Promise<void> {
  const active = backend.value;
  if (!active || node.kind !== "file") return;

  // The native shell has no reliable webview download path, so it goes
  // through the save dialog; browsers get the anchor download.
  if (isTauri()) {
    try {
      if (await exportTauriStorageFile(node.path)) return;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return;
    }
  }

  const bytes = await active.read(node.path);
  if (!bytes) return;

  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = node.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function upload(event: Event): Promise<void> {
  const active = backend.value;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!active || !file) return;

  error.value = "";
  try {
    await active.write(file.name, new Uint8Array(await file.arrayBuffer()));
    input.value = "";
    await refreshFiles();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function deleteNode(node: FileNode): Promise<void> {
  const active = backend.value;
  if (!active) return;
  if (!window.confirm(t("explorer.deleteFileConfirm", { path: node.path }))) return;

  error.value = "";
  try {
    await active.delete(node.path);
    await refreshFiles();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function refresh(): Promise<void> {
  const active = backend.value;
  if (!active) return;

  loading.value = true;
  try {
    await (view.value === "data" ? refreshData() : refreshFiles());
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

watch(view, () => void refresh());
watch(backend, () => {
  storeCache.clear();
  expandedWorkspaceId.value = null;
  void refresh();
});

onMounted(() => void refresh());
onBeforeUnmount(() => {
  for (const store of storeCache.values()) void store.flush();
});
</script>

<template>
  <section class="explorer">
    <header class="explorer__header">
      <h2 class="explorer__title">{{ $t("explorer.title") }}</h2>
      <div class="explorer__tabs">
        <button
          type="button"
          class="explorer__tab"
          :class="{ 'explorer__tab--active': view === 'data' }"
          @click="view = 'data'"
        >
          {{ $t("explorer.tabData") }}
        </button>
        <button
          type="button"
          class="explorer__tab"
          :class="{ 'explorer__tab--active': view === 'files' }"
          @click="view = 'files'"
        >
          {{ $t("explorer.tabFiles") }}
        </button>
      </div>
      <button type="button" class="button button--tiny" :disabled="loading" @click="refresh">
        {{ loading ? $t("explorer.refreshing") : $t("explorer.refresh") }}
      </button>
    </header>

    <p class="explorer__location">
      <span>{{ storageLocation.label }}</span>
      <span v-if="storageLocation.path" class="explorer__path">{{ storageLocation.path }}</span>
      <button
        v-if="isNative && storageLocation.path"
        type="button"
        class="button button--ghost button--tiny"
        @click="reveal('')"
      >
        {{ $t("explorer.reveal") }}
      </button>
    </p>

    <p v-if="error" class="explorer__error" role="alert">{{ error }}</p>

    <div v-if="view === 'data'" class="explorer__panel">
      <p v-if="!workspaces.length" class="explorer__empty">{{ $t("explorer.noWorkspaces") }}</p>

      <div v-for="info in workspaces" :key="info.id" class="explorer__workspace">
        <div class="explorer__row">
          <button type="button" class="explorer__expand" @click="toggleWorkspace(info)">
            <MsIcon
              :name="expandedWorkspaceId === info.id ? 'keyboard_arrow_down' : 'chevron_right'"
              :size="18"
            />
          </button>
          <button type="button" class="explorer__name" @click="toggleWorkspace(info)">
            <span class="explorer__name-main">{{ info.name }}</span>
            <span class="explorer__name-meta">
              {{ info.id }} · {{ formatBytes(workspaceSizes.get(info.id) ?? 0) }}
              <template v-if="info.lastOpenedAt">
                · {{ $t("explorer.opened", { when: formatTime(info.lastOpenedAt) }) }}
              </template>
              <template v-if="info.id === activeWorkspaceId">
                · {{ $t("explorer.active") }}
              </template>
            </span>
          </button>
          <span class="explorer__actions">
            <button
              v-if="isNative"
              type="button"
              class="button button--ghost button--tiny"
              @click="reveal(`workspaces/${info.id}`)"
            >
              <MsIcon name="folder_open" :size="14" />
            </button>
            <button
              type="button"
              class="button button--ghost button--tiny explorer__danger"
              @click="deleteWorkspaceEntry(info)"
            >
              <MsIcon name="delete" :size="14" />
            </button>
          </span>
        </div>

        <ul v-if="expandedWorkspaceId === info.id" class="explorer__pages">
          <li v-for="page in expandedPages" :key="page.id" class="explorer__page">
            <span class="explorer__page-title">{{ page.title }}</span>
            <span class="explorer__page-path">{{ page.path }}</span>
            <span class="explorer__page-meta">
              {{ formatBytes(pageSizes.get(page.id) ?? 0) }}
              <template v-if="page.updatedAt"> · {{ formatTime(page.updatedAt) }}</template>
            </span>
            <button
              type="button"
              class="button button--ghost button--tiny explorer__danger"
              @click="deletePageEntry(info, page)"
            >
              <MsIcon name="delete" :size="14" />
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div v-else class="explorer__panel">
      <label class="button button--tiny explorer__upload">
        {{ $t("explorer.upload") }}
        <input type="file" hidden @change="upload" />
      </label>

      <div
        v-for="node in flatNodes"
        :key="node.path"
        class="explorer__node"
        :style="{ paddingLeft: `${0.4 + node.depth * 1.1}rem` }"
      >
        <button
          v-if="node.kind === 'directory'"
          type="button"
          class="explorer__expand"
          @click="toggleFolder(node)"
        >
          <MsIcon :name="node.expanded ? 'keyboard_arrow_down' : 'chevron_right'" :size="16" />
        </button>
        <span v-else class="explorer__expand explorer__expand--file">
          <MsIcon name="draft" :size="14" />
        </span>
        <span
          class="explorer__node-name"
          :class="{ 'explorer__node-name--dir': node.kind === 'directory' }"
        >
          {{ node.name }}
        </span>
        <span class="explorer__node-meta">
          <template v-if="node.kind === 'file'">{{ formatBytes(node.size) }}</template>
          <template v-else>{{ $t("explorer.directory") }}</template>
          <template v-if="node.modifiedAt"> · {{ formatTime(node.modifiedAt) }}</template>
        </span>
        <span class="explorer__actions">
          <button
            v-if="node.kind === 'file'"
            type="button"
            class="button button--ghost button--tiny"
            @click="download(node)"
          >
            <MsIcon name="download" :size="14" />
          </button>
          <button
            v-if="isNative"
            type="button"
            class="button button--ghost button--tiny"
            @click="reveal(node.path)"
          >
            <MsIcon name="folder_open" :size="14" />
          </button>
          <button
            type="button"
            class="button button--ghost button--tiny explorer__danger"
            @click="deleteNode(node)"
          >
            <MsIcon name="delete" :size="14" />
          </button>
        </span>
      </div>
    </div>

    <p class="explorer__hint">{{ $t("explorer.hint") }}</p>
  </section>
</template>

<style scoped>
.explorer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.6rem;
  padding: 0.75rem;
  background: var(--color-surface);
}

.explorer__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.explorer__title {
  margin: 0;
  font-size: 1rem;
  flex: 1;
}

.explorer__tabs {
  display: flex;
  gap: 0.25rem;
}

.explorer__tab {
  border: 1px solid var(--color-border);
  background: transparent;
  color: inherit;
  border-radius: 0.35rem;
  padding: 0.2rem 0.6rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.explorer__tab--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.explorer__location {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  flex-wrap: wrap;
}

.explorer__path {
  font-family: var(--font-code, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.explorer__panel {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.explorer__empty,
.explorer__error,
.explorer__hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.explorer__error {
  color: var(--color-danger);
}

.explorer__workspace {
  border-bottom: 1px solid var(--color-border);
}

.explorer__row,
.explorer__node {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  padding: 0.25rem 0;
}

.explorer__expand,
.explorer__expand--file {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.3rem;
  flex: none;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 0;
}

.explorer__expand--file {
  cursor: default;
}

.explorer__name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.05rem;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0;
}

.explorer__name-main {
  font-size: 0.9rem;
}

.explorer__name-meta,
.explorer__page-meta {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
}

.explorer__node-name {
  flex: 1;
  min-width: 0;
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer__node-name--dir {
  font-weight: 600;
}

.explorer__node-meta {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  flex: none;
}

.explorer__actions {
  display: flex;
  gap: 0.1rem;
  flex: none;
}

.explorer__danger {
  color: var(--color-danger);
}

.explorer__pages {
  list-style: none;
  margin: 0;
  padding: 0 0 0.4rem 1.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.explorer__page {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  font-size: 0.8rem;
}

.explorer__page-title {
  flex: none;
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer__page-path {
  flex: 1;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer__upload {
  align-self: flex-start;
  cursor: pointer;
}
</style>
