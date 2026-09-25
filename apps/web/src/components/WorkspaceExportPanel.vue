<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import type { SelectOption } from "~/components/ui/Select.vue";

import { useTypst } from "~/composables/typst";
import { engineAvailable } from "~/lib/engineHealth";
import { saveExport, type ExportOptions } from "~/lib/exportPage";
import { buildWorkspaceExport, type WorkspaceExportOptions } from "~/lib/exportWorkspace";

const props = defineProps<{ store: WorkspaceStore }>();

const { t } = useI18n();

const busy = ref(false);
const error = ref("");
const query = ref("");
const dailyOnly = ref(false);
const selected = ref(new Set<string>());

const themeOptions = computed<SelectOption<ExportOptions["theme"]>[]>(() => [
  { value: "light", label: t("exportPage.themeLight") },
  { value: "workspace", label: t("exportPage.themeWorkspace") },
]);

const pageSizeOptions: SelectOption<ExportOptions["pageSize"]>[] = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "Letter" },
];

const DEFAULTS: WorkspaceExportOptions = {
  html: true,
  pdf: true,
  svg: false,
  svgMerged: true,
  project: true,
  stripMarkers: false,
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

// The settings dialog mounts its panels on open, so this is the old "select
// everything when export opens" reset, minus the dialog.
onMounted(() => {
  selected.value = new Set(pages.value.map((page) => page.id));
});

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
}

async function run(): Promise<void> {
  if (busy.value || !selected.value.size) return;

  busy.value = true;
  error.value = "";
  try {
    if (!engineAvailable()) {
      // Project exports read the stdlib out of the engine. Rendering would
      // work in the worker, but stop instead of writing a bundle without it.
      error.value = t("engine.failedBody");

      return;
    }

    const typstState = await useTypst();
    const { name, files } = await buildWorkspaceExport(
      props.store,
      [...selected.value],
      { ...options },
      typstState,
    );
    await saveExport(name, files);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="workspace-export">
    <p class="workspace-export__hint">{{ $t("exportWorkspace.description") }}</p>

    <div class="workspace-export__toolbar">
      <UiTextField
        v-model="query"
        class="workspace-export__search"
        type="search"
        :placeholder="$t('exportWorkspace.search')"
        :aria-label="$t('exportWorkspace.search')"
      />
      <UiButton size="small" @click="setAll(!allSelected)">
        {{ allSelected ? $t("exportWorkspace.none") : $t("exportWorkspace.all") }}
      </UiButton>
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
        v-model="options.stripMarkers"
        :label="$t('exportPage.stripMarkers')"
        :disabled="!options.project"
      />
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
        <UiSelect
          v-model="options.theme"
          :options="themeOptions"
          :label="$t('exportPage.theme')"
          size="small"
        />
      </label>
      <label class="workspace-export__field">
        {{ $t("exportPage.pageSize") }}
        <UiSelect
          v-model="options.pageSize"
          :options="pageSizeOptions"
          :label="$t('exportPage.pageSize')"
          size="small"
        />
      </label>
    </div>

    <p class="workspace-export__hint">{{ $t("exportWorkspace.hint") }}</p>
    <p v-if="error" class="workspace-export__error" role="alert">{{ error }}</p>

    <div class="workspace-export__actions">
      <UiButton variant="primary" :disabled="busy || !selected.size" @click="run">
        {{ busy ? $t("exportPage.working") : $t("exportPage.export") }}
      </UiButton>
    </div>
  </div>
</template>

<style>
.workspace-export {
  display: flex;
  flex-direction: column;
  gap: var(--space-2-5);
}

.workspace-export__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.workspace-export__search {
  flex: 1;
  min-width: 0;
}

.workspace-export__filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.workspace-export__count {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.workspace-export__pages {
  list-style: none;
  margin: 0;
  padding: var(--space-1);
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  max-height: min(40vh, 16rem);
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.workspace-export__pages .ui-checkbox {
  width: 100%;
  align-items: flex-start;
  padding: var(--space-1) var(--space-1-5);
  border-radius: var(--radius-sm);
}

.workspace-export__pages .ui-checkbox:hover {
  background: var(--color-surface-2);
}

.workspace-export__page-title {
  display: block;
}

.workspace-export__page-meta {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.workspace-export__formats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
}

.workspace-export__options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
}

.workspace-export__field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.workspace-export__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.workspace-export__error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}

.workspace-export__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
