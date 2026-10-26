<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { FontProperties } from "unifont";

import { pushToast } from "~/composables/toasts";
import {
  installWebFontFamily,
  listWebFonts,
  resolveWebFont,
  webFontCategories,
  webFontProperties,
} from "~/lib/webFonts";

const props = defineProps<{
  store: WorkspaceStore;
  apiBase: string;
}>();

const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();

const families = ref<string[]>([]);
const loading = ref(false);
const loadError = ref("");
const query = ref("");
const selected = ref<string | null>(null);
const properties = ref<FontProperties & { provider?: string }>();
const previewReady = ref(false);
const previewError = ref("");
const adding = ref(false);
const addError = ref("");
let previewFace: FontFace | undefined;
let previewToken = 0;

type FontFilter = "all" | "text" | "code" | "math";

const ROW_HEIGHT = 36;
const OVERSCAN = 8;
const MATH_FONT = /math(?:\b|$)|xits|asana|neo euler|stix.*math/i;
const CODE_FONT =
  /mono|code|courier|consol|menlo|iosevka|jetbrains|fira|hack|inconsolata|cascadia|typewriter|terminal|fixed|anonymous pro|coding/i;
const listElement = useTemplateRef<HTMLElement>("webFontList");
const scrollTop = ref(0);
const viewport = ref(560);
const filter = ref<FontFilter>("all");
const fontCategories = ref(new Map<string, string>());
const filterOptions = computed<Array<{ value: FontFilter; label: string }>>(() => [
  { value: "all", label: t("settings.webFontsFilterAll") },
  { value: "text", label: t("settings.webFontsFilterText") },
  { value: "code", label: t("settings.webFontsFilterCode") },
  { value: "math", label: t("settings.webFontsFilterMath") },
]);

function isCodeFont(family: string): boolean {
  if (/symbol|icon/i.test(family)) return false;

  return /monospace/i.test(fontCategories.value.get(family) ?? "") || CODE_FONT.test(family);
}

function isMathFont(family: string): boolean {
  return MATH_FONT.test(family);
}

const matches = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();

  return families.value.filter((family) => {
    if (needle && !family.toLocaleLowerCase().includes(needle)) return false;
    if (filter.value === "math") return isMathFont(family);
    if (filter.value === "code") return isCodeFont(family);
    if (filter.value === "text") return !isMathFont(family) && !isCodeFont(family);

    return true;
  });
});
const rendered = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    matches.value.length,
    Math.ceil((scrollTop.value + viewport.value) / ROW_HEIGHT) + OVERSCAN,
  );

  return matches.value
    .slice(start, end)
    .map((family, offset) => ({ family, index: start + offset }));
});
const previewStyle = computed(() =>
  selected.value
    ? { fontFamily: `"${selected.value.replaceAll('"', '\\"')}", var(--font-sans)` }
    : {},
);

function onListScroll(event: Event): void {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
}

function resetList(): void {
  const element = listElement.value;
  if (element) {
    viewport.value = element.clientHeight || viewport.value;
    element.scrollTop = 0;
  }
  scrollTop.value = 0;
}

watch([open, loading, families, query, filter, fontCategories], () => void nextTick(resetList));

function compactList(values: string[] | undefined, limit = 4): string {
  const entries = values ?? [];
  if (!entries.length) return "";
  const shown = entries.slice(0, limit).join(", ");

  return entries.length > limit ? `${shown} +${entries.length - limit}` : shown;
}

function clearPreview(): void {
  if (previewFace) document.fonts.delete(previewFace);
  previewFace = undefined;
  previewReady.value = false;
}

watch(open, (value) => {
  if (!value) {
    previewToken += 1;
    clearPreview();
    return;
  }

  query.value = "";
  filter.value = "all";
  selected.value = null;
  properties.value = undefined;
  loadError.value = "";
  addError.value = "";
  clearPreview();
  if (!fontCategories.value.size) {
    void webFontCategories(props.apiBase)
      .then((map) => {
        fontCategories.value = map;
      })
      .catch(() => undefined);
  }
  if (families.value.length || loading.value) return;

  loading.value = true;
  void listWebFonts(props.apiBase)
    .then((names) => {
      families.value = names;
    })
    .catch((cause) => {
      loadError.value = cause instanceof Error ? cause.message : String(cause);
    })
    .finally(() => {
      loading.value = false;
    });
});

