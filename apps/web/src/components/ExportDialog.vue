<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { TypstState } from "@typbase/wasm";

import type { SelectOption } from "~/components/ui/Select.vue";

import { buildExport, saveExport, type ExportOptions } from "~/lib/exportPage";

const props = defineProps<{
  pageId: string;
  store: WorkspaceStore;
  /** Live engine, used for the stdlib source in the project export. */
  typstState?: TypstState;
  /** Flushes pending editor text so the export sees the latest source. */
  beforeExport?: () => Promise<void> | void;
}>();

const { t } = useI18n();

const open = ref(false);
const busy = ref(false);
const error = ref("");

const themeOptions = computed<SelectOption<ExportOptions["theme"]>[]>(() => [
  { value: "light", label: t("exportPage.themeLight") },
  { value: "workspace", label: t("exportPage.themeWorkspace") },
]);

const pageSizeOptions: SelectOption<ExportOptions["pageSize"]>[] = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "Letter" },
];

const DEFAULTS: ExportOptions = {
  html: true,
  pdf: true,
  svg: false,
  svgMerged: true,
  project: true,
  stripMarkers: false,
  fonts: true,
  theme: "light",
  pageSize: "a4",
};

const stored = useLocalStorage<ExportOptions>("typbase:exportOptions", DEFAULTS);
const options = reactive<ExportOptions>({ ...DEFAULTS, ...stored.value });
watch(options, () => {
  stored.value = { ...options };
});

const hasArtifacts = computed(() => options.html || options.pdf || options.svg || options.project);

async function run(): Promise<void> {
  if (busy.value || !hasArtifacts.value) return;

  busy.value = true;
  error.value = "";
  try {
    await props.beforeExport?.();
    const { base, files } = await buildExport(
      props.store,
      props.pageId,
      { ...options },
      props.typstState,
    );
    await saveExport(base, files);
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
    class="export-dialog"
    :title="$t('exportPage.title')"
    :description="$t('exportPage.description')"
  >
    <template #trigger>
      <slot />
    </template>

    <div class="export">
      <div class="export__formats">
        <UiCheckbox v-model="options.html" :label="$t('exportPage.html')" />
        <UiCheckbox v-model="options.pdf" :label="$t('exportPage.pdf')" />
        <UiCheckbox v-model="options.svg" :label="$t('exportPage.svg')" />
      </div>

      <UiCheckbox
        v-model="options.svgMerged"
        :label="$t('exportPage.svgMerged')"
        :disabled="!options.svg"
      />
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

      <div class="export__options">
        <label class="export__field">
          {{ $t("exportPage.theme") }}
          <UiSelect
            v-model="options.theme"
            :options="themeOptions"
            :label="$t('exportPage.theme')"
            size="small"
          />
        </label>
        <label class="export__field">
          {{ $t("exportPage.pageSize") }}
          <UiSelect
            v-model="options.pageSize"
            :options="pageSizeOptions"
            :label="$t('exportPage.pageSize')"
            size="small"
          />
        </label>
      </div>

      <p class="export__hint">{{ $t("exportPage.dialogHint") }}</p>
      <p v-if="error" class="export__error" role="alert">{{ error }}</p>

      <div class="export__actions">
        <UiButton variant="primary" :disabled="busy || !hasArtifacts" @click="run">
          {{ busy ? $t("exportPage.working") : $t("exportPage.export") }}
        </UiButton>
      </div>
    </div>
  </UiDialog>
</template>

<style scoped>
.export {
  display: flex;
  flex-direction: column;
  gap: var(--space-2-5);
}

.export__formats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.export__options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
}

.export__field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.export__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.export__error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}

.export__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-1);
}
</style>
