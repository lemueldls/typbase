<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { useWorkspaceValue } from "~/composables/loro";
import { pushToast } from "~/composables/toasts";
import { readSystemFontFamily, systemFontFaceCount, systemFontFamilies } from "~/composables/typst";
import { fontFamilyOf, mergeCustomFont } from "~/lib/customFonts";

const props = defineProps<{ store: WorkspaceStore }>();
const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();

const query = ref("");
const selected = ref(new Set<string>());
const busy = ref(false);
const error = ref("");

const customFonts = useWorkspaceValue(
  () => props.store,
  ["settings"],
  (store) => store.getSettings().customFonts,
);
const existing = computed(() => new Set(customFonts.value.map((font) => font.family)));
const families = computed(() => [...systemFontFamilies.value].sort((a, b) => a.localeCompare(b)));
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();

  return families.value.filter((family) => !needle || family.toLocaleLowerCase().includes(needle));
});

watch(open, (value) => {
  if (!value) return;

  query.value = "";
  selected.value = new Set();
  error.value = "";
});

function toggle(family: string, checked: boolean): void {
  const next = new Set(selected.value);
  if (checked) next.add(family);
  else next.delete(family);
  selected.value = next;
}

function faceLabel(family: string): string {
  const count = systemFontFaceCount(family);

  return existing.value.has(family)
    ? t("settings.systemFontsAlreadyAdded")
    : t("settings.fontFaceCount", { count }, count);
}

async function addSelected(): Promise<void> {
  const wanted = [...selected.value].filter((family) => !existing.value.has(family));
  if (!wanted.length || busy.value) return;

  busy.value = true;
  error.value = "";
  let fonts = props.store.getSettings().customFonts;
  let added = 0;
  const failed: string[] = [];

  try {
    for (const family of wanted) {
      const faces = await readSystemFontFamily(family);
      if (!faces.length) {
        failed.push(family);
        continue;
      }

      for (const bytes of faces) {
        const actualFamily = fontFamilyOf(bytes);
        if (!actualFamily) {
          failed.push(family);
          continue;
        }

        const blob = await props.store.putBlob(bytes);
        fonts = mergeCustomFont(fonts, actualFamily, blob.hash);
        added += 1;
      }
    }

    if (fonts !== props.store.getSettings().customFonts) {
      props.store.updateSettings({ customFonts: fonts });
    }
    if (added) {
      pushToast({ titleKey: "settings.systemFontsAdded", duration: 3500 });
    }
    if (failed.length) {
      error.value = t("settings.systemFontsAddFailed", { names: [...new Set(failed)].join(", ") });
    } else {
      open.value = false;
    }
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
    class="system-fonts-dialog"
    layer="top"
    :title="$t('settings.addSystemFonts')"
  >
    <p class="system-fonts__hint">{{ $t("settings.systemFontsDialogHint") }}</p>

    <UiTextField
      v-model="query"
      :label="$t('settings.systemFontsSearch')"
      :placeholder="$t('settings.systemFontsSearch')"
    >
      <template #leading><MsIcon name="search" :size="20" /></template>
    </UiTextField>

    <div v-if="filtered.length" class="system-fonts__list">
      <UiCheckbox
        v-for="family in filtered"
        :key="family"
        class="system-fonts__row"
        :model-value="selected.has(family)"
        :disabled="existing.has(family)"
        @update:model-value="toggle(family, $event)"
      >
        <span class="system-fonts__copy">
          <span class="system-fonts__name">{{ family }}</span>
          <span class="system-fonts__meta">{{ faceLabel(family) }}</span>
        </span>
      </UiCheckbox>
    </div>
    <p v-else class="system-fonts__empty">{{ $t("settings.systemFontsEmpty") }}</p>

    <p v-if="error" class="system-fonts__error" role="alert">{{ error }}</p>

    <div class="system-fonts__footer">
      <span class="system-fonts__count">
        {{ $t("settings.systemFontsSelected", { count: selected.size }) }}
      </span>
      <div class="system-fonts__actions">
        <UiButton variant="ghost" :disabled="busy" @click="open = false">
          {{ $t("common.cancel") }}
        </UiButton>
        <UiButton variant="primary" :disabled="busy || selected.size === 0" @click="addSelected">
          {{ busy ? $t("settings.loading") : $t("settings.systemFontsAddSelected") }}
        </UiButton>
      </div>
    </div>
  </UiDialog>
</template>

<style>
.system-fonts-dialog {
  width: min(38rem, calc(100vw - var(--space-8)));
}

.system-fonts__hint {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.system-fonts__list {
  max-height: min(50vh, 26rem);
  margin-top: var(--space-3);
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.system-fonts__row {
  display: flex;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border-radius: 0;
}

.system-fonts__row + .system-fonts__row {
  border-top: 1px solid var(--color-border);
}

.system-fonts__row:hover {
  background: var(--color-surface-2);
}

.system-fonts__copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.system-fonts__name {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.system-fonts__meta {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}

.system-fonts__empty {
  margin: var(--space-6) 0;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  text-align: center;
}

.system-fonts__error {
  margin: var(--space-3) 0 0;
  padding: var(--space-2);
  color: var(--color-danger);
  font-size: var(--text-sm);
  background: var(--color-danger-soft);
  border-radius: var(--radius-sm);
}

.system-fonts__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-4);
}

.system-fonts__count {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.system-fonts__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>
