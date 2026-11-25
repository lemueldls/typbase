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
 * Actions that mutate workspace metadata go through the store, while raw file
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
const { confirm } = useConfirm();

const props = withDefaults(
  defineProps<{
    initialView?: "data" | "files" | "assets";
    /** Flat layout for a pane that already provides chrome. */
    bare?: boolean;
  }>(),
  { initialView: "data", bare: false },
);

const view = ref<"data" | "files" | "assets">(props.initialView);
const loading = ref(false);
const error = ref("");
const assetBrowser = useTemplateRef<{ refresh: () => Promise<void> }>("assetBrowser");

const explorerTabs = [
  { id: "data", labelKey: "explorer.tabData" },
  { id: "files", labelKey: "explorer.tabFiles" },
  { id: "assets", labelKey: "explorer.tabAssets" },
] as const;

function onTabKeydown(event: KeyboardEvent): void {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();

  const index = explorerTabs.findIndex((tab) => tab.id === view.value);
  const delta = event.key === "ArrowRight" ? 1 : -1;
  const next = explorerTabs[(index + delta + explorerTabs.length) % explorerTabs.length]!;
  view.value = next.id;
  const tabs = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
    '[role="tab"]',
  );
  tabs[explorerTabs.indexOf(next)]?.focus();
}

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
const expandedWorkspaceId = ref<string>();
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

