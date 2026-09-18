<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { useTypst } from "~/composables/typst";
import { saveExport, type ExportOptions } from "~/lib/exportPage";
import { buildWorkspaceExport, type WorkspaceExportOptions } from "~/lib/exportWorkspace";

const props = defineProps<{ store: WorkspaceStore }>();

const open = ref(false);
const busy = ref(false);
const error = ref("");
const query = ref("");
const dailyOnly = ref(false);
const selected = ref(new Set<string>());

const DEFAULTS: WorkspaceExportOptions = {
  html: true,
  pdf: true,
  svg: false,
  svgMerged: true,
  project: true,
  fonts: true,
  theme: "light",
  pageSize: "a4",
  separate: true,
  combined: false,
};

const stored = useLocalStorage<WorkspaceExportOptions>("typbase:workspaceExportOptions", DEFAULTS);
const options = reactive<WorkspaceExportOptions>({ ...DEFAULTS, ...stored.value });
watch(options, () => {
  stored.value = { ...options };
});

const pages = computed(() => props.store.listPages());

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();

  return pages.value.filter((page) => {
    if (dailyOnly.value && !page.path.startsWith("daily/")) return false;
    if (!needle) return true;

    return page.title.toLowerCase().includes(needle) || page.path.toLowerCase().includes(needle);
  });
});

const allSelected = computed(() => {
  const visible = filtered.value;
  return visible.length > 0 && visible.every((page) => selected.value.has(page.id));
});

function setAll(value: boolean): void {
  const next = new Set(selected.value);
  for (const page of filtered.value) {
    if (value) next.add(page.id);
    else next.delete(page.id);
  }
  selected.value = next;
}

function setSelected(id: string, value: boolean): void {
  const next = new Set(selected.value);
  if (value) next.add(id);
  else next.delete(id);
  selected.value = next;
}

// Opening resets to "all pages selected": the common case for a workspace
// export, and the dialog makes narrowing down easy.
watch(open, (isOpen) => {
  if (!isOpen) return;

  selected.value = new Set(pages.value.map((page) => page.id));
  query.value = "";
  dailyOnly.value = false;
  error.value = "";
});

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
}

async function run(): Promise<void> {
  if (busy.value || !selected.value.size) return;

  busy.value = true;
  error.value = "";
  try {
    const typstState = await useTypst();
    const { name, files } = await buildWorkspaceExport(
      props.store,
      [...selected.value],
      { ...options },
      typstState,
    );
    await saveExport(name, files);
    open.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    class="workspace-export-dialog"
    :title="$t('exportWorkspace.title')"
    :description="$t('exportWorkspace.description')"
  >
    <template #trigger>
      <slot />
    </template>

    <div class="workspace-export">
      <div class="workspace-export__toolbar">
        <input
          v-model="query"
          class="workspace-export__search"
          type="search"
          :placeholder="$t('exportWorkspace.search')"
          :aria-label="$t('exportWorkspace.search')"
        />
        <button type="button" class="button button--small" @click="setAll(!allSelected)">
          {{ allSelected ? $t("exportWorkspace.none") : $t("exportWorkspace.all") }}
        </button>
      </div>

      <div class="workspace-export__filters">
        <UiCheckbox v-model="dailyOnly" :label="$t('exportWorkspace.daily')" />
        <span class="workspace-export__count">
          {{ $t("exportWorkspace.selectedCount", { count: selected.size }) }}
        </span>
      </div>

      <p v-if="!filtered.length" class="workspace-export__hint">
        {{ $t("exportWorkspace.empty") }}
      </p>
      <ul v-else class="workspace-export__pages">
        <li v-for="page in filtered" :key="page.id">
          <UiCheckbox
            :model-value="selected.has(page.id)"
            @update:model-value="(value) => setSelected(page.id, value)"
          >
            <span class="workspace-export__page-title">{{ page.title }}</span>
            <span class="workspace-export__page-meta">
              {{ page.path }} · {{ formatDate(page.updatedAt) }}
            </span>
          </UiCheckbox>
        </li>
      </ul>

      <div class="workspace-export__formats">
        <UiCheckbox v-model="options.html" :label="$t('exportPage.html')" />
        <UiCheckbox v-model="options.pdf" :label="$t('exportPage.pdf')" />
        <UiCheckbox v-model="options.svg" :label="$t('exportPage.svg')" />
        <UiCheckbox v-model="options.project" :label="$t('exportPage.project')" />
        <UiCheckbox
          v-model="options.fonts"
          :label="$t('exportPage.fonts')"
          :disabled="!options.project"
        />
      </div>

      <div class="workspace-export__formats">
        <UiCheckbox v-model="options.separate" :label="$t('exportWorkspace.separate')" />
        <UiCheckbox v-model="options.combined" :label="$t('exportWorkspace.combined')" />
      </div>

      <div class="workspace-export__options">
        <label class="workspace-export__field">
          {{ $t("exportPage.theme") }}
          <select v-model="options.theme">
            <option value="light">{{ $t("exportPage.themeLight") }}</option>
            <option value="workspace">{{ $t("exportPage.themeWorkspace") }}</option>
          </select>
        </label>
        <label class="workspace-export__field">
          {{ $t("exportPage.pageSize") }}
          <select v-model="options.pageSize">
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
          </select>
        </label>
      </div>

      <p class="workspace-export__hint">{{ $t("exportWorkspace.hint") }}</p>
      <p v-if="error" class="workspace-export__error" role="alert">{{ error }}</p>

      <div class="workspace-export__actions">
        <button
          type="button"
          class="button button--primary"
          :disabled="busy || !selected.size"
          @click="run"
        >
          {{ busy ? $t("exportPage.working") : $t("exportPage.export") }}
        </button>
      </div>
    </div>
  </UiDialog>
</template>

<style scoped>
.workspace-export {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.workspace-export__toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.workspace-export__search {
  flex: 1;
  min-width: 0;
  padding: 0.4rem 0.55rem;
  font: inherit;
  font-size: 0.9rem;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.4rem;
}

.workspace-export__search:focus-visible {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.workspace-export__filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.workspace-export__count {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.workspace-export__pages {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  max-height: min(40vh, 16rem);
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
}

.workspace-export__pages :deep(.ui-checkbox) {
  width: 100%;
  align-items: flex-start;
  padding: 0.3rem 0.4rem;
  border-radius: 0.35rem;
}

.workspace-export__pages :deep(.ui-checkbox:hover) {
  background: var(--color-surface-2);
}

.workspace-export__page-title {
  display: block;
}

.workspace-export__page-meta {
  display: block;
  font-size: 0.72rem;
  color: var(--color-text-secondary);
}

.workspace-export__formats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}

.workspace-export__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}

.workspace-export__field {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.workspace-export__field select {
  padding: 0.25rem 0.4rem;
  font: inherit;
  font-size: 0.8rem;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.4rem;
}

.workspace-export__field select:focus-visible {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.workspace-export__hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.workspace-export__error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-danger);
}

.workspace-export__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
