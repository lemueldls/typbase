<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type {
  SpellcheckMode,
  ThemeMode,
  ThemePaletteToken,
  ThemePaletteTokens,
  UiDensity,
  UiRadius,
  UiSize,
  WorkspaceSettings,
} from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { isTauri } from "@typbase/storage";
import { THEME_PALETTE_TOKEN_KEYS } from "@typbase/typing";

import type { SelectOption } from "~/components/ui/Select.vue";

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
// UiSelect drives the settings selects; each computed maps to a store write.
const localeOptions = computed<SelectOption[]>(() => [
  { value: "auto", label: t("settings.languageAuto") },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "zh", label: "中文" },
]);

const localeSetting = computed({
  get: () => settings.value.locale ?? "auto",
  set: (value: string) => appLocale.set(value),
});

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

// Selects run through UiSelect, so each setting gets an options list and a
// writable computed instead of a change-event handler.
const spellcheckOptions = computed<SelectOption[]>(() => [
  { value: "off", label: t("settings.spellcheckOff") },
  { value: "native", label: t("settings.spellcheckNative") },
  { value: "harper", label: t("settings.spellcheckHarper") },
]);

const spellcheck = computed({
  get: () => settings.value.spellcheck ?? "off",
  set: (value: string) => props.store.updateSettings({ spellcheck: value as SpellcheckMode }),
});

const notebookAutoRun = computed({
  get: () => settings.value.notebook?.autoRun ?? true,
  set: (value: boolean) =>
    props.store.updateSettings({
      notebook: { ...settings.value.notebook, autoRun: value },
    }),
});

const notebookCounters = computed({
  get: () => settings.value.notebook?.showCounters ?? true,
  set: (value: boolean) =>
    props.store.updateSettings({
      notebook: { ...settings.value.notebook, showCounters: value },
    }),
});

const themeModeOptions = computed<SelectOption[]>(() => [
  { value: "auto", label: t("settings.auto") },
  { value: "light", label: t("settings.light") },
  { value: "dark", label: t("settings.dark") },
]);

const themeMode = computed({
  get: () => settings.value.theme ?? "auto",
  set: (mode: string) => {
    props.store.updateSettings({ theme: mode as ThemeMode });
    applyTheme(props.store.getSettings());
    bumpRenderRevision();
  },
});

const uiSizeOptions = computed<SelectOption[]>(() => [
  { value: "small", label: t("settings.uiSizeSmall") },
  { value: "default", label: t("settings.uiSizeDefault") },
  { value: "large", label: t("settings.uiSizeLarge") },
]);

const uiSize = computed({
  get: () => settings.value.uiSize ?? "default",
  set: (value: string) => {
    props.store.updateSettings({ uiSize: value as UiSize });
    applyTheme(props.store.getSettings());
  },
});

const uiDensityOptions = computed<SelectOption[]>(() => [
  { value: "compact", label: t("settings.uiDensityCompact") },
  { value: "default", label: t("settings.uiDensityDefault") },
  { value: "spacious", label: t("settings.uiDensitySpacious") },
]);

const uiDensity = computed({
  get: () => settings.value.uiDensity ?? "default",
  set: (value: string) => {
    props.store.updateSettings({ uiDensity: value as UiDensity });
    applyTheme(props.store.getSettings());
  },
});

const uiRadiusOptions = computed<SelectOption[]>(() => [
  { value: "square", label: t("settings.uiRadiusSquare") },
  { value: "default", label: t("settings.uiRadiusDefault") },
  { value: "round", label: t("settings.uiRadiusRound") },
]);

const uiRadius = computed({
  get: () => settings.value.uiRadius ?? "default",
  set: (value: string) => {
    props.store.updateSettings({ uiRadius: value as UiRadius });
    applyTheme(props.store.getSettings());
  },
});