async function loadWorkspacePages(info: WorkspaceInfo): Promise<void> {
  const active = backend.value;
  if (!active) return;

  error.value = "";
  try {
    let store = storeCache.get(info.id);
    if (!store) {
      store = await WorkspaceStore.open(active, info.id, {
        readOnly: info.spaceRole === "viewer",
        ...(info.space ? { syncId: info.space.skey } : {}),
      });
      storeCache.set(info.id, store);
    }
    const pages = store.listPages();
    const sizes = new Map<string, number>();
    for (const page of pages) {
      const stat = await active.stat(pagePath(info.id, page.id));
      if (stat) sizes.set(page.id, stat.size);
    }

    // A slower open can land after another row, so only fill the one on screen.
    if (expandedWorkspaceId.value !== info.id) return;
    expandedPages.value = pages;
    pageSizes.value = sizes;
  } catch (cause) {
    if (expandedWorkspaceId.value !== info.id) return;
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function deletePageEntry(info: WorkspaceInfo, page: PageMeta): Promise<void> {
  const active = backend.value;
  if (!active) return;
  const remove = await confirm({
    title: t("explorer.deletePageTitle"),
    description: t("explorer.deletePageConfirm", { title: page.title }),
  });
  if (!remove) return;

  error.value = "";
  try {
    if (activeWorkspaceId.value === info.id && workspace.value) {
      await workspace.value.deletePage(page.id);
    } else {
      const store =
        storeCache.get(info.id) ??
        (await WorkspaceStore.open(active, info.id, {
          readOnly: info.spaceRole === "viewer",
          ...(info.space ? { syncId: info.space.skey } : {}),
        }));
      storeCache.set(info.id, store);
      await store.deletePage(page.id);
    }
    await reloadWorkspacePages(info);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

/** Refreshes the expanded page list without collapsing the row. */
async function reloadWorkspacePages(info: WorkspaceInfo): Promise<void> {
  expandedPages.value = [];
  pageSizes.value = new Map();
  await loadWorkspacePages(info);
}

async function deleteWorkspaceEntry(info: WorkspaceInfo): Promise<void> {
  const remove = await confirm({
    title: t("explorer.deleteWorkspaceTitle"),
    description: t("explorer.deleteWorkspaceConfirm", { name: info.name }),
  });
  if (!remove) return;

  error.value = "";
  try {
    await deleteWorkspace(info.id);
    storeCache.delete(info.id);
    if (expandedWorkspaceId.value === info.id) expandedWorkspaceId.value = undefined;
    await refreshData();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function reveal(relative: string): Promise<void> {
  try {
    const [{ revealItemsInDir }, { resolveStoragePath, tauriStorageState }] = await Promise.all([
      import("@tauri-apps/plugin-opener"),
      import("@typbase/storage"),
    ]);
    await revealItemsInDir(resolveStoragePath(await tauriStorageState(), relative));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

/* Files view: a lazy tree over `list` + `stat`. */

const nodes = ref<FileNode[]>([]);
/** Recursive folder totals, keyed by path. Filled in as listings arrive. */
const folderSizes = ref(new Map<string, number>());
const measuring = new Set<string>();

async function measureFolder(node: FileNode): Promise<void> {
  if (node.kind !== "directory" || folderSizes.value.has(node.path) || measuring.has(node.path)) {
    return;
  }

  measuring.add(node.path);
  try {
    const size = await directorySize(node.path);
    const next = new Map(folderSizes.value);
    next.set(node.path, size);
    folderSizes.value = next;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    measuring.delete(node.path);
  }
}

/** A file's own size, or a folder's total once its walk finishes. */
function nodeMeta(node: FileNode): string {
  if (node.kind === "file") return formatBytes(node.size);

  const size = folderSizes.value.get(node.path);

  return size === undefined
    ? t("explorer.directory")
    : `${t("explorer.directory")} · ${formatBytes(size)}`;
}

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

  for (const node of result) {
    if (node.kind === "directory") void measureFolder(node);
  }

  return result;
}

async function refreshFiles(): Promise<void> {
  error.value = "";
  folderSizes.value = new Map();
  measuring.clear();
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

interface FlatNode {
  node: FileNode;
  depth: number;
}

const flatNodes = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  const walk = (list: FileNode[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth });
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
  // through the save dialog. Browsers get the anchor download.
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
  const remove = await confirm({
    title: t("explorer.deleteFileTitle"),
    description: t("explorer.deleteFileConfirm", { path: node.path }),
  });
  if (!remove) return;

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
    if (view.value === "assets") await assetBrowser.value?.refresh();
    else await (view.value === "data" ? refreshData() : refreshFiles());
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

watch(view, () => void refresh());
watch(expandedWorkspaceId, (id) => {
  expandedPages.value = [];
  pageSizes.value = new Map();
  const info = workspaces.value.find((entry) => entry.id === id);
  if (info) void loadWorkspacePages(info);
});
watch(backend, () => {
  storeCache.clear();
  expandedWorkspaceId.value = undefined;
  void refresh();
});

onMounted(() => void refresh());
onBeforeUnmount(() => {
  for (const store of storeCache.values()) void store.flush();
});
</script>

<template>
  <section class="explorer" :class="{ 'explorer--bare': bare }" :aria-busy="loading || undefined">
    <header class="explorer__header">
      <h2 v-if="!bare" class="explorer__title">{{ $t("explorer.title") }}</h2>

      <div
        class="explorer__tabs"
        role="tablist"
        :aria-label="$t('explorer.title')"
        @keydown="onTabKeydown"
      >
        <button
          v-for="tab in explorerTabs"
          :id="`explorer-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          class="explorer__tab"
          :class="{ 'explorer__tab--active': view === tab.id }"
          :aria-selected="view === tab.id"
          :aria-controls="`explorer-panel-${tab.id}`"
          :tabindex="view === tab.id ? 0 : -1"
          @click="view = tab.id"
        >
          {{ $t(tab.labelKey) }}
        </button>
      </div>

      <UiIconButton
        icon="refresh"
        class="explorer__refresh"
        :label="loading ? $t('explorer.refreshing') : $t('explorer.refresh')"
        :disabled="loading"
        @click="refresh"
      />
    </header>

    <div class="explorer__meta">
      <p class="explorer__location">
        <span>{{ storageLocation.label }}</span>
        <span v-if="storageLocation.path" class="explorer__path">{{ storageLocation.path }}</span>
      </p>

      <!-- <UiButton v-if="view === 'files'" as="label" size="small" class="explorer__upload">
        {{ $t("explorer.upload") }}
        <input type="file" hidden @change="upload" />
      </UiButton> -->

      <UiButton
        v-if="isNative && storageLocation.path"
        variant="ghost"
        size="small"
        @click="reveal('')"
      >
        {{ $t("explorer.reveal") }}
      </UiButton>
    </div>

    <p v-if="error" class="explorer__error" role="alert">{{ error }}</p>

    <div
      v-if="view === 'data'"
      id="explorer-panel-data"
      class="explorer__panel"
      role="tabpanel"
      aria-labelledby="explorer-tab-data"
    >
      <p v-if="!workspaces.length" class="explorer__empty">{{ $t("explorer.noWorkspaces") }}</p>

      <UiAccordion v-model="expandedWorkspaceId">
        <UiAccordionItem
          v-for="info in workspaces"
          :key="info.id"
          :value="info.id"
          class="explorer__workspace"
        >
          <template #trigger>
            <span class="explorer__name">
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
            </span>
          </template>

          <template #actions>
            <UiIconButton
              v-if="isNative"
              icon="folder_open"
              :size="20"
              :label="$t('explorer.reveal')"
              variant="ghost"
              class="button--tiny"
              @click="reveal(`workspaces/${info.id}`)"
            />
            <UiIconButton
              icon="delete"
              :size="20"
              :label="$t('common.delete')"
              variant="ghost"
              danger
              class="button--tiny"
              @click="deleteWorkspaceEntry(info)"
            />
          </template>

          <ul class="explorer__pages">
            <li v-for="page in expandedPages" :key="page.id" class="explorer__page">
              <span class="explorer__page-title">{{ page.title }}</span>
              <span class="explorer__page-path">{{ page.path }}</span>
              <span class="explorer__page-meta">
                {{ formatBytes(pageSizes.get(page.id) ?? 0) }}
                <template v-if="page.updatedAt"> · {{ formatTime(page.updatedAt) }}</template>
              </span>
              <UiIconButton
                icon="delete"
                :size="20"
                :label="$t('common.delete')"
                variant="ghost"
                danger
                class="button--tiny"
                @click="deletePageEntry(info, page)"
              />
            </li>
          </ul>
        </UiAccordionItem>
      </UiAccordion>
    </div>

    <div
      v-else-if="view === 'files'"
      id="explorer-panel-files"
      class="explorer__panel"
      role="tabpanel"
      aria-labelledby="explorer-tab-files"
    >
      <div
        v-for="entry in flatNodes"
        :key="entry.node.path"
        class="explorer__node"
        :style="{ '--depth': entry.depth }"
      >
        <span class="explorer__guides" aria-hidden="true">
          <span v-for="level in entry.depth" :key="level" class="explorer__guide" />
        </span>
        <UiTooltip
          v-if="entry.node.kind === 'directory'"
          :text="entry.node.expanded ? $t('explorer.collapse') : $t('explorer.expand')"
        >
          <button type="button" class="explorer__expand" @click="toggleFolder(entry.node)">
            <MsIcon
              :name="entry.node.expanded ? 'keyboard_arrow_down' : 'chevron_right'"
              :size="20"
            />
          </button>
        </UiTooltip>
        <span v-else class="explorer__expand explorer__expand--file">
          <MsIcon name="draft" :size="18" />
        </span>
        <button
          v-if="entry.node.kind === 'directory'"
          type="button"
          class="explorer__node-name explorer__node-name--dir explorer__node-name--toggle"
          :aria-expanded="entry.node.expanded"
          @click="toggleFolder(entry.node)"
        >
          {{ entry.node.name }}
        </button>
        <span v-else class="explorer__node-name">{{ entry.node.name }}</span>
        <span class="explorer__node-meta">
          {{ nodeMeta(entry.node) }}
          <template v-if="entry.node.modifiedAt">
            · {{ formatTime(entry.node.modifiedAt) }}</template
          >
        </span>
        <span class="explorer__actions">
          <UiIconButton
            v-if="entry.node.kind === 'file'"
            icon="download"
            :size="20"
            :label="$t('explorer.download')"
            variant="ghost"
            class="button--tiny"
            @click="download(entry.node)"
          />
          <UiIconButton
            v-if="isNative"
            icon="folder_open"
            :size="20"
            :label="$t('explorer.reveal')"
            variant="ghost"
            class="button--tiny"
            @click="reveal(entry.node.path)"
          />
          <UiIconButton
            icon="delete"
            :size="20"
            :label="$t('common.delete')"
            variant="ghost"
            danger
            class="button--tiny"
            @click="deleteNode(entry.node)"
          />
        </span>
      </div>
    </div>

    <div
      v-else
      id="explorer-panel-assets"
      class="explorer__panel"
      role="tabpanel"
      aria-labelledby="explorer-tab-assets"
    >
      <AssetBrowser ref="assetBrowser" />
    </div>

    <p v-if="view === 'files'" class="explorer__hint">{{ $t("explorer.hint") }}</p>
  </section>
</template>

<style>
.explorer {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

/* The Files pane already has a header and content surface, so it uses the
   explorer as a flat section instead of a second card. */
.explorer--bare {
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
}

.explorer__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.explorer__title {
  flex: 1 1 auto;
  margin: 0;
  font-size: var(--text-lg);
}

.explorer__tabs {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-0-5);
  padding: var(--space-0-5);
  background: var(--color-surface-3);
  border-radius: var(--radius-md);
}

.explorer__tab {
  height: var(--control-sm);
  padding: 0 var(--space-2-5);
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: max(0px, calc(var(--radius-md) - var(--space-0-5)));
  cursor: pointer;
}

.explorer__tab:hover:not(.explorer__tab--active) {
  color: var(--color-text);
}

.explorer__tab--active {
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: var(--shadow-1);
}

.explorer__refresh {
  margin-left: auto;
}

.explorer__refresh:disabled .ms-icon {
  animation: explorer-spin 0.8s linear infinite;
}

@keyframes explorer-spin {
  to {
    transform: rotate(360deg);
  }
}

.explorer__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.explorer__location {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.explorer__location > :first-child {
  color: var(--color-text);
  font-weight: 500;
}

.explorer__path {
  font-family: var(--font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.explorer__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.explorer__empty,
.explorer__error,
.explorer__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.explorer__error {
  color: var(--color-danger);
  overflow-wrap: anywhere;
}

.explorer__workspace:not(:last-child) {
  border-bottom: 1px solid var(--color-border);
}

.explorer__workspace .ui-accordion__header {
  padding: var(--space-1) 0;
}

.explorer__node {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
  padding: var(--space-1) 0 var(--space-1) calc(var(--space-1-5) + var(--depth, 0) * var(--space-4));
}

/* One line per ancestor. Positioned over the row's indent, so the lines run
   edge to edge down a folder's children. */
.explorer__guides {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--space-1-5);
  display: flex;
  pointer-events: none;
}

.explorer__guide {
  position: relative;
  width: var(--space-4);
}

.explorer__guide::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: var(--color-border);
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
  gap: var(--space-0-5);
}

.explorer__name-main {
  font-size: var(--text-md);
}

.explorer__name-meta,
.explorer__page-meta {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.explorer__node-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer__node-name--dir {
  font-weight: 600;
}

.explorer__node-name--toggle {
  padding: 0;
  font-family: inherit;
  color: inherit;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
}

.explorer__node-name--toggle:hover {
  text-decoration: underline;
}

.explorer__node-meta {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  flex: none;
}

.explorer__actions {
  display: flex;
  gap: var(--space-0-5);
  flex: none;
}

.explorer__pages {
  list-style: none;
  margin: 0;
  padding: 0 0 var(--space-1-5) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.explorer__page {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-sm);
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
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer__upload {
  flex: none;
  cursor: pointer;
}
</style>
