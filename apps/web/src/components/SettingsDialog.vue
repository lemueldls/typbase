<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type {
  AiProviderSettings,
  AiSettings,
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

import { getAiKeys, setAiKey } from "~/lib/ai/keys";
import { normalizeDictionaryWords } from "~/lib/spellcheckSettings";
import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";
import { CUSTOM_THEME_ID, resolveTheme, THEMES } from "~/lib/themes";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const {
  dataRevision,
  workspaceId,
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

const {
  channel: updateChannel,
  status: updateStatus,
  info: updateInfo,
  check: checkForUpdates,
} = useAppUpdates();

const updateHint = computed(() => {
  if (updateChannel.value === "android-play") return t("updates.playHint");
  if (updateChannel.value === "desktop-package-managed") return t("updates.packageManaged");
  return t("updates.checkHint");
});

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

// AI providers and behavior (see the AI panel below); keys stay device-local.

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

/** Settings tab ids; each one maps to a panel below. */
type SettingsTab = "general" | "content" | "appearance" | "publish" | "ai" | "sync" | "export";

/** Section rail. Icons carry the scan on phones, where labels can truncate. */
const tabs: Array<{ id: SettingsTab; icon: MaterialSymbol; label: string }> = [
  { id: "general", icon: "settings", label: "settings.tabGeneral" },
  { id: "content", icon: "description", label: "settings.tabContent" },
  { id: "appearance", icon: "palette", label: "settings.tabAppearance" },
  // { id: "ai", icon: "psychology", label: "settings.tabAi" },
  { id: "publish", icon: "public", label: "settings.tabPublish" },
  { id: "export", icon: "folder_zip", label: "settings.tabExport" },
  { id: "sync", icon: "sync", label: "settings.tabSync" },
];

const activeTab = ref<SettingsTab>("general");
const open = ref(false);

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

// The dictionary textarea is one word per line and commits on change, like the
// template and prelude fields. `normalizeDictionaryWords` dedupes what it
// writes, so the textarea echo settles on the stored list.
function onDictionaryChange(event: Event) {
  const words = normalizeDictionaryWords((event.target as HTMLTextAreaElement).value.split("\n"));
  props.store.updateSettings({ spellcheckWords: words });
}

function removeIgnoredLint(hash: string) {
  props.store.updateSettings({
    spellcheckIgnoredLints: settings.value.spellcheckIgnoredLints.filter(
      (entry) => entry.hash !== hash,
    ),
  });
}

function clearIgnoredLints() {
  props.store.updateSettings({ spellcheckIgnoredLints: [] });
}

const notebookCounters = computed({
  get: () => settings.value.notebook?.showCounters ?? true,
  set: (value: boolean) =>
    props.store.updateSettings({
      notebook: { ...settings.value.notebook, showCounters: value },
    }),
});

// Display-only editor options; the pane reconfigures them in place.
const editorLineNumbers = computed({
  get: () => settings.value.editor?.lineNumbers ?? false,
  set: (value: boolean) =>
    props.store.updateSettings({
      editor: { ...settings.value.editor, lineNumbers: value },
    }),
});

const editorScrollPastEnd = computed({
  get: () => settings.value.editor?.scrollPastEnd ?? false,
  set: (value: boolean) =>
    props.store.updateSettings({
      editor: { ...settings.value.editor, scrollPastEnd: value },
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

const aiKindOptions: SelectOption[] = [
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "anthropic", label: "Anthropic" },
];

const aiSettings = computed(() => {
  void dataRevision.value;

  return props.store.getAiSettings();
});
const aiProviders = computed(() => {
  void dataRevision.value;

  return aiSettings.value.providers;
});

/** Provider being edited in the panel; follows the list when it changes. */
const activeProviderId = ref("");
watch(
  aiProviders,
  (list) => {
    if (!list.some((provider) => provider.id === activeProviderId.value)) {
      activeProviderId.value = list[0]?.id ?? "";
    }
  },
  { immediate: true },
);

const activeProvider = computed(
  () => aiProviders.value.find((provider) => provider.id === activeProviderId.value) ?? null,
);

const aiKeys = ref(getAiKeys());
const activeKey = computed(() =>
  activeProvider.value ? (aiKeys.value[activeProvider.value.id] ?? "") : "",
);

function updateAiSettings(patch: Partial<AiSettings>): void {
  props.store.updateSettings({ ai: { ...aiSettings.value, ...patch } });
}

function updateAiProvider(patch: Partial<AiProviderSettings>): void {
  const provider = activeProvider.value;
  if (!provider) return;

  updateAiSettings({
    providers: aiProviders.value.map((entry) =>
      entry.id === provider.id ? { ...entry, ...patch } : entry,
    ),
  });
}

function addAiProvider(): void {
  const provider: AiProviderSettings = {
    id: `provider-${Date.now().toString(36)}`,
    name: "New provider",
    kind: "openai-compatible",
    baseUrl: "",
    model: "gpt-4o-mini",
  };
  updateAiSettings({
    providers: [...aiProviders.value, provider],
    defaultProviderId: aiSettings.value.defaultProviderId ?? provider.id,
  });
  activeProviderId.value = provider.id;
}

function removeAiProvider(): void {
  const provider = activeProvider.value;
  if (!provider) return;

  const providers = aiProviders.value.filter((entry) => entry.id !== provider.id);
  updateAiSettings({
    providers,
    defaultProviderId:
      aiSettings.value.defaultProviderId === provider.id
        ? (providers[0]?.id ?? null)
        : aiSettings.value.defaultProviderId,
  });
}

function onAiKeyChange(event: Event): void {
  if (!activeProvider.value) return;

  setAiKey(activeProvider.value.id, (event.target as HTMLInputElement).value);
  aiKeys.value = getAiKeys();
}

function baseUrlPlaceholder(kind: string): string {
  if (kind === "ollama") return "http://localhost:11434";
  if (kind === "anthropic") return "https://api.anthropic.com";

  return "https://api.openai.com/v1";
}

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

onMounted(() => {
  applyTheme(props.store.getSettings());
});

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
  <UiDialog v-model:open="open" class="settings-dialog" :title="$t('settings.title')">
    <template v-if="$slots.default" #trigger>
      <slot />
    </template>

    <div class="settings">
      <nav class="settings__nav" :aria-label="$t('settings.title')">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="settings__tab"
          :data-tab="tab.id"
          :class="{ 'settings__tab--active': activeTab === tab.id }"
          :aria-current="activeTab === tab.id ? 'true' : undefined"
          @click="activeTab = tab.id"
        >
          <MsIcon :name="tab.icon" :size="18" />
          <span class="settings__tab-label">{{ $t(tab.label) }}</span>
        </button>
      </nav>

      <div class="settings__panels">
        <section v-show="activeTab === 'general'" class="settings__tabpanel">
          <Label class="settings__field">
            <span>{{ $t("settings.name") }}</span>
            <UiTextField :value="settings.name" @change="renameWorkspace" />
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
              <UiButton @click="openStorageSetup">
                {{ $t("settings.changeStorage") }}
              </UiButton>
            </div>
            <!-- <span class="settings__hint">{{ $t("settings.storageHint") }}</span> -->
          </div>

          <div v-if="updateChannel !== 'unsupported'" class="settings__field">
            <span>{{ $t("updates.title") }}</span>
            <div class="settings__storage">
              <span class="settings__storage-info">
                <span class="settings__storage-label">
                  {{
                    updateStatus === "available" && updateInfo?.version
                      ? $t("updates.available", { version: updateInfo.version })
                      : updateHint
                  }}
                </span>
              </span>
              <UiButton
                v-if="updateChannel !== 'desktop-package-managed'"
                :disabled="updateStatus === 'checking'"
                @click="checkForUpdates()"
              >
                {{ updateStatus === "checking" ? $t("updates.checking") : $t("updates.check") }}
              </UiButton>
            </div>
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

          <Label v-if="spellcheck === 'harper'" class="settings__field">
            <span>{{ $t("settings.spellcheckDictionary") }}</span>
            <textarea
              class="settings__input settings__textarea settings__textarea--dictionary"
              :value="settings.spellcheckWords.join('\n')"
              rows="4"
              spellcheck="false"
              :placeholder="$t('settings.spellcheckDictionaryPlaceholder')"
              @change="onDictionaryChange"
            />
            <span class="settings__hint">{{ $t("settings.spellcheckDictionaryHint") }}</span>
          </Label>
          <span v-else-if="spellcheck === 'native'" class="settings__hint">
            {{ $t("settings.spellcheckDictionaryNative") }}
          </span>

          <div
            v-if="spellcheck === 'harper' && settings.spellcheckIgnoredLints.length"
            class="settings__field"
          >
            <span>
              {{
                $t("settings.spellcheckIgnored", {
                  count: settings.spellcheckIgnoredLints.length,
                })
              }}
            </span>
            <ul class="settings__ignored">
              <li
                v-for="entry in settings.spellcheckIgnoredLints"
                :key="entry.hash"
                class="settings__ignored-row"
              >
                <span class="settings__ignored-text">
                  <span class="settings__ignored-quote">“{{ entry.text }}”</span>
                  <span class="settings__ignored-message">{{ entry.message }}</span>
                </span>
                <UiIconButton
                  icon="close"
                  :label="$t('settings.spellcheckIgnoredRemove')"
                  variant="ghost"
                  :size="16"
                  @click="removeIgnoredLint(entry.hash)"
                />
              </li>
            </ul>
            <UiButton size="small" @click="clearIgnoredLints">
              {{ $t("settings.spellcheckIgnoredClear") }}
            </UiButton>
            <span class="settings__hint">{{ $t("settings.spellcheckIgnoredHint") }}</span>
          </div>

          <section class="settings__section">
            <h4 class="settings__heading">{{ $t("settings.notebook") }}</h4>
            <div class="settings__field">
              <UiSwitch
                v-model="notebookCounters"
                :label="$t('settings.notebookCounters')"
                :aria-label="$t('settings.notebookCounters')"
              />
              <span class="settings__hint">{{ $t("settings.notebookCountersHint") }}</span>
            </div>
          </section>

          <section class="settings__section">
            <h4 class="settings__heading">{{ $t("settings.editor") }}</h4>
            <div class="settings__field">
              <UiSwitch
                v-model="editorLineNumbers"
                :label="$t('settings.editorLineNumbers')"
                :aria-label="$t('settings.editorLineNumbers')"
              />
              <span class="settings__hint">{{ $t("settings.editorLineNumbersHint") }}</span>
            </div>
            <div class="settings__field">
              <UiSwitch
                v-model="editorScrollPastEnd"
                :label="$t('settings.editorScrollPastEnd')"
                :aria-label="$t('settings.editorScrollPastEnd')"
              />
              <span class="settings__hint">{{ $t("settings.editorScrollPastEndHint") }}</span>
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
              <UiButton
                variant="primary"
                v-if="!systemFontsLoaded"
                :disabled="systemFontsLoading"
                @click="installSystemFonts"
              >
                {{ systemFontsLoading ? "Loading..." : "Load system fonts" }}
              </UiButton>
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
              <UiTextField
                :value="publishLangs"
                placeholder="en, de"
                @change="publishLangs = ($event.target as HTMLInputElement).value"
              />
            </Label>
            <Label class="settings__field">
              <span>{{ $t("settings.tags") }}</span>
              <UiTextField
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
            <h4 class="settings__heading">{{ $t("settings.tabAi") }}</h4>
            <UiSwitch
              :model-value="aiSettings.enabled"
              :label="$t('settings.aiEnable')"
              @update:model-value="(value) => updateAiSettings({ enabled: value })"
            />
            <p class="settings__hint">{{ $t("settings.aiHint") }}</p>

            <template v-if="aiSettings.enabled">
              <Label class="settings__field">
                <span>{{ $t("settings.provider") }}</span>
                <div class="settings__row">
                  <UiSelect
                    v-if="aiProviders.length"
                    v-model="activeProviderId"
                    :options="
                      aiProviders.map((provider) => ({
                        value: provider.id,
                        label: provider.name,
                      }))
                    "
                    :label="$t('settings.provider')"
                  />
                  <UiButton size="small" @click="addAiProvider">
                    {{ $t("settings.addProvider") }}
                  </UiButton>
                  <UiButton
                    v-if="aiProviders.length > 1"
                    size="small"
                    variant="danger"
                    @click="removeAiProvider"
                  >
                    {{ $t("settings.removeProvider") }}
                  </UiButton>
                </div>
              </Label>

              <template v-if="activeProvider">
                <Label class="settings__field">
                  <span>{{ $t("settings.providerName") }}</span>
                  <UiTextField
                    :value="activeProvider.name"
                    @change="
                      updateAiProvider({
                        name: ($event.target as HTMLInputElement).value.trim() || 'Provider',
                      })
                    "
                  />
                </Label>
                <Label class="settings__field">
                  <span>{{ $t("settings.providerKind") }}</span>
                  <UiSelect
                    :model-value="activeProvider.kind"
                    :options="aiKindOptions"
                    :label="$t('settings.providerKind')"
                    @update:model-value="
                      (value) => updateAiProvider({ kind: value as AiProviderSettings['kind'] })
                    "
                  />
                </Label>
                <Label class="settings__field">
                  <span>{{ $t("settings.baseUrl") }}</span>
                  <UiTextField
                    :value="activeProvider.baseUrl"
                    :placeholder="baseUrlPlaceholder(activeProvider.kind)"
                    @change="
                      updateAiProvider({
                        baseUrl: ($event.target as HTMLInputElement).value.trim(),
                      })
                    "
                  />
                </Label>
                <Label class="settings__field">
                  <span>{{ $t("settings.model") }}</span>
                  <UiTextField
                    :value="activeProvider.model"
                    @change="
                      updateAiProvider({
                        model: ($event.target as HTMLInputElement).value.trim(),
                      })
                    "
                  />
                </Label>
                <Label v-if="activeProvider.kind !== 'ollama'" class="settings__field">
                  <span>{{ $t("settings.apiKey") }}</span>
                  <UiTextField
                    type="password"
                    :value="activeKey"
                    :placeholder="activeProvider.kind === 'anthropic' ? 'sk-ant-...' : 'sk-...'"
                    @change="onAiKeyChange"
                  />
                </Label>
                <p class="settings__hint">{{ $t("settings.keysHint") }}</p>
              </template>

              <Label class="settings__field">
                <span>{{ $t("settings.defaultProvider") }}</span>
                <UiSelect
                  :model-value="aiSettings.defaultProviderId ?? ''"
                  :options="
                    aiProviders.map((provider) => ({
                      value: provider.id,
                      label: provider.name,
                    }))
                  "
                  :label="$t('settings.defaultProvider')"
                  @update:model-value="(value) => updateAiSettings({ defaultProviderId: value })"
                />
              </Label>

              <UiSwitch
                :model-value="aiSettings.liveRender"
                :label="$t('settings.aiLiveRender')"
                @update:model-value="(value) => updateAiSettings({ liveRender: value })"
              />
              <UiSwitch
                :model-value="aiSettings.pageContext"
                :label="$t('settings.aiPageContext')"
                @update:model-value="(value) => updateAiSettings({ pageContext: value })"
              />
              <UiSwitch
                :model-value="aiSettings.tools"
                :label="$t('settings.aiTools')"
                @update:model-value="(value) => updateAiSettings({ tools: value })"
              />
              <Label class="settings__field">
                <span>{{ $t("settings.aiRepairAttempts") }}</span>
                <UiNumberField
                  :model-value="aiSettings.repairAttempts"
                  :label="$t('settings.aiRepairAttempts')"
                  :min="0"
                  :max="5"
                  @update:model-value="(value) => updateAiSettings({ repairAttempts: value ?? 0 })"
                />
              </Label>
            </template>
          </section>
        </section>
        <section v-show="activeTab === 'sync'" class="settings__tabpanel">
          <SyncPanel />
        </section>

        <section v-show="activeTab === 'export'" class="settings__tabpanel">
          <WorkspaceExportPanel v-if="store" :store="store" />
        </section>
      </div>
    </div>

    <div class="settings__close">
      <UiIconButton
        icon="close"
        variant="ghost"
        :label="$t('common.close')"
        @click="open = false"
      />
    </div>
  </UiDialog>
</template>

<style>
/* Roomy dialog with a section rail instead of a popover. */
.settings-dialog {
  display: flex;
  flex-direction: column;
  width: min(56rem, calc(100vw - var(--space-8)));
  height: min(46rem, calc(100dvh - var(--space-16)));
  padding: var(--space-5);
  overflow: hidden;
}

@media (max-width: 48rem) {
  .settings-dialog {
    width: calc(100vw - var(--space-8) - var(--safe-left) - var(--safe-right));
    height: calc(100dvh - var(--space-16) - var(--safe-top) - var(--safe-bottom));
    padding: var(--space-4);
  }
}

.settings {
  display: grid;
  grid-template-columns: 13rem minmax(0, 1fr);
  gap: var(--space-2);
  flex: 1 1 auto;
  min-height: 0;
}

.settings__nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  min-height: 0;
  padding-right: var(--space-3);
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
}

.settings__tab {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  font-family: inherit;
  font-size: var(--text-md);
  text-align: left;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.settings__tab:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.settings__tab--active {
  color: var(--color-text);
  background: var(--color-surface-2);
  font-weight: 600;
}

.settings__tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings__panels {
  min-height: 0;
  padding-right: var(--space-1);
  overflow-y: auto;
}

.settings__close {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
}

/* Narrow windows and phones: the rail becomes an even two-column grid, and
   the odd last section spans the row. */
@media (max-width: 48rem) {
  .settings {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .settings__nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1);
    padding-right: 0;
    padding-bottom: var(--space-4);
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    overflow: visible;
  }

  .settings__nav > .settings__tab {
    justify-content: center;
  }

  .settings__nav > .settings__tab:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
}

.settings__tabpanel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 var(--space-2);
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

/* Word lists do not need the daily template's height. */
.settings__textarea--dictionary {
  min-height: 5rem;
}

/* Ignored lints: one row per silenced lint, removable individually. */
.settings__ignored {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.settings__ignored-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-2);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.settings__ignored-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  min-width: 0;
  font-size: var(--text-sm);
}

.settings__ignored-quote {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.settings__ignored-message {
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
