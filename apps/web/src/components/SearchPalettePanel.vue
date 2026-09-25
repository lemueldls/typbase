<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { DEFAULT_SETTINGS } from "@typbase/typing";

import type { SearchQueryMode, SearchResultItem } from "~/lib/search";

import { searchQueryMode } from "~/lib/search";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open", payload: { pageId: string; from?: number; to?: number }): void;
}>();

const { t } = useI18n();
const { ensure, search, status } = useSearch();

/** Touch devices lose the keyboard hints; the shell turns into a drawer. */
const isTouch = useMediaQuery("(hover: none) and (pointer: coarse)");

/** One recent page; hits come from the search index instead. */
interface RecentItem {
  pageId: string;
  path: string;
  title: string;
}

interface HitEntry {
  hit: SearchResultItem;
  /** Position in the flat hit order the arrow keys walk. */
  index: number;
}

interface HitGroup {
  pageId: string;
  path: string;
  title: string;
  hits: HitEntry[];
}

const query = ref("");
const results = ref<SearchResultItem[]>([]);
const recent = ref<RecentItem[]>([]);
const active = ref(0);
const searching = ref(false);
const panel = ref<"results" | "settings">("results");

/** Hits grouped by page, ordered by each page's best hit. */
const groups = computed<HitGroup[]>(() => {
  const map = new Map<string, HitGroup>();
  let index = 0;
  for (const hit of results.value) {
    let group = map.get(hit.docId);
    if (!group) {
      group = { pageId: hit.docId, path: hit.path, title: hit.title, hits: [] };
      map.set(hit.docId, group);
    }
    group.hits.push({ hit, index: index++ });
  }

  return [...map.values()];
});

/** Flat hit order, matching the `index` on each entry. */
const flatHits = computed(() =>
  groups.value.flatMap((group) => group.hits.map((entry) => entry.hit)),
);

const settings = computed(() => props.store.getSearchSettings());
const semantic = computed(() => status.value?.semantic ?? settings.value.semantic);
const vecReady = computed(() => status.value?.vecReady ?? false);

const modeKey = computed(() => {
  const keys: Record<SearchQueryMode, string> = {
    text: "palette.modeText",
    hybrid: "palette.modeHybrid",
    loading: "palette.modeLoading",
    unavailable: "palette.modeUnavailable",
  };

  return keys[searchQueryMode(status.value)];
});

/** The chip shows a short label; the tooltip keeps the full mode sentence. */
const chipLabel = computed(() => {
  const s = status.value;
  if (s?.model === "downloading") {
    return s.modelProgress == null
      ? t("palette.chipLoadingUnknown")
      : t("palette.chipLoading", { progress: Math.round(s.modelProgress) });
  }

  return semantic.value ? t("palette.chipSemantic") : t("palette.chipText");
});

const chipTooltip = computed(() =>
  !vecReady.value && !semantic.value ? t("palette.noVec") : t(modeKey.value),
);

const modelStatus = computed(() => {
  const s = status.value;
  if (!s) return "";
  if (s.model === "downloading") {
    return s.modelProgress == null
      ? t("palette.modelDownloadingUnknown")
      : t("palette.modelDownloading", { progress: Math.round(s.modelProgress) });
  }
  if (s.model === "ready") return t("palette.modelReady");
  if (s.model === "error") return t("palette.modelError", { error: s.error ?? "" });

  return t("palette.modelIdle");
});

const indexStats = computed(() => {
  const s = status.value;
  if (!s) return t("palette.indexStarting");

  return t("palette.indexStats", {
    docs: s.docs,
    blocks: s.blocks,
    mode: s.mode === "opfs" ? t("palette.storagePersistent") : t("palette.storageMemory"),
  });
});

/** Thin bar while the first index build is still filling in. */
const indexProgress = computed(() => {
  const s = status.value;
  if (!s || s.indexError) return null;
  const total = props.store.listPages().length;
  if (total === 0 || (s.ready && s.docs >= total)) return null;
  const docs = Math.min(s.docs, total);

  return { docs, total, percent: Math.round((docs / total) * 100) };
});

const modelDraft = ref(settings.value.embeddingModel);

/** Block kinds worth naming; "other" is the default paragraph. */
function kindKey(kind: string): string | null {
  const keys: Record<string, string> = {
    heading: "palette.kindHeading",
    list: "palette.kindList",
    raw: "palette.kindRaw",
    math: "palette.kindMath",
  };

  return keys[kind] ?? null;
}

const input = useTemplateRef("input");
const resultsEl = useTemplateRef("resultsEl");

