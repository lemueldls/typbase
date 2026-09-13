<script setup lang="ts">
import { isFsaSupported } from "@typbase/storage";

import type { StorageSetupChoice, StorageSetupState } from "~/composables/workspace";

import { useWorkspace } from "~/composables/workspace";

/**
 * First-run storage picker (and the change-location screen from settings).
 * Native builds choose app data, the device documents folder, or a folder
 * picked through the native dialog. Browsers choose OPFS or a folder handle,
 * and reconnect the handle when its permission expired.
 */
const props = defineProps<{ setup: StorageSetupState }>();

const { configureStorage, cancelStorageSetup } = useWorkspace();
const { t } = useI18n();

const busy = ref(false);
const error = ref("");
const fsaSupported = isFsaSupported();

async function run(choice: StorageSetupChoice): Promise<void> {
  if (busy.value) return;

  busy.value = true;
  error.value = "";
  try {
    await configureStorage(choice);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="storage-setup">
    <div class="storage-setup__card">
      <h1 class="storage-setup__title">
        {{ setup.reason === "reconnect" ? $t("storage.reconnectTitle") : $t("storage.setupTitle") }}
      </h1>

      <p class="storage-setup__intro">
        <template v-if="setup.reason === 'reconnect'">
          {{ $t("storage.reconnectIntro", { name: setup.folderName }) }}
        </template>
        <template v-else-if="setup.environment === 'native'">
          {{ $t("storage.setupIntroNative") }}
        </template>
        <template v-else>
          {{ $t("storage.setupIntroBrowser") }}
        </template>
      </p>

      <div v-if="setup.environment === 'native'" class="storage-setup__options">
        <button
          type="button"
          class="storage-option"
          :class="{ 'storage-option--active': setup.native?.mode === 'app' }"
          :disabled="busy"
          @click="run({ kind: 'native', mode: 'app' })"
        >
          <span class="storage-option__icon" aria-hidden="true">
            <MsIcon name="hard_drive" :size="22" />
          </span>
          <span class="storage-option__body">
            <span class="storage-option__name">{{ $t("storage.modeApp") }}</span>
            <span class="storage-option__path">{{ setup.native?.appRoot }}</span>
            <span class="storage-option__hint">{{ $t("storage.modeAppHint") }}</span>
          </span>
        </button>

        <button
          v-if="setup.native?.deviceRoot"
          type="button"
          class="storage-option"
          :class="{ 'storage-option--active': setup.native?.mode === 'device' }"
          :disabled="busy"
          @click="run({ kind: 'native', mode: 'device' })"
        >
          <span class="storage-option__icon" aria-hidden="true">
            <MsIcon name="folder" :size="22" />
          </span>
          <span class="storage-option__body">
            <span class="storage-option__name">{{ $t("storage.modeDevice") }}</span>
            <span class="storage-option__path">{{ setup.native?.deviceRoot }}</span>
            <span class="storage-option__hint">{{ $t("storage.modeDeviceHint") }}</span>
          </span>
        </button>

        <button
          v-if="setup.native?.canPickFolder"
          type="button"
          class="storage-option"
          :class="{ 'storage-option--active': setup.native?.mode === 'custom' }"
          :disabled="busy"
          @click="run({ kind: 'native-folder' })"
        >
          <span class="storage-option__icon" aria-hidden="true">
            <MsIcon name="folder_open" :size="22" />
          </span>
          <span class="storage-option__body">
            <span class="storage-option__name">{{ $t("storage.modeCustom") }}</span>
            <span class="storage-option__path">
              {{
                setup.native?.mode === "custom" ? setup.native?.root : $t("storage.chooseFolder")
              }}
            </span>
            <span class="storage-option__hint">{{ $t("storage.modeCustomHint") }}</span>
          </span>
        </button>
      </div>

      <div v-else class="storage-setup__options">
        <button
          v-if="setup.reason === 'reconnect'"
          type="button"
          class="storage-option"
          :disabled="busy"
          @click="run({ kind: 'browser-reconnect' })"
        >
          <span class="storage-option__icon" aria-hidden="true">
            <MsIcon name="folder_open" :size="22" />
          </span>
          <span class="storage-option__body">
            <span class="storage-option__name">{{ setup.folderName }}</span>
            <span class="storage-option__path">{{ $t("storage.reconnectAction") }}</span>
          </span>
        </button>

        <button
          type="button"
          class="storage-option"
          :disabled="busy"
          @click="run({ kind: 'browser-opfs' })"
        >
          <span class="storage-option__icon" aria-hidden="true">
            <MsIcon name="database" :size="22" />
          </span>
          <span class="storage-option__body">
            <span class="storage-option__name">{{ $t("storage.modeBrowser") }}</span>
            <span class="storage-option__path">OPFS</span>
            <span class="storage-option__hint">{{ $t("storage.modeBrowserHint") }}</span>
          </span>
        </button>

        <button
          v-if="fsaSupported"
          type="button"
          class="storage-option"
          :disabled="busy"
          @click="run({ kind: 'browser-folder' })"
        >
          <span class="storage-option__icon" aria-hidden="true">
            <MsIcon name="folder_open" :size="22" />
          </span>
          <span class="storage-option__body">
            <span class="storage-option__name">{{ $t("storage.modeFolder") }}</span>
            <span class="storage-option__path">
              {{ setup.folderName ?? $t("storage.chooseFolder") }}
            </span>
            <span class="storage-option__hint">{{ $t("storage.modeFolderHint") }}</span>
          </span>
        </button>
      </div>

      <p v-if="busy" class="storage-setup__busy">{{ $t("storage.working") }}</p>
      <p v-if="error" class="storage-setup__error" role="alert">{{ error }}</p>

      <button
        v-if="props.setup.canCancel"
        type="button"
        class="button storage-setup__cancel"
        :disabled="busy"
        @click="cancelStorageSetup"
      >
        {{ $t("storage.cancel") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.storage-setup {
  flex: 1;
  display: grid;
  place-content: center;
  padding: 1rem;
  overflow: auto;
}

.storage-setup__card {
  display: grid;
  gap: 0.9rem;
  width: min(30rem, calc(100vw - 2rem));
}

.storage-setup__title {
  margin: 0;
  text-align: center;
  font-size: 1.3rem;
}

.storage-setup__intro {
  margin: 0;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.storage-setup__options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.storage-option {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  width: 100%;
  padding: 0.7rem 0.8rem;
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.6rem;
  color: inherit;
  cursor: pointer;
}

.storage-option:hover:not(:disabled),
.storage-option:focus-visible {
  border-color: var(--color-accent);
}

.storage-option--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.storage-option:disabled {
  opacity: 0.6;
  cursor: progress;
}

.storage-option__icon {
  display: grid;
  place-content: center;
  width: 2.2rem;
  height: 2.2rem;
  flex: none;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: 0.5rem;
}

.storage-option__body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.storage-option__name {
  font-weight: 600;
}

.storage-option__path {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.storage-option__hint {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.storage-setup__busy {
  margin: 0;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.storage-setup__error {
  margin: 0;
  color: var(--color-danger);
  font-size: 0.85rem;
  text-align: center;
}

.storage-setup__cancel {
  justify-self: center;
}
</style>
