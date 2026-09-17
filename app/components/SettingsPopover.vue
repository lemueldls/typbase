<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type {
  SpellcheckMode,
  ThemePaletteToken,
  ThemePaletteTokens,
  WorkspaceSettings,
} from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { isTauri } from "@typbase/storage";
import { THEME_PALETTE_TOKEN_KEYS } from "@typbase/typing";

import { getAiKeys, setAiKeys } from "~/lib/ai/keys";
import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";
import { CUSTOM_THEME_ID, resolveTheme, THEMES } from "~/lib/themes";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const {
  dataRevision,
  workspaceId,
  atproto,
  atprotoStatus,
  atprotoReady,
  workspaces,
  activeWorkspaceId,
  setWorkspaceIcon,
  storageLocation,
  openStorageSetup,
} = useWorkspace();

/** The active workspace's registry icon; setter writes it through the registry. */
const workspaceIcon = computed({
  get: () => {
    const info = workspaces.value.find((entry) => entry.id === activeWorkspaceId.value);
    return (info?.icon as MaterialSymbol | undefined) ?? DEFAULT_WORKSPACE_ICON;
  },
  set: (icon: MaterialSymbol) => {
    if (!activeWorkspaceId.value) return;
    void setWorkspaceIcon(activeWorkspaceId.value, icon).catch((cause) => {
      console.error("[settings] failed to save workspace icon:", cause);
    });
  },
});
const { t, locale, setLocale } = useI18n();
const appLocale = useAppLocale(locale, setLocale, () => props.store);

// Loro maps are not reactive; the workspace bumps dataRevision on any change.
const settings = computed(() => {
  void dataRevision.value;

  return props.store.getSettings();
});

// Publish defaults (stored in workspace settings so they sync).
const publishDefaults = computed(() => props.store.getPublishSettings());
const publishLangs = computed({
  get: () => publishDefaults.value.langs.join(", "),
  set: (value: string) =>
    props.store.updateSettings({
      publish: {
        ...publishDefaults.value,
        langs: value
          .split(",")
          .map((lang) => lang.trim())
          .filter(Boolean),
      },
    }),
});
const publishTags = computed({
  get: () => publishDefaults.value.tags.join(", "),
  set: (value: string) =>
    props.store.updateSettings({
      publish: {
        ...publishDefaults.value,
        tags: value
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      },
    }),
});
function togglePdf(value: boolean) {
  props.store.updateSettings({
    publish: {
      ...publishDefaults.value,
      includePdf: value,
    },
  });
}

// AI config (syncs; keys do not). Features are opt-in: nothing runs until
// the user flips `enabled`, and the provider details gate the menu too.
const aiConfig = computed(() => props.store.getAiConfig());
function updateAiPatching(patch: Record<string, unknown>) {
  props.store.updateSettings({ ai: { ...aiConfig.value, ...patch } });
}
const aiKeys = ref(getAiKeys());

// Theme picker: named themes from the registry plus a custom palette. The
// custom editor seeds from the resolved palette, so selecting it starts from
// the colors currently on screen instead of an empty map.
const customSwatch = computed(() => {
  const base = resolveTheme({ ...settings.value, themeName: "default" }).palette;
  const custom = settings.value.themeCustom;

  return {
    background: custom?.surface ?? base.surface,
    accent: custom?.accent ?? base.accent,
    text: custom?.text ?? base.text,
  };
});

const themeOptions = computed(() => [
  ...THEMES.map((theme) => ({ id: theme.id, label: theme.label, swatch: theme.swatch })),
  { id: CUSTOM_THEME_ID, label: t("settings.custom"), swatch: customSwatch.value },
]);

function selectTheme(id: string) {
  const patch: Partial<WorkspaceSettings> = { themeName: id };
  if (id === CUSTOM_THEME_ID && !settings.value.themeCustom) {
    patch.themeCustom = { ...resolveTheme(settings.value).palette };
  }

  props.store.updateSettings(patch);
  // Apply immediately; the structure-change echo also refreshes, but the
  // editor should not wait on it.
  applyTheme(props.store.getSettings());
  bumpRenderRevision();
}

/** Draft palette while the custom editor is open; null for named themes. */
const paletteDraft = ref<ThemePaletteTokens | null>(null);