/** Current value first, so a configured font stays visible before it loads. */
function fontOptionList(families: string[], current: string | null | undefined): SelectOption[] {
  const values = [...new Set([...(current ? [current] : []), ...families])];

  return values.map((family) => ({ value: family, label: family }));
}

const textFontOptions = computed(() =>
  fontOptionList(systemFontOptions.value.text, settings.value.font),
);

const textFont = computed({
  get: () => settings.value.font,
  set: (value: string) => void updateFont({ font: value }),
});

const mathFontOptions = computed<SelectOption[]>(() => [
  { value: "same", label: t("settings.sameAsText") },
  ...fontOptionList(systemFontOptions.value.math, settings.value.mathFont),
]);

const mathFont = computed({
  get: () => settings.value.mathFont ?? "same",
  set: (value: string) => void updateFont({ mathFont: value === "same" ? null : value }),
});

const codeFontOptions = computed<SelectOption[]>(() => [
  { value: "same", label: t("settings.sameAsText") },
  ...fontOptionList(systemFontOptions.value.code, settings.value.codeFont),
]);

const codeFont = computed({
  get: () => settings.value.codeFont ?? "same",
  set: (value: string) => void updateFont({ codeFont: value === "same" ? null : value }),
});

const providerOptions: SelectOption[] = [
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "anthropic", label: "Anthropic" },
];

const aiProvider = computed({
  get: () => aiConfig.value.provider,
  set: (provider: string) => updateAiPatching({ provider }),
});

const textSize = computed<number | null>({
  get: () => settings.value.textSize,
  set: (size) => {
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return;

    props.store.updateSettings({ textSize: size });
    // Push the size into the wasm space context before the render revision
    // triggers recompiles; the structure-change echo re-applies it anyway.
    void applyWorkspaceStyleToTypst(workspaceId.value, props.store).then(() => {
      bumpRenderRevision();
    });
  },
});

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

function formatAgo(timestamp: number): string {
  if (!timestamp) return t("settings.syncNever");

  return appLocale.formatAgo(timestamp);
}

function shortDid(did: string | null): string {
  if (!did) return "";

  return did.length > 18 ? `${did.slice(0, 10)}...${did.slice(-6)}` : did;
}

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
            <UiSelect
              v-model="localeSetting"
              :options="localeOptions"
              :label="$t('settings.language')"
            />
          </Label>

          <div class="settings__field">
            <span>{{ $t("settings.storage") }}</span>
            <div class="settings__storage">
              <span class="settings__storage-info">
                <span class="settings__storage-label">{{ storageLocation.label }}</span>
                <UiTruncatedText
                  v-if="storageLocation.path"
                  class="settings__storage-path"
                  :text="storageLocation.path"
                />
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
            <UiSelect
              v-model="spellcheck"
              :options="spellcheckOptions"
              :label="$t('settings.spellcheck')"
            />
            <span class="settings__hint">{{ $t("settings.spellcheckHint") }}</span>
          </Label>

          <section class="settings__section">
            <h4 class="settings__heading">{{ $t("settings.notebook") }}</h4>
            <div class="settings__field">
              <UiSwitch
                v-model="notebookAutoRun"
                :label="$t('settings.notebookAutoRun')"
                :aria-label="$t('settings.notebookAutoRun')"
              />
              <span class="settings__hint">{{ $t("settings.notebookAutoRunHint") }}</span>
            </div>
            <div class="settings__field">
              <UiSwitch
                v-model="notebookCounters"
                :label="$t('settings.notebookCounters')"
                :aria-label="$t('settings.notebookCounters')"
              />
              <span class="settings__hint">{{ $t("settings.notebookCountersHint") }}</span>
            </div>
          </section>
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
            <UiSelect
              v-model="themeMode"
              :options="themeModeOptions"
              :label="$t('settings.themeMode')"
            />
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
            <span>{{ $t("settings.uiSize") }}</span>
            <UiSelect v-model="uiSize" :options="uiSizeOptions" :label="$t('settings.uiSize')" />
            <span class="settings__hint">{{ $t("settings.uiSizeHint") }}</span>
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.uiDensity") }}</span>
            <UiSelect
              v-model="uiDensity"
              :options="uiDensityOptions"
              :label="$t('settings.uiDensity')"
            />
            <span class="settings__hint">{{ $t("settings.uiDensityHint") }}</span>
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.uiRadius") }}</span>
            <UiSelect
              v-model="uiRadius"
              :options="uiRadiusOptions"
              :label="$t('settings.uiRadius')"
            />
            <span class="settings__hint">{{ $t("settings.uiRadiusHint") }}</span>
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.textSize") }}</span>
            <UiNumberField
              v-model="textSize"
              :min="8"
              :max="72"
              :step="1"
              :label="$t('settings.textSize')"
            />
            <span class="settings__hint">{{ $t("settings.textSizeHint") }}</span>
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.textFont") }}</span>
            <UiSelect
              v-model="textFont"
              :options="textFontOptions"
              :label="$t('settings.textFont')"
            />
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.mathFont") }}</span>
            <UiSelect
              v-model="mathFont"
              :options="mathFontOptions"
              :label="$t('settings.mathFont')"
            />
          </Label>

          <Label class="settings__field">
            <span>{{ $t("settings.codeFont") }}</span>
            <UiSelect
              v-model="codeFont"
              :options="codeFontOptions"
              :label="$t('settings.codeFont')"
            />
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
                <UiSelect
                  v-model="aiProvider"
                  :options="providerOptions"
                  :label="$t('settings.provider')"
                />
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
  gap: var(--space-0-5);
  padding: var(--space-0-5);
  margin-bottom: var(--space-3);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.settings__tab {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
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
  gap: var(--space-2);
}

