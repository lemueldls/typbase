<script setup lang="ts">
import type { GraphSettings, ThemePaletteTokens } from "@typbase/typing";

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
const { workspace, dataRevision } = useWorkspace();
const { index, status, ensure } = useLinks();

const graphCanvas = useTemplateRef<{ fit: () => void }>("graphCanvas");
const query = ref("");
const selectedId = ref<string | null>(null);

const store = computed(() => workspace.value);
const settings = computed<GraphSettings>(() => {
  void dataRevision.value;

  return store.value?.getSettings().graph ?? DEFAULT_SETTINGS.graph;
});

const pages = computed(() => {
  void dataRevision.value;

  return store.value?.listPages() ?? [];
});

const categories = computed(() => {
  void dataRevision.value;

  return store.value?.listCategories() ?? [];
});

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

const palette = computed<ThemePaletteTokens>(() => {
  void dataRevision.value;
  const value = store.value;

  return value
    ? resolveTheme(value.getSettings()).palette
    : resolveTheme({ theme: "light" }).palette;
});

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
  const value = store.value;
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

onMounted(() => {
  if (store.value) ensure(store.value);
  testApi.graphStats = () => ({ nodes: graph.value.nodes.length, edges: graph.value.edges.length });
});

watch(store, (value) => {
  if (value) ensure(value);
});

onBeforeUnmount(() => {
  testApi.graphStats = null;
});
</script>

<template>
  <div class="graph">
    <header class="graph__header" data-tauri-drag-region="deep">
      <slot name="nav-toggle" />
      <MsIcon name="hub" :size="18" class="graph__icon" />
      <span class="graph__title">{{ t("graph.title") }}</span>
      <span class="graph__stats">
        {{ t("graph.stats", { pages: graph.nodes.length, links: graph.edges.length }) }}
      </span>
      <div class="graph__actions">
        <UiIconButton
          icon="fit_screen"
          :label="t('graph.fit')"
          variant="ghost"
          :size="18"
          @click="graphCanvas?.fit()"
        />
        <UiIconButton
          icon="close"
          :label="t('graph.close')"
          variant="ghost"
          :size="18"
          @click="emit('close')"
        />
      </div>
    </header>

    <div class="graph__toolbar">
      <UiTextField
        v-model="query"
        class="graph__search"
        size="small"
        :label="t('graph.search')"
        :placeholder="t('graph.search')"
      >
        <template #leading>
          <MsIcon name="search" :size="16" class="graph__search-icon" />
        </template>
      </UiTextField>

      <UiSwitch v-model="localChoice" :label="t('graph.local')" />
      <UiSelect
        v-if="settings.local"
        v-model="depthChoice"
        size="small"
        :options="depthOptions"
        :label="t('graph.depth')"
      />
      <UiSelect
        v-model="categoryChoice"
        size="small"
        :options="categoryOptions"
        :label="t('graph.category')"
      />
      <UiSelect
        v-if="tags.length > 0"
        v-model="tagChoice"
        size="small"
        :options="tagOptions"
        :label="t('graph.tag')"
      />
      <UiSelect
        v-model="labelsChoice"
        size="small"
        :options="labelOptions"
        :label="t('graph.labels')"
      />
      <UiSwitch v-model="orphansChoice" :label="t('graph.orphans')" />
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
  gap: var(--space-2);
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.graph__icon,
.graph__search-icon {
  color: var(--color-text-secondary);
}

.graph__title {
  font-size: var(--text-lg);
  font-weight: 600;
}

.graph__stats {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.graph__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
  margin-left: auto;
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
  width: min(220px, 100%);
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
