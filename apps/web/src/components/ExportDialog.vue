<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { TypstState } from "@typbase/wasm";

import { buildExport, saveExport, type ExportOptions } from "~/lib/exportPage";

const props = defineProps<{
  pageId: string;
  store: WorkspaceStore;
  /** Live engine, used for the stdlib source in the project export. */
  typstState?: TypstState;
  /** Flushes pending editor text so the export sees the latest source. */
  beforeExport?: () => Promise<void> | void;
}>();

const open = ref(false);
const busy = ref(false);
const error = ref("");

const DEFAULTS: ExportOptions = {
  html: true,
  pdf: true,
  svg: false,
  svgMerged: true,
  project: true,
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
        v-model="options.fonts"
        :label="$t('exportPage.fonts')"
        :disabled="!options.project"
      />

      <div class="export__options">
        <label class="export__field">
          {{ $t("exportPage.theme") }}
          <select v-model="options.theme">
            <option value="light">{{ $t("exportPage.themeLight") }}</option>
            <option value="workspace">{{ $t("exportPage.themeWorkspace") }}</option>
          </select>
        </label>
        <label class="export__field">
          {{ $t("exportPage.pageSize") }}
          <select v-model="options.pageSize">
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
          </select>
        </label>
      </div>

      <p class="export__hint">{{ $t("exportPage.dialogHint") }}</p>
      <p v-if="error" class="export__error" role="alert">{{ error }}</p>

      <div class="export__actions">
        <button
          type="button"
          class="button button--primary"
          :disabled="busy || !hasArtifacts"
          @click="run"
        >
          {{ busy ? $t("exportPage.working") : $t("exportPage.export") }}
        </button>
      </div>
    </div>
  </UiDialog>
</template>

<style scoped>
.export {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.export__formats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

.export__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}

.export__field {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.export__field select {
  padding: 0.25rem 0.4rem;
  font: inherit;
  font-size: 0.8rem;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.4rem;
}

.export__field select:focus-visible {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.export__hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.export__error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-danger);
}

.export__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.25rem;
}
</style>
