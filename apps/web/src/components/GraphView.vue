<script setup lang="ts">
import type { GraphSettings } from "@typbase/typing";

import { DEFAULT_SETTINGS } from "@typbase/typing";

import { buildGraph } from "~/lib/graph";
import { testApi } from "~/lib/testApi";
import { resolveTheme } from "~/lib/themes";

const props = defineProps<{
  pageId: string | null;
}>();

const emit = defineEmits<{
  (e: "openPage", id: string): void;
  (e: "close"): void;
}>();

const { t } = useI18n();
const { workspace } = useWorkspace();
const { index, status, ensure, setWanted, clearWanted } = useLinks();

/** The graph wants its visible pages resolved: a query loop inside the view
 *  is an edge like any other. Pages outside a local graph stay untouched. */
const owner = Symbol("graph");

const resolving = computed(() => {
  const value = status.value;

  return Boolean(value && (value.resolving !== null || value.pending > 0));
});

const graphCanvas = useTemplateRef<{ fit: () => void }>("graphCanvas");
const query = ref("");
const selectedId = ref<string | null>(null);

const settings = useWorkspaceValue(
  workspace,
  ["settings"],
  (store) => store.getSettings().graph ?? DEFAULT_SETTINGS.graph,
  DEFAULT_SETTINGS.graph,
);

const pages = useWorkspaceValue(workspace, ["pages"], (store) => store.listPages(), []);

const categories = useWorkspaceValue(
  workspace,
  ["categories"],
  (store) => store.listCategories(),
  [],
);

const tags = computed(() => {
  const set = new Set<string>();
  for (const page of pages.value) {
    for (const tag of page.tags) set.add(tag);
  }

  return [...set].sort();
});

const graph = computed(() => {
  void status.value;

  return buildGraph(pages.value, index.value?.allRecords() ?? [], {
    local: settings.value.local,
    rootId: props.pageId,
    depth: settings.value.localDepth,
    categoryId: settings.value.categoryId,
    tag: settings.value.tag,
    showOrphans: settings.value.showOrphans,
  });
});

/** The local graph's root page; the header names it so the scope is obvious. */
const rootPage = computed(() => {
  if (!settings.value.local || !props.pageId) return null;

  return pages.value.find((page) => page.id === props.pageId) ?? null;
});

watch(
  graph,
  (value) =>
    setWanted(
      owner,
      value.nodes.map((node) => node.id),
    ),
  { immediate: true },
);

const palette = useWorkspaceValue(
  workspace,
  ["settings"],
  (store) => resolveTheme(store.getSettings()).palette,
  resolveTheme({ theme: "light" }).palette,
);

const matchIds = computed<Set<string> | null>(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return null;

  return new Set(
    graph.value.nodes
      .filter((node) => node.title.toLowerCase().includes(needle))
      .map((node) => node.id),
  );
});

const categoryOptions = computed(() => [
  { value: "all", label: t("graph.all") },
  ...categories.value.map((category) => ({ value: category.id, label: category.name })),
]);
const tagOptions = computed(() => [
  { value: "all", label: t("graph.all") },
  ...tags.value.map((tag) => ({ value: tag, label: tag })),
]);
const depthOptions = computed(() => [
  { value: "1", label: t("graph.depthOne") },
  { value: "2", label: t("graph.depthTwo") },
]);
const labelOptions = computed(() => [
  { value: "auto", label: t("graph.labelsAuto") },
  { value: "always", label: t("graph.labelsAlways") },
  { value: "never", label: t("graph.labelsNever") },
]);

function update(patch: Partial<GraphSettings>): void {
  const value = workspace.value;
  if (!value) return;

  value.updateSettings({ graph: { ...settings.value, ...patch } });
}

