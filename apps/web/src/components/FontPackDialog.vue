<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { WorkspaceSettings } from "@typbase/typing";

import { DEFAULT_SETTINGS } from "@typbase/typing";

import { pushToast } from "~/composables/toasts";
import { bumpRenderRevision, installFontPacks, useTypst } from "~/composables/typst";
import { unregisterFontFaceSource } from "~/lib/fontFaces";
import {
  deleteFontPack,
  downloadFontPack,
  FontPackError,
  installedFontPackIds,
  packsForScripts,
  type FontPack,
} from "~/lib/fontPacks";

const props = withDefaults(
  defineProps<{
    /** Missing scripts. Empty lists every pack, which is the Settings entry. */
    scripts?: string[];
    store?: WorkspaceStore;
  }>(),
  { scripts: () => [], store: undefined },
);

const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();

const installing = ref<string | null>(null);
const progress = ref(0);
const error = ref("");

const packs = computed(() => packsForScripts(props.scripts));
const installed = computed(() => new Set(installedFontPackIds.value));
const busy = computed(() => installing.value !== null);

watch(open, (value) => {
  if (!value) return;

  error.value = "";
  progress.value = 0;
});

/** Decimal units, so the number matches what a download meter reports. */
function packSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;

  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function packError(cause: unknown): string {
  if (cause instanceof FontPackError) {
    if (cause.code === "integrity") return t("fontPacks.integrityFailed");
    if (cause.code === "cache") return t("fontPacks.cacheFailed");
  }

  return t("fontPacks.downloadFailed");
}

async function install(pack: FontPack): Promise<void> {
  if (busy.value) return;

  installing.value = pack.id;
  progress.value = 0;
  error.value = "";

  try {
    await downloadFontPack(pack, (fraction) => {
      progress.value = fraction;
    });
    const state = await useTypst();
    await installFontPacks(state);
    pushToast({
      titleKey: "fontPacks.installedToast",
      params: { font: pack.family },
      duration: 3500,
    });
  } catch (cause) {
    error.value = packError(cause);
  } finally {
    installing.value = null;
  }
}

async function remove(pack: FontPack): Promise<void> {
  const store = props.store;
  if (store) {
    const settings = store.getSettings();
    const patch: Partial<WorkspaceSettings> = {};
    if (settings.font === pack.family) patch.font = DEFAULT_SETTINGS.font;
    if (settings.mathFont === pack.family) patch.mathFont = DEFAULT_SETTINGS.mathFont;
    if (settings.codeFont === pack.family) patch.codeFont = DEFAULT_SETTINGS.codeFont;

    if (Object.keys(patch).length) {
      store.updateSettings(patch);
      bumpRenderRevision();
    }
  }

  await deleteFontPack(pack.id);
  unregisterFontFaceSource(`pack:${pack.id}`);
  pushToast({
    titleKey: "fontPacks.removedToast",
    params: { font: pack.family },
    duration: 3000,
  });
}
</script>

<template>
  <UiDialog v-model:open="open" class="font-packs" layer="top" :title="$t('fontPacks.title')">
    <p class="font-packs__hint">{{ $t("fontPacks.hint") }}</p>

    <p v-if="!packs.length" class="font-packs__hint">{{ $t("fontPacks.none") }}</p>

    <ul v-else class="font-packs__list">
      <li v-for="pack in packs" :key="pack.id" class="font-packs__row">
        <div class="font-packs__text">
          <span class="font-packs__label">{{ pack.label }}</span>
          <span class="font-packs__meta"> {{ pack.family }} · {{ packSize(pack.bytes) }} </span>
        </div>

        <span v-if="installing === pack.id" class="font-packs__meta">
          {{ $t("fontPacks.downloading", { progress: Math.round(progress * 100) }) }}
        </span>
        <template v-else-if="installed.has(pack.id)">
          <span class="font-packs__meta">{{ $t("fontPacks.installed") }}</span>
          <UiIconButton
            icon="delete"
            :size="18"
            danger
            :disabled="busy"
            :label="$t('fontPacks.remove')"
            @click="remove(pack)"
          />
        </template>
        <UiButton v-else variant="primary" :disabled="busy" @click="install(pack)">
          {{ $t("fontPacks.install") }}
        </UiButton>
      </li>
    </ul>

    <p v-if="error" class="font-packs__error" role="alert">{{ error }}</p>
    <p class="font-packs__license">{{ $t("fontPacks.license") }}</p>
  </UiDialog>
</template>

<style>
.dialog.font-packs {
  width: min(34rem, calc(100vw - var(--space-8)));
}

.font-packs__hint {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.font-packs__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0 0 var(--space-3);
  padding: 0;
  list-style: none;
}

.font-packs__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.font-packs__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.font-packs__label {
  font-size: var(--text-md);
}

.font-packs__meta {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.font-packs__error {
  margin: 0 0 var(--space-3);
  color: var(--color-danger);
  font-size: var(--text-sm);
}

.font-packs__license {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}
</style>