function syncPaletteDraft(): void {
  paletteDraft.value =
    settings.value.themeName === CUSTOM_THEME_ID
      ? { ...resolveTheme(settings.value).palette }
      : null;
}

watch(
  () => [settings.value.themeName, settings.value.theme, settings.value.themeCustom] as const,
  syncPaletteDraft,
  { immediate: true, deep: true },
);

/** "surface2" -> "Surface 2", "borderStrong" -> "Border Strong". */
function tokenLabel(key: string): string {
  return key.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

function setPaletteToken(key: ThemePaletteToken, value: string): void {
  if (!paletteDraft.value) return;

  const next = { ...paletteDraft.value, [key]: value };
  paletteDraft.value = next;
  props.store.updateSettings({ themeCustom: next });
  applyTheme(props.store.getSettings());
  bumpRenderRevision();
}

/** Settings tab; keeps the popover from becoming a scroll marathon. */
const activeTab = ref<"general" | "content" | "appearance" | "publish" | "ai" | "search" | "sync">(
  "general",
);

// Typst sources that drive page structure: the daily template placeholders
// (see WorkspaceStore.createDailyNote) and the workspace prelude appended to
// every compile. Both sync through settings like everything else.
function onLocaleChange(event: Event) {
  appLocale.set((event.target as HTMLSelectElement).value);
}

function onDailyTemplateChange(event: Event) {
  props.store.updateSettings({
    dailyNoteTemplate: (event.target as HTMLTextAreaElement).value,
  });
}
function onPagePreludeChange(event: Event) {
  props.store.updateSettings({
    pagePrelude: (event.target as HTMLTextAreaElement).value,
  });
}

function onSpellcheckChange(event: Event) {
  props.store.updateSettings({
    spellcheck: (event.target as HTMLSelectElement).value as SpellcheckMode,
  });
}

// Search status.
const { ensure: ensureSearch, search, status: searchStatus } = useSearch();
const searchModelLabel = computed(() => {
  const status = searchStatus.value;
  if (!status) return "";
  if (status.model === "downloading") return t("settings.searchModelDownloading");
  if (status.model === "ready") return t("settings.searchModelReady");
  if (status.model === "error") {
    return t("settings.searchModelError", { error: status.error ?? "" });
  }

  return t("settings.searchModelIdle");
});
async function onRebuildIndex() {
  await (search.value ?? (await ensureSearch(props.store))).rebuild();
}
function setAiEnabled(value: boolean) {
  updateAiPatching({ enabled: value });
}

async function toggleSemantic(semantic: boolean) {
  props.store.updateSettings({
    search: { ...props.store.getSearchSettings(), semantic },
  });
  if (semantic) {
    const manager = search.value ?? (await ensureSearch(props.store));
    await manager.reembedAll();
  }
}

function onAiKeyChange(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  setAiKeys(
    aiConfig.value.provider === "anthropic"
      ? { ...aiKeys.value, anthropic: value }
      : { ...aiKeys.value, openai: value },
  );
  aiKeys.value = getAiKeys();
}

const signInIdentifier = ref("");
const signInBusy = ref(false);
const signInError = ref("");

// Redirecting away on success; clear the busy flag in case the user comes back.
const { start: resetSignInBusy } = useTimeoutFn(
  () => {
    signInBusy.value = false;
  },
  10_000,
  { immediate: false },
);

async function onSignIn() {
  const identifier = signInIdentifier.value.trim();
  if (!identifier || !atproto.value) return;

  signInBusy.value = true;
  signInError.value = "";
  // Redirect flow: the page navigates to the PDS; login returns only when
  // the redirect was intercepted, so surface a failure without awaiting.
  void atproto.value.signIn(identifier).catch((cause) => {
    signInError.value = cause instanceof Error ? cause.message : String(cause);
  });
  resetSignInBusy();
}

async function onSignOut() {
  await atproto.value?.signOut();
}

onMounted(() => {
  // The index worker boots on first settings open; harmless if already up.
  void ensureSearch(props.store);
  applyTheme(props.store.getSettings());
});

function onThemeChange(event: Event) {
  const mode = (event.target as HTMLSelectElement).value as "auto" | "light" | "dark";
  props.store.updateSettings({ theme: mode });
  applyTheme(props.store.getSettings());
  bumpRenderRevision();
}

function formatAgo(timestamp: number): string {
  if (!timestamp) return t("settings.syncNever");

  return appLocale.formatAgo(timestamp);
}

function shortDid(did: string | null): string {
  if (!did) return "";

  return did.length > 18 ? `${did.slice(0, 10)}...${did.slice(-6)}` : did;
}

const textFontOptions = computed(() => systemFontOptions.value.text);
const mathFontOptions = computed(() => systemFontOptions.value.math);
const codeFontOptions = computed(() => systemFontOptions.value.code);

function supportsLocalFonts() {
  if (isTauri()) return true;

  return typeof window !== "undefined" && "queryLocalFonts" in window;
}

async function installSystemFonts() {
  const typstState = await useTypst();
  const current = props.store.getSettings();

  try {
    await loadSystemFonts(typstState, [current.font, current.mathFont, current.codeFont]);
  } catch {
    // loadSystemFonts records the reason in systemFontsError.
  }
}

async function updateFont(patch: {
  font?: string;
  mathFont?: string | null;
  codeFont?: string | null;
}) {
  props.store.updateSettings(patch);
}

async function renameWorkspace(event: Event) {
  const name = (event.target as HTMLInputElement).value.trim();
  if (name) props.store.updateSettings({ name });
}

function onFontChange(event: Event) {
  updateFont({ font: (event.target as HTMLSelectElement).value });
}

function onMathFontChange(event: Event) {
  updateFont({ mathFont: (event.target as HTMLSelectElement).value || null });
}

function onCodeFontChange(event: Event) {
  updateFont({ codeFont: (event.target as HTMLSelectElement).value || null });
}

function onTextSizeChange(event: Event) {
  const size = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(size) || size <= 0) return;

  props.store.updateSettings({ textSize: size });
  // Push the size into the wasm space context before the render revision
  // triggers recompiles; the structure-change echo re-applies it anyway.
  void applyWorkspaceStyleToTypst(workspaceId.value, props.store).then(() => {
    bumpRenderRevision();
  });
}
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent class="popover" :side-offset="8" align="start">
        <h3 class="popover__title">{{ $t("settings.title") }}</h3>
        <div class="settings__tabs">
          <button
            type="button"
            class="settings__tab"
            data-tab="general"
            :class="{ 'settings__tab--active': activeTab === 'general' }"
            @click="activeTab = 'general'"
          >
            {{ $t("settings.tabGeneral") }}
          </button>
          <button
            type="button"
            class="settings__tab"
            data-tab="content"
            :class="{ 'settings__tab--active': activeTab === 'content' }"
            @click="activeTab = 'content'"
          >
            {{ $t("settings.tabContent") }}
          </button>
          <button
            type="button"
            class="settings__tab"
            data-tab="appearance"
            :class="{ 'settings__tab--active': activeTab === 'appearance' }"
            @click="activeTab = 'appearance'"
          >
            {{ $t("settings.tabAppearance") }}
          </button>
          <button
            type="button"
            class="settings__tab"
            data-tab="publish"
            :class="{ 'settings__tab--active': activeTab === 'publish' }"
            @click="activeTab = 'publish'"
          >
            {{ $t("settings.tabPublish") }}
          </button>
          <button
            type="button"
            class="settings__tab"
            data-tab="ai"
            :class="{ 'settings__tab--active': activeTab === 'ai' }"
            @click="activeTab = 'ai'"
          >
            {{ $t("settings.tabAi") }}
          </button>
          <button
            type="button"
            class="settings__tab"
            data-tab="search"
            :class="{ 'settings__tab--active': activeTab === 'search' }"
            @click="activeTab = 'search'"
          >
            {{ $t("settings.tabSearch") }}
          </button>
          <button
            type="button"
            class="settings__tab"
            data-tab="sync"
            :class="{ 'settings__tab--active': activeTab === 'sync' }"
            @click="activeTab = 'sync'"
          >
            {{ $t("settings.tabSync") }}
          </button>
        </div>

        <section v-show="activeTab === 'general'" class="settings__tabpanel">
          <Label class="settings__field">
            <span>{{ $t("settings.name") }}</span>
            <input class="settings__input" :value="settings.name" @change="renameWorkspace" />
          </Label>

          <div class="settings__field">
            <span>{{ $t("switcher.iconLabel") }}</span>
            <IconPicker v-model="workspaceIcon" />
          </div>

          <Label class="settings__field">
            <span>{{ $t("settings.language") }}</span>
            <select
              class="settings__input"
              :value="settings.locale ?? 'auto'"
              @change="onLocaleChange"
            >
              <option value="auto">{{ $t("settings.languageAuto") }}</option>
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="de">Deutsch</option>
              <option value="fr">Français</option>
              <option value="zh">中文</option>
            </select>
          </Label>

          <div class="settings__field">
            <span>{{ $t("settings.storage") }}</span>
            <div class="settings__storage">
              <span class="settings__storage-info">
                <span class="settings__storage-label">{{ storageLocation.label }}</span>
                <span v-if="storageLocation.path" class="settings__storage-path">
                  {{ storageLocation.path }}
                </span>
              </span>
              <button type="button" class="button button--tiny" @click="openStorageSetup">
                {{ $t("settings.changeStorage") }}
              </button>
            </div>
            <!-- <span class="settings__hint">{{ $t("settings.storageHint") }}</span> -->
          </div>
        </section>

        <!-- Long Typst-source textareas live on their own tab so General stays
             a short form: name, icon, language. -->
        <section v-show="activeTab === 'content'" class="settings__tabpanel">
          <Label class="settings__field">
            <span>{{ $t("settings.template") }}</span>
            <textarea
              class="settings__input settings__textarea"
              :value="settings.dailyNoteTemplate"
              rows="5"
              spellcheck="false"
              @change="onDailyTemplateChange"
            />
            <span class="settings__hint">{{ $t("settings.templateHint") }}</span>
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.prelude") }}</span>
            <textarea
              class="settings__input settings__textarea"
              :value="settings.pagePrelude ?? ''"
              rows="4"
              spellcheck="false"
              placeholder="#set text(size: 11pt)  // runs before every page, after theme/fonts"
              @change="onPagePreludeChange"
            />
            <span class="settings__hint">{{ $t("settings.preludeHint") }}</span>
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.spellcheck") }}</span>
            <select
              class="settings__input"
              :value="settings.spellcheck ?? 'off'"
              @change="onSpellcheckChange"
            >
              <option value="off">{{ $t("settings.spellcheckOff") }}</option>
              <option value="native">{{ $t("settings.spellcheckNative") }}</option>
              <option value="harper">{{ $t("settings.spellcheckHarper") }}</option>
            </select>
            <span class="settings__hint">{{ $t("settings.spellcheckHint") }}</span>
          </Label>
        </section>

        <section v-show="activeTab === 'appearance'" class="settings__tabpanel">
          <div class="settings__field">
            <span>{{ $t("settings.theme") }}</span>
            <div class="theme-grid" role="group" :aria-label="$t('settings.theme')">
              <button
                v-for="option in themeOptions"
                :key="option.id"
                type="button"
                :aria-pressed="settings.themeName === option.id"
                class="theme-card"
                :class="{ 'theme-card--active': settings.themeName === option.id }"
                @click="selectTheme(option.id)"
              >
                <span class="theme-card__swatches" aria-hidden="true">
                  <span class="theme-card__dot" :style="{ background: option.swatch.background }" />
                  <span class="theme-card__dot" :style="{ background: option.swatch.accent }" />
                  <span class="theme-card__dot" :style="{ background: option.swatch.text }" />
                </span>
                <span class="theme-card__label">{{ option.label }}</span>
              </button>
            </div>
          </div>

          <Label class="settings__field">
            <span>{{ $t("settings.themeMode") }}</span>
            <select
              class="settings__input"
              :value="settings.theme ?? 'auto'"
              @change="onThemeChange"
            >
              <option value="auto">{{ $t("settings.auto") }}</option>
              <option value="light">{{ $t("settings.light") }}</option>
              <option value="dark">{{ $t("settings.dark") }}</option>
            </select>
          </Label>

          <div v-if="paletteDraft" class="settings__field">
            <span>{{ $t("settings.customPalette") }}</span>
            <div class="palette-grid">
              <ColorFieldRoot
                v-for="key in THEME_PALETTE_TOKEN_KEYS"
                :key="key"
                class="palette-token"
                :model-value="paletteDraft[key]"
                @update:model-value="setPaletteToken(key, $event)"
              >
                <ColorSwatch class="palette-token__swatch" :color="paletteDraft[key]" />
                <span class="palette-token__label">{{ tokenLabel(key) }}</span>
                <ColorFieldInput
                  class="palette-token__input"
                  :aria-label="tokenLabel(key)"
                  spellcheck="false"
                />
              </ColorFieldRoot>
            </div>
            <span class="settings__hint">{{ $t("settings.customPaletteHint") }}</span>
          </div>

          <Label class="settings__field">
            <span>{{ $t("settings.textSize") }}</span>
            <input
              class="settings__input"
              type="number"
              min="8"
              max="72"
              step="1"
              :value="settings.textSize"
              @change="onTextSizeChange"
            />
            <span class="settings__hint">{{ $t("settings.textSizeHint") }}</span>
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.textFont") }}</span>
            <select class="settings__input" :value="settings.font" @change="onFontChange">
              <option v-for="font in textFontOptions" :key="font" :value="font">
                {{ font }}
              </option>
            </select>
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.mathFont") }}</span>
            <select
              class="settings__input"
              :value="settings.mathFont ?? 'New Computer Modern Math'"
              @change="onMathFontChange"
            >
              <option value="">{{ $t("settings.sameAsText") }}</option>
              <option v-for="font in mathFontOptions" :key="font" :value="font">
                {{ font }}
              </option>
            </select>
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.codeFont") }}</span>
            <select
              class="settings__input"
              :value="settings.codeFont ?? ''"
              @change="onCodeFontChange"
            >
              <option value="">{{ $t("settings.sameAsText") }}</option>
              <option v-for="font in codeFontOptions" :key="font" :value="font">
                {{ font }}
              </option>
            </select>
          </Label>

          <div class="settings__system-fonts">
            <p class="settings__hint">
              Finds installed fonts for the pickers; the families this workspace uses load into the
              Typst engine.
            </p>

            <template v-if="supportsLocalFonts()">
              <button
                v-if="!systemFontsLoaded"
                type="button"
                class="button button--primary"
                :disabled="systemFontsLoading"
                @click="installSystemFonts"
              >
                {{ systemFontsLoading ? "Loading..." : "Load system fonts" }}
              </button>
              <p v-if="systemFontsLoaded" class="settings__ok">
                {{
                  $t("settings.systemFontsLoaded", {
                    count: systemFontFamilies.length,
                  })
                }}
              </p>
            </template>
            <p v-else class="settings__hint">
              {{ $t("settings.cannotEnumerate") }}
            </p>

            <p v-if="systemFontsError" class="settings__error">
              {{ systemFontsError }}
            </p>
          </div>
        </section>

        <section v-show="activeTab === 'publish'" class="settings__tabpanel">
          <section class="settings__section">
            <h4 class="settings__heading">Publish defaults</h4>
            <Label class="settings__field">
              <span>{{ $t("settings.langs") }}</span>
              <input
                class="settings__input"
                :value="publishLangs"
                placeholder="en, de"
                @change="publishLangs = ($event.target as HTMLInputElement).value"
              />
            </Label>
            <Label class="settings__field">
              <span>{{ $t("settings.tags") }}</span>
              <input
                class="settings__input"
                :value="publishTags"
                :placeholder="$t('settings.tags')"
                @change="publishTags = ($event.target as HTMLInputElement).value"
              />
            </Label>
            <UiCheckbox
              :model-value="publishDefaults.includePdf"
              :label="$t('settings.includePdf')"
              @update:model-value="togglePdf"
            />
          </section>
        </section>
        <section v-show="activeTab === 'ai'" class="settings__tabpanel">
          <section class="settings__section">
            <h4 class="settings__heading">AI</h4>
            <UiSwitch
              :model-value="aiConfig.enabled"
              :label="$t('settings.aiEnable')"
              @update:model-value="setAiEnabled"
            />
            <p class="settings__hint">
              Off by default: nothing is generated or sent to a provider until you enable this.
            </p>
            <template v-if="aiConfig.enabled">
              <Label class="settings__field">
                <span>{{ $t("settings.provider") }}</span>
                <select
                  class="settings__input"
                  :value="aiConfig.provider"
                  @change="
                    updateAiPatching({
                      provider: ($event.target as HTMLSelectElement).value,
                    })
                  "
                >
                  <option value="ollama">Ollama (local)</option>
                  <option value="openai-compatible">OpenAI-compatible</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </Label>
              <Label class="settings__field">
                <span>{{ $t("settings.baseUrl") }}</span>
                <input
                  class="settings__input"
                  :value="aiConfig.baseUrl"
                  :placeholder="
                    aiConfig.provider === 'ollama'
                      ? 'http://localhost:11434'
                      : aiConfig.provider === 'anthropic'
                        ? 'https://api.anthropic.com'
                        : 'https://api.openai.com/v1'
                  "
                  @change="
                    updateAiPatching({
                      baseUrl: ($event.target as HTMLInputElement).value.trim(),
                    })
                  "
                />
              </Label>
              <Label class="settings__field">
                <span>{{ $t("settings.model") }}</span>
                <input
                  class="settings__input"
                  :value="aiConfig.chatModel"
                  @change="
                    updateAiPatching({
                      chatModel: ($event.target as HTMLInputElement).value.trim(),
                    })
                  "
                />
              </Label>
              <template v-if="aiConfig.provider !== 'ollama'">
                <Label class="settings__field">
                  <span>{{ $t("settings.apiKey") }}</span>
                  <input
                    class="settings__input"
                    type="password"
                    :value="aiKeys.openai ?? aiKeys.anthropic ?? ''"
                    :placeholder="aiConfig.provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'"
                    @change="onAiKeyChange"
                  />
                </Label>
              </template>
              <p class="settings__hint">{{ $t("settings.keysHint") }}</p>
            </template>
          </section>
        </section>
        <section v-show="activeTab === 'search'" class="settings__tabpanel">
          <section class="settings__section">
            <h4 class="settings__heading">Search</h4>
            <UiSwitch
              :model-value="props.store.getSearchSettings().semantic"
              :label="$t('settings.semantic')"
              @update:model-value="toggleSemantic"
            />
            <p class="settings__hint">
              <template v-if="searchStatus">
                Index: {{ searchStatus.docs }} pages · {{ searchStatus.blocks }} blocks ·
                {{ searchStatus.mode === "opfs" ? "persistent" : "in-memory (no OPFS/isolation)" }}
                <template v-if="searchStatus.semantic"> · {{ searchModelLabel }}</template>
              </template>
              <template v-else>Index is starting...</template>
            </p>
            <p v-if="searchStatus?.semantic && !searchStatus.vecReady" class="settings__error">
              {{ $t("settings.searchNoVec") }}
            </p>
            <p v-if="searchStatus?.indexError" class="settings__error">
              {{ $t("settings.searchIndexError", { error: searchStatus.indexError }) }}
            </p>
            <button type="button" class="button button--small" @click="onRebuildIndex">
              Rebuild
            </button>
          </section>
        </section>
        <section v-show="activeTab === 'sync'" class="settings__tabpanel">
          <section class="settings__section">
            <h4 class="settings__heading">Sync</h4>

            <template v-if="atprotoReady && atproto">
              <template v-if="!atprotoStatus.signedIn">
                <p class="settings__hint">
                  Sign in with an atproto account to attach a space. The workspace keeps working
                  offline; signing in only adds sync between devices.
                </p>
                <div class="settings__row">
                  <input
                    v-model="signInIdentifier"
                    class="settings__input settings__input--grow"
                    :placeholder="$t('settings.syncSignInPlaceholder')"
                    @keydown.enter="onSignIn"
                  />
                  <button
                    type="button"
                    class="button button--primary"
                    :disabled="signInBusy || !signInIdentifier.trim()"
                    @click="onSignIn"
                  >
                    Sign in
                  </button>
                </div>
              </template>

              <template v-else>
                <p class="settings__ok">
                  {{
                    $t("settings.signedInAs", {
                      did: shortDid(atprotoStatus.did),
                    })
                  }}
                </p>
                <p class="settings__hint">
                  {{
                    $t("settings.syncStatus", {
                      pending: atprotoStatus.pendingUpdates
                        ? $t("settings.syncExporting")
                        : atprotoStatus.pendingUpdates,
                      exported: appLocale.formatAgo(atprotoStatus.lastExportAt),
                      imported: appLocale.formatAgo(atprotoStatus.lastImportAt),
                    })
                  }}
                </p>
                <p class="settings__hint" :class="{ settings__error: atprotoStatus.error }">
                  {{ atprotoStatus.error ?? $t("settings.syncPlaintext") }}
                </p>

                <div v-if="atprotoStatus.members.length" class="settings__members">
                  <p class="settings__hint">{{ $t("settings.syncMembers") }}</p>
                  <ul>
                    <li v-for="member in atprotoStatus.members" :key="member.did">
                      {{ shortDid(member.did) }}
                    </li>
                  </ul>
                </div>

                <button type="button" class="button" :disabled="!atprotoReady" @click="onSignOut">
                  {{ $t("settings.syncSignOut") }}
                </button>
              </template>

              <p v-if="signInError" class="settings__error">
                {{ signInError }}
              </p>
              <!-- <p v-if="!atprotoStatus.relayConnected" class="settings__hint">
                {{ $t("settings.syncRelayOff") }}
              </p> -->
            </template>
            <p v-else class="settings__hint">
              {{ $t("settings.syncRequiresServer") }}
            </p>
          </section>
        </section>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
