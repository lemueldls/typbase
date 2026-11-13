<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { themeSlug } from "@typbase/spaces/theme-registry";

import {
  applyPublishedTheme,
  applyThemeFile,
  checkThemeUpdate,
  exportThemeFile,
  importThemeFile,
  listRegistryThemes,
  publishCurrentTheme,
  registryUrl,
  themeFileFromSettings,
  themePreview,
  unpublishCurrentTheme,
  validateThemeMetadata,
  type RegistryTheme,
  type ThemePublishInput,
} from "~/composables/themeBrowser";

const props = defineProps<{ store: WorkspaceStore }>();
const emit = defineEmits<{ (e: "applied"): void }>();

const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();
const { atproto, atprotoStatus } = useWorkspace();

const settings = useWorkspaceValue(
  () => props.store,
  ["settings"],
  (store) => store.getSettings(),
);

const busy = ref(false);
const error = ref<string>();
const notice = ref<string>();
const uri = ref("");
const registryThemes = ref<RegistryTheme[]>([]);
const registryQuery = ref("");
const registryWarnings = ref<string[]>([]);
const registryLoading = ref(false);
const update = ref<{ available: boolean; version: string | null; uri: string | null } | null>(null);
const fileInput = ref<HTMLInputElement>();

const publish = ref<ThemePublishInput>({
  name: "",
  description: "",
  license: "MIT",
  tags: [],
  slug: "",
  version: "1.0.0",
  changelog: "",
});

const provenance = computed(() => settings.value.themeProvenance);
const registryBase = registryUrl();
const registryEnabled = computed(() => Boolean(registryBase));
const filteredRegistryThemes = computed(() => {
  const query = registryQuery.value.trim().toLowerCase();
  if (!query) return registryThemes.value;

  return registryThemes.value.filter((entry) =>
    [entry.name, entry.description, entry.publisher, ...entry.tags]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
});
const signedIn = computed(() => atprotoStatus.value.signedIn);

const forkSource = computed(() => {
  if (provenance.value.forkedFrom) return provenance.value.forkedFrom;
  const source = provenance.value.source;
  if (!source) return undefined;
  const sourceDid = source.split("/")[2];

  return sourceDid && sourceDid !== atprotoStatus.value.did ? source : undefined;
});

const ownSource = computed(() => {
  const source = provenance.value.source;
  const did = atprotoStatus.value.did;

  return Boolean(source && did && source.split("/")[2] === did);
});

const currentTheme = computed(() =>
  themeFileFromSettings(settings.value, {
    name: publish.value.name || settings.value.name,
    description: publish.value.description,
    license: publish.value.license,
    tags: publish.value.tags,
    forkedFrom: forkSource.value,
  }),
);

const currentPreview = computed(() => themePreview(currentTheme.value));
const currentWarnings = computed(() => validateThemeMetadata(currentTheme.value).warnings);

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function resetMessages(): void {
  error.value = undefined;
  notice.value = undefined;
}

async function loadRegistry(): Promise<void> {
  if (!registryEnabled.value) return;

  registryLoading.value = true;
  try {
    const result = await listRegistryThemes(registryBase);
    registryThemes.value = result.themes;
    registryWarnings.value = result.warnings;
  } catch (cause) {
    registryWarnings.value = [message(cause)];
  } finally {
    registryLoading.value = false;
  }
}

async function loadUpdate(): Promise<void> {
  if (!provenance.value.source) {
    update.value = null;

    return;
  }
  try {
    update.value = await checkThemeUpdate(props.store);
  } catch {
    update.value = null;
  }
}

function syncPublishForm(): void {
  if (!publish.value.name) publish.value.name = settings.value.name;
  const sourceSlug = provenance.value.source?.split("/").at(-1);
  publish.value.slug = sourceSlug ?? themeSlug(publish.value.name);
  publish.value.version = provenance.value.version ?? "1.0.0";
}

async function onOpenChange(value: boolean): Promise<void> {
  if (!value) return;

  resetMessages();
  syncPublishForm();
  await Promise.all([loadRegistry(), loadUpdate()]);
}

watch(open, (value) => void onOpenChange(value));
onMounted(() => {
  if (open.value) void onOpenChange(true);
});

function applyCatalogEntry(entry: RegistryTheme): void {
  if (!entry.release) {
    error.value = entry.error ?? t("themes.unavailable");

    return;
  }
  void applyUri(entry.uri);
}

async function applyUri(target: string): Promise<void> {
  resetMessages();
  busy.value = true;
  try {
    const theme = await applyPublishedTheme(props.store, target);
    notice.value = t("themes.applied", { name: theme.name });
    emit("applied");
    syncPublishForm();
    await loadUpdate();
  } catch (cause) {
    error.value = message(cause);
  } finally {
    busy.value = false;
  }
}

async function applyUpdate(): Promise<void> {
  const source = update.value?.uri;
  if (!source) return;
  await applyUri(source);
}

async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  resetMessages();
  try {
    const theme = importThemeFile(await file.text());
    applyThemeFile(props.store, theme);
    notice.value = t("themes.applied", { name: theme.name });
    emit("applied");
    syncPublishForm();
  } catch (cause) {
    error.value = message(cause);
  }
}