.settings__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.settings__heading {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.settings__textarea {
  resize: vertical;
  min-height: 8rem;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.settings__row {
  display: flex;
  gap: var(--space-2);
}

.settings__input--grow {
  flex: 1;
  min-width: 0;
}

.settings__members {
  margin: 0;
}

.settings__members ul {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.settings__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
}

.settings__field > span {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.settings__input {
  padding: var(--space-1-5) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: inherit;
  font-size: var(--text-md);
}

.settings__divider {
  height: 1px;
  background: var(--color-border);
  margin: var(--space-3) 0;
}

.settings__hint {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.settings__storage {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  justify-content: space-between;
}

.settings__storage-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  min-width: 0;
}

.settings__storage-label {
  font-size: var(--text-md);
}

.settings__storage-path {
  max-width: 14rem;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.settings__ok {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--color-ok);
}

.settings__error {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}

/* Theme cards: swatch trio + name, selected by border and check. */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: var(--space-1-5);
}

.theme-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  padding: var(--space-2);
  font-family: inherit;
  font-size: var(--text-sm);
  text-align: left;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
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
  gap: var(--space-1);
}

.theme-card__dot {
  width: 1.1rem;
  height: 1.1rem;
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: var(--radius-xs);
}

.theme-card__label {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Custom palette editor: one row per token with a color swatch, name, and
   value field. ColorSwatch paints through --reka-color-swatch-color; the
   checkerboard below it shows through translucent values. */
.palette-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.palette-token {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 6.5rem;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-xs);
}

.palette-token__swatch {
  width: 1.25rem;
  height: 1.25rem;
  flex: none;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xs);
  background-image:
    linear-gradient(
      var(--reka-color-swatch-color, transparent),
      var(--reka-color-swatch-color, transparent)
    ),
    repeating-conic-gradient(var(--color-border) 0% 25%, transparent 0% 50%);
  background-size:
    auto,
    8px 8px;
}

.palette-token__label {
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-token__input {
  width: 100%;
  padding: var(--space-0-5) var(--space-1-5);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
}

.palette-token__input:hover {
  border-color: var(--color-border-strong);
}

.palette-token__input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}
</style>
