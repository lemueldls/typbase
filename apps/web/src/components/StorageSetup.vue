<script setup lang="ts">
import { isFsaSupported } from "@typbase/storage";

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
    <div class="storage-setup__card" data-tauri-drag-region="deep">
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

      <UiButton
        v-if="props.setup.canCancel"
        class="storage-setup__cancel"
        :disabled="busy"
        @click="cancelStorageSetup"
      >
        {{ $t("storage.cancel") }}
      </UiButton>
    </div>
  </div>
</template>

<style>
.storage-setup {
  flex: 1;
  display: grid;
  place-content: center;
  padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-4) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
  overflow: auto;
}

.storage-setup__card {
  display: grid;
  /* A path under an option is one long unbreakable token. An auto track sizes
     to its min-content and pushes the card wider than the viewport, which
     makes the whole app scroll sideways on Android; a zero-min track pins the
     card to its width so the path ellipsizes instead. */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3-5);
  width: min(30rem, calc(100vw - var(--space-8) - var(--safe-left) - var(--safe-right)));
}

.storage-setup__title {
  margin: 0;
  text-align: center;
  font-size: var(--text-2xl);
}

.storage-setup__intro {
  margin: 0;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: var(--text-md);
}

.storage-setup__options {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.storage-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3);
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
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
  width: var(--control-md);
  height: var(--control-md);
  flex: none;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: var(--radius-md);
}

.storage-option__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  min-width: 0;
}

.storage-option__name {
  font-weight: 600;
}

.storage-option__path {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.storage-option__hint {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.storage-setup__busy {
  margin: 0;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: var(--text-md);
}

.storage-setup__error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-md);
  text-align: center;
}

.storage-setup__cancel {
  justify-self: center;
}
</style>