function exportTheme(): void {
  const theme = currentTheme.value;
  const blob = new Blob([exportThemeFile(theme)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${themeSlug(theme.name)}.tbskin`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function publishTheme(): Promise<void> {
  resetMessages();
  busy.value = true;
  try {
    const result = await publishCurrentTheme(
      props.store,
      { ...publish.value, forkedFrom: forkSource.value },
      atproto.value,
    );
    notice.value = t("themes.published", { uri: result.listingUri });
    emit("applied");
    syncPublishForm();
    await loadUpdate();
  } catch (cause) {
    error.value = message(cause);
  } finally {
    busy.value = false;
  }
}

async function copyUri(target: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(target);
    notice.value = t("themes.copied");
  } catch {
    notice.value = target;
  }
}

async function unpublish(): Promise<void> {
  if (!window.confirm(t("themes.unpublishConfirm"))) return;
  resetMessages();
  busy.value = true;
  try {
    await unpublishCurrentTheme(props.store, atproto.value);
    notice.value = t("themes.unpublished");
    emit("applied");
    syncPublishForm();
  } catch (cause) {
    error.value = message(cause);
  } finally {
    busy.value = false;
  }
}

async function reconnect(): Promise<void> {
  resetMessages();
  try {
    await atproto.value?.reauthorize();
  } catch (cause) {
    error.value = message(cause);
  }
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    layer="top"
    class="theme-browser-dialog"
    :title="$t('themes.title')"
    :description="$t('themes.description')"
  >
    <template #trigger>
      <UiButton>{{ $t("themes.browse") }}</UiButton>
    </template>

    <div class="theme-browser">
      <p v-if="error" class="theme-browser__error" role="alert">{{ error }}</p>
      <UiButton
        v-if="error?.includes('Reconnect')"
        variant="primary"
        icon="link"
        @click="reconnect"
      >
        {{ $t("themes.reconnect") }}
      </UiButton>
      <p v-if="notice" class="theme-browser__notice" role="status">{{ notice }}</p>

      <section class="theme-browser__section">
        <header class="theme-browser__section-head">
          <h3>{{ $t("themes.current") }}</h3>
          <span v-if="provenance.source" class="theme-browser__source">
            {{ provenance.source }}
          </span>
        </header>
        <div class="theme-preview">
          <div
            v-for="variant in [currentPreview.light, currentPreview.dark]"
            :key="variant.mode"
            class="theme-preview__card"
            :style="{ background: variant.surface, color: variant.text }"
          >
            <span class="theme-preview__bar" :style="{ background: variant.surface2 }" />
            <span class="theme-preview__accent" :style="{ background: variant.accent }" />
            <span class="theme-preview__label">{{ variant.mode }}</span>
          </div>
        </div>
        <p v-for="warning in currentWarnings" :key="warning" class="theme-browser__warning">
          {{ warning }}
        </p>
        <div class="theme-browser__actions">
          <UiButton icon="download" @click="exportTheme">
            {{ $t("themes.export") }}
          </UiButton>
          <UiButton icon="upload" @click="fileInput?.click()">
            {{ $t("themes.import") }}
          </UiButton>
          <input ref="fileInput" type="file" accept=".tbskin,.json" hidden @change="importFile" />
        </div>
        <div v-if="update?.available" class="theme-browser__update">
          <span>{{ $t("themes.updateAvailable", { version: update.version }) }}</span>
          <UiButton @click="applyUpdate">{{ $t("themes.update") }}</UiButton>
        </div>
      </section>

      <section class="theme-browser__section">
        <header class="theme-browser__section-head">
          <h3>{{ $t("themes.fromUri") }}</h3>
        </header>
        <div class="theme-browser__uri">
          <UiTextField
            v-model="uri"
            :placeholder="$t('themes.uriPlaceholder')"
            :aria-label="$t('themes.fromUri')"
            spellcheck="false"
          />
          <UiButton variant="primary" :disabled="!uri.trim() || busy" @click="applyUri(uri)">
            {{ $t("themes.apply") }}
          </UiButton>
        </div>
      </section>

      <section class="theme-browser__section">
        <header class="theme-browser__section-head">
          <h3>{{ $t("themes.registry") }}</h3>
          <span v-if="!registryEnabled" class="theme-browser__muted">
            {{ $t("themes.noRegistry") }}
          </span>
        </header>

        <p v-if="registryLoading" class="theme-browser__muted">{{ $t("themes.loading") }}</p>
        <p v-for="warning in registryWarnings" :key="warning" class="theme-browser__warning">
          {{ warning }}
        </p>

        <UiTextField
          v-if="registryEnabled"
          v-model="registryQuery"
          type="search"
          :placeholder="$t('themes.search')"
          :aria-label="$t('themes.search')"
          spellcheck="false"
        />
        <ul v-if="filteredRegistryThemes.length" class="theme-browser__list">
          <li v-for="entry in filteredRegistryThemes" :key="entry.uri" class="theme-browser__item">
            <div class="theme-preview theme-preview--small">
              <div
                v-if="entry.preview"
                class="theme-preview__card"
                :style="{
                  background: entry.preview?.light.surface,
                  color: entry.preview?.light.text,
                }"
              >
                <span
                  class="theme-preview__bar"
                  :style="{ background: entry.preview?.light.surface2 }"
                />
                <span
                  class="theme-preview__accent"
                  :style="{ background: entry.preview?.light.accent }"
                />
              </div>
              <div
                v-if="entry.preview"
                class="theme-preview__card"
                :style="{
                  background: entry.preview?.dark.surface,
                  color: entry.preview?.dark.text,
                }"
              >
                <span
                  class="theme-preview__bar"
                  :style="{ background: entry.preview?.dark.surface2 }"
                />
                <span
                  class="theme-preview__accent"
                  :style="{ background: entry.preview?.dark.accent }"
                />
              </div>
            </div>
            <div class="theme-browser__item-body">
              <div class="theme-browser__item-title">
                <strong>{{ entry.name }}</strong>
                <span v-if="entry.version">v{{ entry.version }}</span>
              </div>
              <p v-if="entry.description">{{ entry.description }}</p>
              <p class="theme-browser__meta">
                {{ entry.publisher }}
                <span v-if="entry.tags.length"> · {{ entry.tags.join(", ") }}</span>
              </p>
              <p v-for="warning in entry.warnings" :key="warning" class="theme-browser__warning">
                {{ warning }}
              </p>
              <p v-if="entry.error" class="theme-browser__warning">{{ entry.error }}</p>
            </div>
            <div class="theme-browser__item-actions">
              <UiButton :disabled="!entry.release || busy" @click="applyCatalogEntry(entry)">
                {{ $t("themes.apply") }}
              </UiButton>
              <UiButton variant="ghost" @click="copyUri(entry.uri)">
                {{ $t("themes.copy") }}
              </UiButton>
            </div>
          </li>
        </ul>
        <p v-else-if="registryEnabled && !registryLoading" class="theme-browser__muted">
          {{ $t("themes.emptyRegistry") }}
        </p>
      </section>

      <section class="theme-browser__section">
        <header class="theme-browser__section-head">
          <h3>{{ $t("themes.publish") }}</h3>
          <span v-if="!signedIn" class="theme-browser__muted">
            {{ $t("themes.signIn") }}
          </span>
        </header>

        <div class="theme-browser__form">
          <UiTextField
            v-model="publish.name"
            :placeholder="$t('themes.name')"
            :aria-label="$t('themes.name')"
          />
          <UiTextField
            v-model="publish.slug"
            :placeholder="$t('themes.slug')"
            :aria-label="$t('themes.slug')"
            spellcheck="false"
          />
          <UiTextField
            v-model="publish.version"
            :placeholder="$t('themes.version')"
            :aria-label="$t('themes.version')"
            spellcheck="false"
          />
          <UiTextField
            v-model="publish.license"
            :placeholder="$t('themes.license')"
            :aria-label="$t('themes.license')"
          />
          <UiTextField
            v-model="publish.description"
            :placeholder="$t('themes.descriptionLabel')"
            :aria-label="$t('themes.descriptionLabel')"
          />
          <UiTagsInput
            v-model="publish.tags"
            :label="$t('themes.tags')"
            :placeholder="$t('themes.tags')"
          />
          <textarea
            v-model="publish.changelog"
            class="theme-browser__changelog"
            :placeholder="$t('themes.changelog')"
            :aria-label="$t('themes.changelog')"
            rows="2"
          />
        </div>

        <UiButton
          variant="primary"
          :disabled="!signedIn || busy || !publish.name.trim()"
          @click="publishTheme"
        >
          {{ busy ? $t("themes.publishing") : $t("themes.publishButton") }}
        </UiButton>
      </section>
    </div>
  </UiDialog>
</template>

<style>
.theme-browser-dialog {
  width: min(70rem, calc(100vw - var(--space-8)));
  max-height: min(56rem, calc(100dvh - var(--space-10)));
}

.theme-browser {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}

.theme-browser__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.theme-browser__section:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.theme-browser__section-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.theme-browser__section-head h3 {
  margin: 0;
  font-size: var(--text-lg);
}

.theme-browser__source {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-browser__muted {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.theme-browser__warning {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-warning);
}

.theme-browser__error {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-radius: var(--radius-sm);
}

.theme-browser__notice {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-ok);
  background: var(--color-ok-soft);
  border-radius: var(--radius-sm);
}

.theme-preview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.theme-preview--small {
  width: 8rem;
  flex: none;
}

.theme-preview__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 4.5rem;
  padding: var(--space-2);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.theme-preview__bar {
  display: block;
  height: 0.5rem;
  width: 70%;
  border-radius: var(--radius-full);
}

.theme-preview__accent {
  display: block;
  height: 1.25rem;
  width: 40%;
  border-radius: var(--radius-sm);
}

.theme-preview__label {
  margin-top: auto;
  font-size: var(--text-2xs);
  opacity: 0.75;
}

.theme-browser__actions,
.theme-browser__uri,
.theme-browser__update {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.theme-browser__uri .ui-text-field {
  flex: 1;
  min-width: 14rem;
}

.theme-browser__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.theme-browser__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.theme-browser__item-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.theme-browser__item-body p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.theme-browser__item-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.theme-browser__item-title span {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.theme-browser__item-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
}

.theme-browser__meta {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
}

.theme-browser__form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.theme-browser__form .ui-tags-input,
.theme-browser__changelog {
  grid-column: 1 / -1;
}

.theme-browser__changelog {
  width: 100%;
  padding: var(--space-2);
  font: inherit;
  font-size: var(--text-md);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  resize: vertical;
}

.theme-browser__changelog:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -1px;
}

@media (max-width: 48rem) {
  .theme-browser__form,
  .theme-preview {
    grid-template-columns: minmax(0, 1fr);
  }

  .theme-preview--small {
    display: none;
  }

  .theme-browser__item {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .theme-browser__item-actions {
    width: 100%;
  }
}
</style>