const runSearch = useDebounceFn(async (value: string) => {
  const s = search.value;
  if (s) {
    searching.value = true;
    try {
      results.value = await s.query(value);
      active.value = 0;
    } finally {
      searching.value = false;
    }
  } else {
    results.value = [];
    searching.value = false;
  }
}, 220);

watch(query, (value) => {
  active.value = 0;
  if (!value.trim()) {
    results.value = [];
    return;
  }

  void runSearch(value);
});

// The index worker queues queries behind sqlite init, so a search that lands
// before the index is ready returns nothing. Run it again once ready lands,
// and once per index batch while the first build is still filling in.
watch(
  () => [status.value?.ready, status.value?.blocks] as const,
  ([ready]) => {
    if (ready && query.value.trim()) void runSearch(query.value);
  },
);

// Arrow keys move past the visible area otherwise.
watch(active, () => {
  void nextTick(() => {
    resultsEl.value
      ?.querySelector(`[data-hit="${active.value}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });
});

onMounted(() => {
  input.value?.focus();
  // The settings panel has no focused input, so listen at the window instead
  // of relying on keydown bubbling through the panel root.
  window.addEventListener("keydown", onKeydown);

  recent.value = props.store
    .listPages()
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
    .map((page) => ({ pageId: page.id, path: page.path, title: page.title }));
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});

function onKeydown(event: KeyboardEvent) {
  if (panel.value === "settings") {
    if (event.key === "Escape") {
      event.preventDefault();
      void showResults();
    }

    return;
  }

  const list: Array<SearchResultItem | RecentItem> = query.value.trim()
    ? flatHits.value
    : recent.value;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    active.value = Math.min(list.length - 1, active.value + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    active.value = Math.max(0, active.value - 1);
  } else if (event.key === "Enter") {
    const item = list[active.value];
    if (item) openEntry(item);
  } else if (event.key === "Escape") {
    emit("close");
  }
}

function openEntry(item: SearchResultItem | RecentItem) {
  if ("docId" in item) {
    emit("open", {
      pageId: item.docId,
      from: item.rawRange?.from,
      to: item.rawRange?.to,
    });
  } else {
    emit("open", { pageId: item.pageId });
  }
}

function showSettings() {
  panel.value = "settings";
}

async function showResults() {
  panel.value = "results";
  await nextTick();
  input.value?.focus();
}

async function toggleSemantic(enabled: boolean) {
  if (enabled === semantic.value) return;
  if (enabled && !vecReady.value) return;

  props.store.updateSettings({
    search: { ...props.store.getSearchSettings(), semantic: enabled },
  });
  if (enabled) {
    const manager = search.value ?? (await ensure(props.store));
    await manager.reembedAll();
  }
}

async function applyModel() {
  const value = modelDraft.value.trim() || DEFAULT_SETTINGS.search.embeddingModel;
  modelDraft.value = value;
  if (value === settings.value.embeddingModel) return;

  props.store.updateSettings({ search: { ...settings.value, embeddingModel: value } });
  if (semantic.value) {
    const manager = search.value ?? (await ensure(props.store));
    await manager.reembedAll();
  }
}

async function resetModel() {
  modelDraft.value = DEFAULT_SETTINGS.search.embeddingModel;
  await applyModel();
}

async function rebuildIndex() {
  await (search.value ?? (await ensure(props.store))).rebuild();
}
</script>

<template>
  <div class="search-palette-panel">
    <template v-if="panel === 'results'">
      <UiTextField
        ref="input"
        v-model="query"
        size="large"
        :placeholder="$t('palette.placeholder')"
        :aria-label="$t('palette.label')"
        role="combobox"
        aria-expanded="true"
        aria-controls="search-results"
      >
        <template #leading>
          <MsIcon name="search" :size="20" class="search-palette-panel__icon" />
        </template>
        <template #trailing>
          <MsIcon
            v-if="searching"
            name="progress_activity"
            :size="20"
            class="search-palette-panel__spinner"
          />
        </template>
      </UiTextField>
      <span v-if="searching" class="visually-hidden" role="status">
        {{ $t("palette.searching") }}
      </span>

      <UiProgress
        v-if="indexProgress"
        class="search-palette-panel__progress"
        :value="indexProgress.percent"
      />

      <div class="search-palette-panel__body">
        <div
          v-if="query.trim() && groups.length"
          id="search-results"
          ref="resultsEl"
          role="listbox"
        >
          <section v-for="group in groups" :key="group.pageId" class="search-palette-panel__group">
            <header class="search-palette-panel__page">
              <span class="search-palette-panel__page-title">{{ group.title || group.path }}</span>
              <span class="search-palette-panel__page-path">{{ group.path }}</span>
            </header>
            <ul class="search-palette-panel__hits">
              <li
                v-for="entry in group.hits"
                :key="`${group.pageId}:${entry.index}`"
                role="option"
                :data-hit="entry.index"
                :aria-selected="entry.index === active"
                class="search-palette-panel__result"
                :class="{ 'search-palette-panel__result--active': entry.index === active }"
                @mousemove="active = entry.index"
                @click="openEntry(entry.hit)"
              >
                <span v-if="kindKey(entry.hit.kind)" class="search-palette-panel__kind">
                  {{ $t(kindKey(entry.hit.kind)!) }}
                </span>
                <div class="search-palette-panel__snippet">
                  <template
                    v-for="(segment, segmentIndex) in entry.hit.snippet"
                    :key="segmentIndex"
                  >
                    <mark v-if="segment.match" class="search-palette-panel__match">
                      {{ segment.text }}
                    </mark>
                    <span v-else>{{ segment.text }}</span>
                  </template>
                </div>
              </li>
            </ul>
          </section>
        </div>

        <template v-else-if="!query.trim() && recent.length">
          <p class="search-palette-panel__section">{{ $t("palette.recent") }}</p>
          <ul class="search-palette-panel__results" role="listbox">
            <li
              v-for="(item, index) in recent"
              :key="item.pageId"
              role="option"
              :aria-selected="index === active"
              class="search-palette-panel__result"
              :class="{ 'search-palette-panel__result--active': index === active }"
              @mousemove="active = index"
              @click="openEntry(item)"
            >
              <div class="search-palette-panel__title">
                <span class="search-palette-panel__name">{{ item.title || item.path }}</span>
              </div>
              <div class="search-palette-panel__path">{{ item.path }}</div>
            </li>
          </ul>
        </template>

        <p
          v-else-if="query.trim() && status?.indexError"
          class="search-palette-panel__hint search-palette-panel__hint--error"
        >
          {{ $t("palette.indexError", { error: status.indexError }) }}
        </p>
        <p v-else-if="query.trim() && !status?.ready" class="search-palette-panel__hint">
          {{
            indexProgress ? $t("palette.indexingProgress", indexProgress) : $t("palette.indexing")
          }}
        </p>
        <p v-else-if="searching" class="search-palette-panel__hint">
          {{ $t("palette.searching") }}
        </p>
        <p v-else-if="query.trim()" class="search-palette-panel__hint">
          {{ $t("palette.noMatches") }}
        </p>
        <p v-else class="search-palette-panel__hint">{{ $t("palette.prompt") }}</p>
      </div>

      <footer class="search-palette-panel__footer">
        <span v-if="!isTouch" class="search-palette-panel__keys">
          {{ $t("palette.hintKeys") }}
        </span>
        <span class="search-palette-panel__actions">
          <!-- <UiTooltip :text="chipTooltip" side="top">
            <button
              type="button"
              class="button button--ghost search-palette-panel__mode"
              :class="{
                'search-palette-panel__mode--on': semantic,
                'search-palette-panel__mode--error': status?.model === 'error',
              }"
              :aria-disabled="!vecReady && !semantic"
              @click="toggleSemantic(!semantic)"
            >
              <MsIcon
                :name="status?.model === 'downloading' ? 'progress_activity' : 'stars'"
                :size="16"
                :class="{ 'search-palette-panel__spinner': status?.model === 'downloading' }"
              />
              {{ chipLabel }}
            </button>
          </UiTooltip> -->
          <UiIconButton
            icon="tune"
            :label="$t('palette.settings')"
            variant="ghost"
            :size="20"
            @click="showSettings"
          />
          <!-- <UiIconButton
            icon="close"
            :label="$t('palette.close')"
            variant="ghost"
            :size="20"
            @click="emit('close')"
          /> -->
        </span>
      </footer>
    </template>

    <template v-else>
      <header class="search-palette-panel__header">
        <UiIconButton
          icon="arrow_back"
          :label="$t('palette.back')"
          variant="ghost"
          :size="20"
          @click="showResults"
        />
        <h2 class="search-palette-panel__heading">{{ $t("palette.settings") }}</h2>
      </header>

      <div class="search-palette-panel__body search-palette-panel__settings">
        <UiSwitch
          :model-value="semantic"
          :label="$t('palette.semantic')"
          :disabled="!vecReady && !semantic"
          @update:model-value="toggleSemantic"
        />
        <p class="search-palette-panel__hint">{{ $t("palette.semanticHint") }}</p>
        <p v-if="!vecReady" class="search-palette-panel__hint search-palette-panel__hint--error">
          {{ $t("palette.noVec") }}
        </p>
        <p v-else-if="semantic" class="search-palette-panel__hint">{{ modelStatus }}</p>
        <UiProgress
          v-if="semantic && status?.model === 'downloading' && status.modelProgress != null"
          class="search-palette-panel__progress search-palette-panel__progress--inline"
          :value="status.modelProgress"
        />

        <label class="search-palette-panel__field">
          <span class="search-palette-panel__field-label">{{ $t("palette.model") }}</span>
          <UiTextField v-model="modelDraft" @change="applyModel" />
        </label>
        <p class="search-palette-panel__hint">{{ $t("palette.modelHint") }}</p>
        <div class="search-palette-panel__buttons">
          <UiButton size="small" variant="ghost" @click="resetModel">
            {{ $t("palette.modelReset") }}
          </UiButton>
        </div>

        <div class="search-palette-panel__divider" />

        <p class="search-palette-panel__hint">{{ indexStats }}</p>
        <p
          v-if="status?.indexError"
          class="search-palette-panel__hint search-palette-panel__hint--error"
        >
          {{ $t("palette.indexError", { error: status.indexError }) }}
        </p>
        <div class="search-palette-panel__buttons">
          <UiButton size="small" @click="rebuildIndex">{{ $t("palette.rebuild") }}</UiButton>
          <span class="search-palette-panel__hint search-palette-panel__hint--inline">
            {{ $t("palette.rebuildHint") }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style>
.search-palette-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.search-palette-panel__icon {
  color: var(--color-text-secondary);
}

.search-palette-panel__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}

.search-palette-panel__spinner {
  color: var(--color-text-secondary);
  animation: search-palette-panel-spin 0.9s linear infinite;
}

@keyframes search-palette-panel-spin {
  to {
    transform: rotate(360deg);
  }
}

.search-palette-panel__progress {
  flex: none;
  margin: var(--space-1) var(--space-1-5) 0;
}

.search-palette-panel__progress--inline {
  margin: 0;
}

.search-palette-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.search-palette-panel__section {
  margin: var(--space-2-5) var(--space-2-5) var(--space-1);
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.search-palette-panel__hint {
  margin: var(--space-2-5);
  font-size: var(--text-md);
  color: var(--color-text-secondary);
}

.search-palette-panel__hint--inline {
  margin: 0;
  font-size: var(--text-xs);
}

.search-palette-panel__hint--error {
  color: var(--color-danger);
}

.search-palette-panel__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex: none;
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.search-palette-panel__keys {
  white-space: nowrap;
  padding-left: var(--space-3);
}

.search-palette-panel__mode {
  /* Same control height and rhythm as the footer's icon buttons. */
  height: var(--control-md);
  padding: 0 var(--space-2);
  color: var(--color-text-secondary);
}

.search-palette-panel__mode--on {
  color: var(--color-accent);
}

.search-palette-panel__mode--error {
  color: var(--color-danger);
}

.search-palette-panel__mode[aria-disabled="true"] {
  opacity: 0.55;
  cursor: default;
}

.search-palette-panel__mode[aria-disabled="true"]:hover {
  background: transparent;
}

.search-palette-panel__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
  padding: var(--space-1) var(--space-1-5);
}

.search-palette-panel__heading {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.search-palette-panel__settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  padding: var(--space-1) var(--space-2-5) var(--space-2);
}

.search-palette-panel__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.search-palette-panel__field-label {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.search-palette-panel__buttons {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.search-palette-panel__divider {
  height: 1px;
  margin: var(--space-1) 0;
  background: var(--color-border);
}

.search-palette-panel__results,
.search-palette-panel__hits {
  list-style: none;
  margin: 0;
  padding: 0;
}

.search-palette-panel__group {
  padding-top: var(--space-1);
}

.search-palette-panel__page {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-2-5) var(--space-0-5);
}

.search-palette-panel__page-title {
  flex: none;
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.search-palette-panel__page-path {
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-2xs);
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.8;
}

.search-palette-panel__result {
  padding: var(--space-2) var(--space-2-5);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.search-palette-panel__result--active {
  background: var(--color-accent-soft);
}

.search-palette-panel__title {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  font-size: var(--text-md);
  font-weight: 600;
}

.search-palette-panel__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-palette-panel__kind {
  display: inline-block;
  margin-bottom: 2px;
  padding: 0 4px;
  font-size: var(--text-2xs);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
}

.search-palette-panel__path {
  margin-top: var(--space-0-5);
  font-size: var(--text-2xs);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-palette-panel__snippet {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.search-palette-panel__match {
  padding: 0 1px;
  color: inherit;
  background: var(--color-warning-soft);
  border-radius: var(--radius-xs);
}

@media (max-width: 640px) {
  .search-palette-panel__result {
    padding: var(--space-3);
  }

  .search-palette-panel__footer {
    padding-bottom: var(--space-1);
  }
}
</style>