const localChoice = computed({
  get: () => settings.value.local,
  set: (value: boolean) => update({ local: value }),
});
const orphansChoice = computed({
  get: () => settings.value.showOrphans,
  set: (value: boolean) => update({ showOrphans: value }),
});
const depthChoice = computed({
  get: () => String(settings.value.localDepth),
  set: (value: string) => update({ localDepth: Number(value) === 2 ? 2 : 1 }),
});
const categoryChoice = computed({
  get: () => settings.value.categoryId ?? "all",
  set: (value: string) => update({ categoryId: value === "all" ? null : value }),
});
const tagChoice = computed({
  get: () => settings.value.tag ?? "all",
  set: (value: string) => update({ tag: value === "all" ? null : value }),
});
const labelsChoice = computed({
  get: () => settings.value.labels,
  set: (value: string) =>
    update({ labels: value === "always" || value === "never" ? value : "auto" }),
});

/** Non-default filter count for the toolbar badge. Scope depth counts only
 *  while local mode is on, since it does nothing otherwise. */
const activeFilters = computed(() => {
  const value = settings.value;
  let count = 0;
  if (value.categoryId) count += 1;
  if (value.tag) count += 1;
  if (value.labels !== "auto") count += 1;
  if (!value.showOrphans) count += 1;
  if (value.local && value.localDepth !== 1) count += 1;

  return count;
});

onMounted(() => {
  if (workspace.value) ensure(workspace.value);
  testApi.graphStats = () => ({ nodes: graph.value.nodes.length, edges: graph.value.edges.length });
});

watch(workspace, (value) => {
  if (value) {
    ensure(value);
    setWanted(
      owner,
      graph.value.nodes.map((node) => node.id),
    );
  }
});

onBeforeUnmount(() => {
  clearWanted(owner);
  testApi.graphStats = null;
});
</script>

<template>
  <div class="graph">
    <header
      class="graph__header"
      :class="{ 'graph__header--resolving': resolving }"
      data-tauri-drag-region="deep"
    >
      <slot name="nav-toggle" />
      <!-- <MsIcon name="hub" :size="20" class="graph__icon" /> -->
      <span class="graph__title">{{ t("graph.title") }}</span>
      <span class="graph__stats">
        {{ t("graph.stats", { pages: graph.nodes.length, links: graph.edges.length }) }}
      </span>
      <span v-if="resolving" class="graph__resolving" aria-live="polite">
        {{ t("graph.resolving", { count: status?.pending ?? 0 }) }}
      </span>
      <div class="graph__actions">
        <UiIconButton
          icon="fit_screen"
          :label="t('graph.fit')"
          variant="ghost"
          :size="20"
          @click="graphCanvas?.fit()"
        />
        <UiIconButton
          icon="close"
          :label="t('graph.close')"
          variant="ghost"
          :size="20"
          @click="emit('close')"
        />
      </div>
    </header>

    <div class="graph__toolbar">
      <UiTextField
        v-model="query"
        class="graph__search"
        :label="t('graph.search')"
        :placeholder="t('graph.search')"
      >
        <template #leading>
          <MsIcon name="search" :size="20" class="graph__search-icon" />
        </template>
      </UiTextField>

      <!-- <UiTooltip v-if="rootPage" :text="t('graph.openContextPage')">
        <button type="button" class="graph__context" @click="emit('openPage', rootPage.id)">
          <MsIcon name="description" :size="14" />
          <span class="graph__context-title">
            {{ t("graph.aroundPage", { title: rootPage.title }) }}
          </span>
        </button>
      </UiTooltip> -->

      <UiSwitch v-model="localChoice" :label="t('graph.local')" />

      <UiPopover class="graph__filters" align="start">
        <template #trigger>
          <UiButton variant="plain" size="small">
            <MsIcon name="filter_list" :size="18" />
            {{ t("graph.filters") }}
            <span v-if="activeFilters" class="graph__filters-count">{{ activeFilters }}</span>
          </UiButton>
        </template>

        <div class="graph__filter">
          <span class="graph__filter-label">{{ t("graph.depth") }}</span>
          <UiSelect
            v-model="depthChoice"
            class="graph__filter-control"
            :options="depthOptions"
            :label="t('graph.depth')"
            :disabled="!settings.local"
          />
        </div>

        <div class="graph__filter">
          <span class="graph__filter-label">{{ t("graph.category") }}</span>
          <UiSelect
            v-model="categoryChoice"
            class="graph__filter-control"
            :options="categoryOptions"
            :label="t('graph.category')"
          />
        </div>

        <div v-if="tags.length > 0" class="graph__filter">
          <span class="graph__filter-label">{{ t("graph.tag") }}</span>
          <UiSelect
            v-model="tagChoice"
            class="graph__filter-control"
            :options="tagOptions"
            :label="t('graph.tag')"
          />
        </div>

        <div class="graph__filter">
          <span class="graph__filter-label">{{ t("graph.labels") }}</span>
          <UiSelect
            v-model="labelsChoice"
            class="graph__filter-control"
            :options="labelOptions"
            :label="t('graph.labels')"
          />
        </div>

        <div class="graph__filter">
          <UiSwitch v-model="orphansChoice" :label="t('graph.orphans')" />
        </div>
      </UiPopover>
    </div>

    <div class="graph__body">
      <GraphCanvas
        v-if="graph.nodes.length > 0"
        ref="graphCanvas"
        :data="graph"
        :palette="palette"
        :labels="settings.labels"
        :match-ids="matchIds"
        :selected-id="selectedId"
        @open="emit('openPage', $event)"
        @select="selectedId = $event"
      />

      <p v-else-if="matchIds" class="graph__empty">{{ t("graph.noMatches") }}</p>
      <p v-else class="graph__empty">{{ t("graph.empty") }}</p>
    </div>

    <footer class="graph__hint">{{ t("graph.hint") }}</footer>
  </div>