.settings__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem;
  padding: 0.15rem;
  margin-bottom: 0.75rem;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
}

.settings__tab {
  padding: 0.25rem 0.55rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: 0.35rem;
  cursor: pointer;
}

.settings__tab:hover {
  color: var(--color-text);
}

.settings__tab--active {
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.settings__tabpanel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.settings__section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.settings__heading {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
}

.settings__textarea {
  resize: vertical;
  min-height: 8rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.settings__row {
  display: flex;
  gap: 0.5rem;
}

.settings__input--grow {
  flex: 1;
  min-width: 0;
}

.settings__members {
  margin: 0;
}

.settings__members ul {
  margin: 0.25rem 0 0;
  padding-left: 1rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.settings__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.settings__field > span {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.settings__input {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.35rem;
  background: var(--color-surface);
  color: inherit;
  font-size: 0.9rem;
}

.settings__divider {
  height: 1px;
  background: var(--color-border);
  margin: 0.75rem 0;
}

.settings__hint {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.settings__storage {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: space-between;
}

.settings__storage-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.settings__storage-label {
  font-size: 0.9rem;
}

.settings__storage-path {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14rem;
}

.settings__ok {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--color-ok);
}

.settings__error {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--color-danger);
}

/* Theme cards: swatch trio + name, selected by border and check. */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.4rem;
}

.theme-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  font-family: inherit;
  font-size: 0.82rem;
  text-align: left;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  cursor: pointer;
}

.theme-card:hover {
  border-color: var(--color-border-strong);
}

.theme-card--active {
  border-color: var(--color-accent);
  box-shadow: inset 0 0 0 1px var(--color-accent);
}

.theme-card__swatches {
  display: flex;
  gap: 0.2rem;
}

.theme-card__dot {
  width: 1.1rem;
  height: 1.1rem;
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: 0.3rem;
}

.theme-card__label {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Custom palette editor: one row per token with a native color picker. */
.palette-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.3rem 0.6rem;
  padding: 0.5rem;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
}

.palette-token {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.palette-token__swatch {
  flex: none;
  width: 1.1rem;
  height: 1.1rem;
  border: 1px solid var(--color-border);
  border-radius: 0.3rem;
}

.palette-token__label {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-token__input {
  flex: none;
  width: 5rem;
  padding: 0.15rem 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0.25rem;
}

.palette-token__input:hover {
  border-color: var(--color-border);
}

.palette-token__input:focus {
  background: var(--color-surface);
  border-color: var(--color-border-strong);
}
</style>