onBeforeUnmount(() => {
  previewToken += 1;
  clearPreview();
});

async function selectFamily(family: string): Promise<void> {
  const token = ++previewToken;
  selected.value = family;
  properties.value = undefined;
  addError.value = "";
  previewError.value = "";
  clearPreview();

  try {
    const info = await webFontProperties(props.apiBase, family);
    if (token !== previewToken) return;
    properties.value = info;

    const weights = (info?.weights ?? []).filter((weight) => !weight.includes(" "));
    const weight = weights.includes("400") ? "400" : (weights[0] ?? "400");
    const subset = info?.subsets?.includes("latin") ? "latin" : (info?.subsets?.[0] ?? "latin");
    const resolved = await resolveWebFont(props.apiBase, family, {
      weights: [weight],
      styles: ["normal"],
      subsets: [subset],
      formats: ["woff2", "ttf"],
    });
    if (token !== previewToken) return;

    const source = resolved?.fonts[0]?.src.find((entry) => "url" in entry);
    if (!source || !("url" in source)) {
      previewError.value = t("settings.webFontsPreviewUnavailable");
      return;
    }

    const face = new FontFace(family, `url("${source.url}")`);
    await face.load();
    if (token !== previewToken) return;
    document.fonts.add(face);
    previewFace = face;
    previewReady.value = true;
  } catch {
    if (token === previewToken) previewError.value = t("settings.webFontsPreviewUnavailable");
  }
}