</template>

<style>
.graph {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-surface);
}

.graph__header {
  display: flex;
  align-items: center;
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.graph__icon,
.graph__search-icon {
  color: var(--color-text-secondary);
}

.graph__title {
  font-size: var(--text-2xl);
  font-weight: 600;
  margin-left: var(--space-2);
  white-space: nowrap;
}

.graph__stats,
.graph__resolving {
  min-width: 0;
  overflow: hidden;
  margin-left: var(--space-4);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph__resolving {
  opacity: 0.8;
}

.graph__context {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: 18rem;
  padding: var(--space-0-5) var(--space-1-5);
  font: inherit;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.graph__context:hover,
.graph__context:focus-visible {
  color: var(--color-text);
  border-color: var(--color-accent);
}

.graph__context-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph__actions {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-0-5);
  margin-left: auto;
}

/* Phones get one secondary line: the progress text replaces the counts
   instead of wrapping both into a three-line header. */
@media (max-width: 768px) {
  .graph__header--resolving .graph__stats {
    display: none;
  }
}

.graph__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-height: var(--pane-header-height);
  padding: var(--space-1-5) var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.graph__search {
  flex: 1 1 160px;
  max-width: 320px;
}

/* Filters live in a popover: each select gets a visible label, and the
   toolbar stays one line on narrow panes. */
.graph__filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 16rem;
  padding: var(--space-2-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 30px rgb(0 0 0 / 0.12);
  z-index: 65;
  animation: ui-overlay-fade-in 100ms ease-out;
}

.graph__filters[data-state="closed"] {
  animation: ui-overlay-fade-out 80ms ease-in;
}

.graph__filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.graph__filter-label {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.graph__filter-control {
  min-width: 9rem;
}

.graph__filters-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.05rem;
  height: 1.05rem;
  padding: 0 var(--space-1);
  font-size: var(--text-xs);
  line-height: 1;
  color: var(--color-surface);
  background: var(--color-accent);
  border-radius: var(--radius-full);
}

.graph__body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.graph__empty {
  display: grid;
  place-content: center;
  height: 100%;
  margin: 0;
  color: var(--color-text-secondary);
}

.graph__hint {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  border-top: 1px solid var(--color-border);
}
</style>