async function addSelected(): Promise<void> {
  const family = selected.value;
  if (!family || adding.value) return;

  adding.value = true;
  addError.value = "";
  try {
    const result = await installWebFontFamily(props.store, props.apiBase, family);
    if (!result.added) {
      addError.value = result.unavailable
        ? t("settings.webFontsUnavailable")
        : t("settings.webFontsAddFailed");
      return;
    }

    pushToast({ titleKey: "settings.webFontsAdded", duration: 3500 });
    open.value = false;
  } catch (cause) {
    addError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    class="web-fonts-dialog"
    layer="top"
    :title="$t('settings.webFonts')"
  >
    <p class="web-fonts__hint">{{ $t("settings.webFontsDialogHint") }}</p>

    <UiTextField
      v-model="query"
      :label="$t('settings.webFontsSearch')"
      :placeholder="$t('settings.webFontsSearch')"
    >
      <template #leading><MsIcon name="search" :size="20" /></template>
    </UiTextField>

    <div class="web-fonts__filters" role="group" :aria-label="$t('settings.webFontsFilter')">
      <button
        v-for="option in filterOptions"
        :key="option.value"
        type="button"
        class="web-fonts__filter"
        :class="{ 'web-fonts__filter--active': filter === option.value }"
        :aria-pressed="filter === option.value"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <p v-if="loading" class="web-fonts__state">{{ $t("settings.webFontsLoading") }}</p>
    <p v-else-if="loadError" class="web-fonts__error" role="alert">{{ loadError }}</p>

    <div v-else class="web-fonts__layout">
      <div ref="webFontList" class="web-fonts__list" @scroll="onListScroll">
        <div
          v-if="matches.length"
          class="web-fonts__list-inner"
          :style="{ height: `${matches.length * ROW_HEIGHT}px` }"
        >
          <button
            v-for="row in rendered"
            :key="row.family"
            type="button"
            class="web-fonts__family"
            :class="{ 'web-fonts__family--active': selected === row.family }"
            :style="{ transform: `translateY(${row.index * ROW_HEIGHT}px)` }"
            @click="selectFamily(row.family)"
          >
            <UiTruncatedText :text="row.family" />
          </button>
        </div>
        <p v-else class="web-fonts__state">
          {{ $t("settings.webFontsEmpty") }}
        </p>
      </div>

      <div class="web-fonts__detail">
        <template v-if="selected">
          <p
            class="web-fonts__sample"
            :class="{ 'web-fonts__sample--ready': previewReady }"
            :style="previewStyle"
          >
            Aa Bb Cc 0123
          </p>
          <p v-if="previewError" class="web-fonts__muted">{{ previewError }}</p>

          <dl class="web-fonts__properties">
            <div>
              <dt>{{ $t("settings.webFontsWeights") }}</dt>
              <dd>{{ compactList(properties?.weights) || "400" }}</dd>
            </div>
            <div>
              <dt>{{ $t("settings.webFontsStyles") }}</dt>
              <dd>{{ compactList(properties?.styles, 2) || "normal" }}</dd>
            </div>
            <div v-if="properties?.subsets?.length">
              <dt>{{ $t("settings.webFontsSubsets") }}</dt>
              <dd>{{ compactList(properties.subsets.filter((subset) => subset !== "menu")) }}</dd>
            </div>
            <div v-if="properties?.provider">
              <dt>{{ $t("settings.webFontsProvider") }}</dt>
              <dd>{{ properties.provider }}</dd>
            </div>
          </dl>

          <p v-if="addError" class="web-fonts__error" role="alert">{{ addError }}</p>
          <div class="web-fonts__detail-footer">
            <p class="web-fonts__muted">{{ $t("settings.webFontsInstallHint") }}</p>
            <UiButton variant="primary" :disabled="adding" @click="addSelected">
              {{ adding ? $t("settings.webFontsAdding") : $t("settings.webFontsAdd") }}
            </UiButton>
          </div>
        </template>
        <p v-else class="web-fonts__state">{{ $t("settings.webFontsChoose") }}</p>
      </div>
    </div>
  </UiDialog>
</template>

<style>
.web-fonts-dialog {
  width: min(56rem, calc(100vw - var(--space-8)));
}

.web-fonts__hint {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.web-fonts__filters {
  display: flex;
  gap: var(--space-0-5);
  flex-wrap: wrap;
  margin-top: var(--space-2);
}

.web-fonts__filter {
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
}

.web-fonts__filter:hover {
  background: var(--color-surface-2);
}

.web-fonts__filter--active {
  color: var(--color-text);
  background: var(--color-surface);
  border-color: var(--color-border);
}

.web-fonts__layout {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: var(--space-3);
  height: min(52vh, 28rem);
  min-height: 16rem;
  margin-top: var(--space-3);
}

.web-fonts__list {
  position: relative;
  height: 100%;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.web-fonts__list-inner {
  position: relative;
}

.web-fonts__family {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  width: 100%;
  height: 36px;
  padding: 0 var(--space-2);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.web-fonts__family:hover {
  background: var(--color-surface-2);
}

.web-fonts__family--active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.web-fonts__detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding: var(--space-3);
  overflow: hidden;
  background: var(--color-surface-2);
  border-radius: var(--radius-md);
}

.web-fonts__detail > .web-fonts__state {
  margin: auto;
}

.web-fonts__sample {
  margin: 0;
  font-size: var(--text-3xl);
  line-height: var(--leading-tight);
  opacity: 0.35;
  transition: opacity var(--motion-fast);
}

.web-fonts__sample--ready {
  opacity: 1;
}

.web-fonts__properties {
  display: grid;
  flex: 1;
  align-content: start;
  gap: var(--space-1);
  min-height: 0;
  margin: 0;
  overflow-y: auto;
  font-size: var(--text-xs);
}

.web-fonts__properties div {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr);
  gap: var(--space-2);
}

.web-fonts__properties dt {
  color: var(--color-text-secondary);
}

.web-fonts__properties dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.web-fonts__state,
.web-fonts__muted {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.web-fonts__state {
  padding: var(--space-4) var(--space-2);
  text-align: center;
}

.web-fonts__error {
  margin: 0;
  padding: var(--space-2);
  color: var(--color-danger);
  font-size: var(--text-sm);
  background: var(--color-danger-soft);
  border-radius: var(--radius-sm);
}

.web-fonts__detail-footer {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: auto;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.web-fonts__detail-footer .button {
  flex: none;
}

@media (max-width: 48rem) {
  .web-fonts__layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 0.42fr) minmax(0, 0.58fr);
    height: min(68vh, 36rem);
    min-height: 0;
  }

  .web-fonts__detail-footer .button {
    width: 100%;
    justify-content: center;
  }
}
</style>
