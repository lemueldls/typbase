<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type {
  AiProviderSettings,
  AiSettings,
  EditorContentWidth,
  SpellcheckMode,
  SplitScrollMode,
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

import type { ComboboxOption } from "~/components/ui/Combobox.vue";
import type { SelectOption } from "~/components/ui/Select.vue";

import { BUNDLED_FONTS } from "~/composables/typst";
import { getAiKeys, setAiKey } from "~/lib/ai/keys";
import {
  fontFamilyOf,
  mergeCustomFont,
  missingFontFamilies,
  removeCustomFont,
} from "~/lib/customFonts";
import { openExternal } from "~/lib/openExternal";
import { normalizeDictionaryWords } from "~/lib/spellcheckSettings";
import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";
import { CUSTOM_THEME_ID, resolveTheme, THEMES } from "~/lib/themes";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const {
  workspaceId,
  workspaces,
  activeWorkspaceId,
  setWorkspaceIcon,
  storageLocation,
  openStorageSetup,
} = useWorkspace();

/** The active workspace's registry icon. The setter writes it through the registry. */
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
const shortcuts = useShortcutsDialog();

const {
  channel: updateChannel,
  manager: updateManager,
  status: updateStatus,
  info: updateInfo,
  check: checkForUpdates,
} = useAppUpdates();

const { visible: appBarVisible } = useAppBar();

const updateHint = computed(() => {
  if (updateChannel.value === "android-play") return t("updates.playHint");
  if (updateChannel.value === "desktop-package-managed") {
    return updateManager.value
      ? t("updates.packageManagedBy", { manager: updateManager.value.id })
      : t("updates.packageManaged");
  }
  return t("updates.checkHint");
});

const settings = useWorkspaceValue(
  () => props.store,
  ["settings"],
  (store) => store.getSettings(),
);

// Publish defaults (stored in workspace settings so they sync).
const publishDefaults = useWorkspaceValue(
  () => props.store,
  ["settings"],
  (store) => store.getPublishSettings(),
);
const publishLangs = computed({
  get: () => publishDefaults.value.langs,
  set: (langs: string[]) =>
    props.store.updateSettings({
      publish: {
        ...publishDefaults.value,
        langs,
      },
    }),
});
const publishTags = computed({
  get: () => publishDefaults.value.tags,
  set: (tags: string[]) =>
    props.store.updateSettings({
      publish: {
        ...publishDefaults.value,
        tags,
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

// AI providers and behavior (see the AI panel below). Keys stay device-local.

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
  // Apply immediately. The structure-change echo also refreshes, but the
  // editor should not wait on it.
  applyTheme(props.store.getSettings());
  bumpRenderRevision();
}

/** Draft palette while the custom editor is open. Null for named themes. */
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

/** Settings tab ids. Each one maps to a panel below. */
type SettingsTab = "general" | "appearance" | "editor" | "content" | "ai" | "sync" | "export";

/** Section rail. Icons carry the scan on phones, where labels can truncate. */
const tabs: Array<{ id: SettingsTab; icon: MaterialSymbol; label: string; keywords?: string }> = [
  {
    id: "general",
    icon: "settings",
    label: "settings.tabGeneral",
    keywords: "workspace name icon language storage updates project shortcuts",
  },
  {
    id: "appearance",
    icon: "palette",
    label: "settings.tabAppearance",
    keywords: "theme color colors dark light palette size density radius",
  },
  {
    id: "editor",
    icon: "edit_note",
    label: "settings.tabEditor",
    keywords: "editing wrap line numbers vim spellcheck spelling dictionary",
  },
  {
    id: "content",
    icon: "description",
    label: "settings.tabContent",
    keywords: "template daily note prelude publishing tags languages",
  },
  // {
  //   id: "ai",
  //   icon: "psychology",
  //   label: "settings.tabAi",
  //   keywords: "provider model api key chat",
  // },
  {
    id: "sync",
    icon: "sync",
    label: "settings.tabSync",
    keywords: "account Atmosphere sign in login publish",
  },
  {
    id: "export",
    icon: "folder_zip",
    label: "settings.tabExport",
    keywords: "download bundle html pdf svg project zip",
  },
];

const activeTab = ref<SettingsTab>("general");
/** A small palette for the common case; the full picker is one click away. */
const QUICK_ICONS: MaterialSymbol[] = [
  "folder",
  "home",
  "book",
  "school",
  "science",
  "lightbulb",
  "palette",
  "work",
];
const quickIcons = computed(() =>
  QUICK_ICONS.includes(workspaceIcon.value)
    ? QUICK_ICONS
    : [workspaceIcon.value, ...QUICK_ICONS.slice(0, 7)],
);
/** The full icon grid is tall, so it opens only when someone asks for it. */
const iconPickerOpen = ref(false);
/** Bindable so another surface (the app bar's File menu) can open it too. */
const open = defineModel<boolean>("open", { default: false });

// Search every rendered row. The panels stay mounted behind v-show, so the
// index is the DOM itself and a new setting is discoverable without a second
// list to update.
const searchQuery = ref("");
const settingsRoot = useTemplateRef<HTMLElement>("settingsRoot");
const searchField = useTemplateRef<{ focus: () => void }>("searchField");

type SearchHit =
  | { kind: "tab"; id: ""; tab: SettingsTab; label: string; hint: "" }
  | { kind: "section"; id: string; tab: SettingsTab; label: string; hint: string }
  | { kind: "row"; id: string; tab: SettingsTab; label: string; hint: string };

function tabFor(id: SettingsTab) {
  return tabs.find((tab) => tab.id === id);
}

function tabLabel(id: SettingsTab): string {
  const tab = tabFor(id);

  return tab ? t(tab.label) : "";
}

function tabIcon(id: SettingsTab): MaterialSymbol {
  return tabFor(id)?.icon ?? "settings";
}

const searchHits = computed<SearchHit[]>(() => {
  const needle = searchQuery.value.trim().toLocaleLowerCase();
  if (!needle) return [];

  const tabHits: SearchHit[] = tabs
    .filter((tab) => `${t(tab.label)} ${tab.keywords ?? ""}`.toLocaleLowerCase().includes(needle))
    .map((tab) => ({ kind: "tab", id: "", tab: tab.id, label: t(tab.label), hint: "" }));

  const sectionHits: SearchHit[] = [
    ...(settingsRoot.value?.querySelectorAll<HTMLElement>("[data-settings-section-id]") ?? []),
  ]
    .map((element) => {
      const label = element.dataset.settingsSectionLabel ?? "";
      const hint = element.dataset.settingsSectionHint ?? "";
      const panel = element.closest<HTMLElement>("[data-settings-tab]");

      return {
        kind: "section" as const,
        id: element.dataset.settingsSectionId ?? "",
        tab: (panel?.dataset.settingsTab ?? "general") as SettingsTab,
        label,
        hint,
        haystack: `${label} ${hint}`.toLocaleLowerCase(),
      };
    })
    .filter((hit) => hit.id && hit.label && hit.haystack.includes(needle));

  const rowHits: SearchHit[] = [
    ...(settingsRoot.value?.querySelectorAll<HTMLElement>("[data-settings-id]") ?? []),
  ]
    .map((element) => {
      const label = element.dataset.settingsLabel ?? "";
      const hint = element.dataset.settingsHint ?? "";
      const keywords = element.dataset.settingsKeywords ?? "";
      const panel = element.closest<HTMLElement>("[data-settings-tab]");

      return {
        kind: "row" as const,
        id: element.dataset.settingsId ?? "",
        tab: (panel?.dataset.settingsTab ?? "general") as SettingsTab,
        label,
        hint,
        haystack: `${label} ${hint} ${keywords}`.toLocaleLowerCase(),
      };
    })
    .filter((hit) => hit.id && hit.haystack.includes(needle))
    .sort(
      (a, b) =>
        Number(b.label.toLocaleLowerCase().includes(needle)) -
        Number(a.label.toLocaleLowerCase().includes(needle)),
    );

  return [...tabHits, ...sectionHits, ...rowHits];
});

async function openSearchHit(hit: SearchHit): Promise<void> {
  activeTab.value = hit.tab;
  searchQuery.value = "";
  await nextTick();

  if (hit.kind === "tab" || !hit.id) {
    document.querySelector<HTMLElement>(`.settings__tab[data-tab="${hit.tab}"]`)?.focus();
    return;
  }

  const element = document.getElementById(hit.id);
  if (!element) return;

  const flash = hit.kind === "section" ? "settings-section--flash" : "settings-row--flash";
  element.scrollIntoView({ block: "center" });
  element.focus({ preventScroll: true });
  element.classList.remove(flash);
  requestAnimationFrame(() => element.classList.add(flash));
  window.setTimeout(() => element.classList.remove(flash), 1300);
}

function onSearchEnter(): void {
  const first = searchHits.value[0];
  if (first) void openSearchHit(first);
}

function clearSearch(): void {
  searchQuery.value = "";
}

/** The first Escape clears the query; only an empty field closes the dialog. */
function onSearchEscape(event: KeyboardEvent): void {
  if (!searchQuery.value) return;

  event.preventDefault();
  event.stopPropagation();
  clearSearch();
}

function selectTab(id: SettingsTab): void {
  activeTab.value = id;
  searchQuery.value = "";
}

watch(open, (isOpen) => {
  if (!isOpen) searchQuery.value = "";
});

/** Project home, linked from the General tab. */
const PROJECT_URL = "https://github.com/lemueldls/typbase";

function openProject(): void {
  openExternal(PROJECT_URL);
}

function openProfile(did: string): void {
  open.value = false;
  void navigateTo(`/u/${did}`);
}

/** The shortcut list lives outside Settings; close this and show it. */
function openShortcuts(): void {
  open.value = false;
  shortcuts.show();
}

// Typst sources that drive page structure: the daily template placeholders
// (see WorkspaceStore.createDailyNote) and the workspace prelude appended to
// every compile. Both sync through settings like everything else.
// UiSelect drives the settings selects. Each computed maps to a store write.
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

function onDailyTemplateChange(value: string) {
  props.store.updateSettings({ dailyNoteTemplate: value });
}
function onPagePreludeChange(value: string) {
  props.store.updateSettings({ pagePrelude: value });
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

// Display-only editor options. The pane reconfigures them in place.
const editorLineNumbers = computed({
  get: () => settings.value.editor?.lineNumbers ?? false,
  set: (value: boolean) =>
    props.store.updateSettings({
      editor: { ...settings.value.editor, lineNumbers: value },
    }),
});

const editorSoftWrap = computed({
  get: () => settings.value.editor?.softWrap ?? true,
  set: (value: boolean) =>
    props.store.updateSettings({
      editor: { ...settings.value.editor, softWrap: value },
    }),
});

const editorScrollPastEnd = computed({
  get: () => settings.value.editor?.scrollPastEnd ?? false,
  set: (value: boolean) =>
    props.store.updateSettings({
      editor: { ...settings.value.editor, scrollPastEnd: value },
    }),
});

const editorVim = computed({
  get: () => settings.value.editor?.vim ?? false,
  set: (value: boolean) =>
    props.store.updateSettings({
      editor: { ...settings.value.editor, vim: value },
    }),
});

const editorSplitScrollOptions = computed<SelectOption[]>(() => [
  { value: "both", label: t("settings.editorSplitScrollBoth") },
  { value: "editor", label: t("settings.editorSplitScrollEditor") },
  { value: "preview", label: t("settings.editorSplitScrollPreview") },
  { value: "off", label: t("settings.editorSplitScrollOff") },
]);

const editorSplitScroll = computed({
  get: () => settings.value.editor?.splitScroll ?? "both",
  set: (value: string) =>
    props.store.updateSettings({
      editor: { ...settings.value.editor, splitScroll: value as SplitScrollMode },
    }),
});

const editorContentWidthOptions = computed<SelectOption[]>(() => [
  { value: "measure", label: t("settings.editorContentWidthMeasure") },
  { value: "full", label: t("settings.editorContentWidthFull") },
]);

const editorContentWidth = computed({
  get: () => settings.value.editor?.contentWidth ?? "measure",
  set: (value: string) =>
    props.store.updateSettings({
      editor: { ...settings.value.editor, contentWidth: value as EditorContentWidth },
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
function fontOptionList(families: string[], current: string | null | undefined): ComboboxOption[] {
  const values = [...new Set([...(current ? [current] : []), ...families])];
  const uploaded = new Set(settings.value.customFonts.map((font) => font.family));

  return values.map((family) => ({
    value: family,
    label: family,
    // The second line says where the family came from, which is the part a
    // long list cannot show.
    description: uploaded.has(family)
      ? t("settings.fontUploaded")
      : BUNDLED_FONTS.text.includes(family) || BUNDLED_FONTS.math.includes(family)
        ? t("settings.fontBundled")
        : undefined,
  }));
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

const aiSettings = useWorkspaceValue(
  () => props.store,
  ["settings"],
  (store) => store.getAiSettings(),
);
const aiProviders = computed(() => aiSettings.value.providers);

/** Provider being edited in the panel. Follows the list when it changes. */
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
    // triggers recompiles. The structure-change echo re-applies it anyway.
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

const fontUploadError = ref("");
const missingFonts = ref<string[]>([]);

async function refreshMissingFonts(): Promise<void> {
  missingFonts.value = await missingFontFamilies(props.store);
}

watch(
  () => settings.value.customFonts,
  () => void refreshMissingFonts(),
  { immediate: true },
);

/**
 * Stores each file as a blob and files it under the family the engine reads out
 * of the font itself. The user never types a family name, so a selection cannot
 * miss because it was spelled differently from the font.
 */
async function addFontFiles(files: File[]): Promise<void> {
  fontUploadError.value = "";
  if (!files.length) return;

  let fonts = props.store.getSettings().customFonts;
  const rejected: string[] = [];

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const family = fontFamilyOf(bytes);
    if (!family) {
      rejected.push(file.name);
      continue;
    }

    const entry = await props.store.putBlob(bytes);
    fonts = mergeCustomFont(fonts, family, entry.hash);
  }

  if (fonts !== props.store.getSettings().customFonts) {
    props.store.updateSettings({ customFonts: fonts });
  }
  if (rejected.length)
    fontUploadError.value = t("settings.fontUploadFailed", { names: rejected.join(", ") });
}

async function uploadFonts(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  await addFontFiles([...(input.files ?? [])]);
  input.value = "";
}

/** The whole panel is a drop target, so a font can be dragged straight in. */
const fontDropZone = ref<HTMLElement | null>(null);
const { isOverDropZone } = useDropZone(fontDropZone, (files) => {
  if (files?.length) void addFontFiles(files);
});

function dropFont(family: string): void {
  props.store.updateSettings({
    customFonts: removeCustomFont(props.store.getSettings().customFonts, family),
  });
}

function setLigatures(value: boolean): void {
  props.store.updateSettings({
    typography: { ...settings.value.typography, ligatures: value },
  });
}

function setKerning(value: boolean): void {
  props.store.updateSettings({
    typography: { ...settings.value.typography, kerning: value },
  });
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

    <div class="settings__search">
      <UiTextField
        ref="searchField"
        v-model="searchQuery"
        type="search"
        :placeholder="$t('settings.searchPlaceholder')"
        :aria-label="$t('settings.searchLabel')"
        autocomplete="off"
        spellcheck="false"
        @keydown.enter.prevent="onSearchEnter"
        @keydown.esc="onSearchEscape"
      >
        <template #leading>
          <MsIcon class="settings__search-icon" name="search" :size="20" />
        </template>
        <template v-if="searchQuery" #trailing>
          <UiIconButton
            icon="close"
            variant="ghost"
            :size="16"
            :label="$t('settings.searchClear')"
            @click="clearSearch"
          />
        </template>
      </UiTextField>
    </div>

    <div ref="settingsRoot" class="settings">
      <nav class="settings__nav" :aria-label="$t('settings.title')">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="settings__tab"
          :data-tab="tab.id"
          :class="{ 'settings__tab--active': !searchQuery.trim() && activeTab === tab.id }"
          :aria-current="!searchQuery.trim() && activeTab === tab.id ? 'true' : undefined"
          @click="selectTab(tab.id)"
        >
          <MsIcon :name="tab.icon" :size="20" />
          <span class="settings__tab-label">{{ $t(tab.label) }}</span>
        </button>
      </nav>

      <div class="settings__panels">
        <div v-if="searchQuery.trim()" class="settings__search-results">
          <p class="settings__search-count">
            {{ $t("settings.searchResults", { count: searchHits.length }, searchHits.length) }}
          </p>

          <div v-if="searchHits.length" class="settings__search-list">
            <button
              v-for="hit in searchHits"
              :key="`${hit.kind}-${hit.tab}-${hit.id}`"
              type="button"
              class="settings__search-hit"
              @click="openSearchHit(hit)"
            >
              <MsIcon class="settings__search-hit-icon" :name="tabIcon(hit.tab)" :size="20" />
              <span class="settings__search-hit-body">
                <span class="settings__search-hit-label">{{ hit.label }}</span>
                <span v-if="hit.hint" class="settings__search-hit-hint">{{ hit.hint }}</span>
              </span>
              <span class="settings__search-hit-tab">{{ tabLabel(hit.tab) }}</span>
            </button>
          </div>

          <div v-else class="settings__search-empty" role="status">
            <MsIcon name="search_off" :size="24" />
            <span>{{ $t("settings.searchEmpty", { query: searchQuery.trim() }) }}</span>
          </div>
        </div>

        <div v-show="!searchQuery.trim()" class="settings__panel-stack">
          <section
            v-show="activeTab === 'general'"
            class="settings__tabpanel"
            data-settings-tab="general"
          >
            <SettingsSection :title="$t('settings.sectionWorkspace')" anchor="workspace">
              <SettingsRow
                :label="$t('settings.name')"
                :hint="$t('settings.nameHint')"
                anchor="workspace-name"
              >
                <UiTextField
                  :value="settings.name"
                  :aria-label="$t('settings.name')"
                  @change="renameWorkspace"
                />
              </SettingsRow>
              <SettingsRow
                :label="$t('switcher.iconLabel')"
                :hint="$t('settings.iconHint')"
                anchor="workspace-icon"
                stacked
              >
                <div class="settings__icon-row">
                  <button
                    v-for="icon in quickIcons"
                    :key="icon"
                    type="button"
                    class="settings__icon-choice"
                    :class="{ 'settings__icon-choice--active': workspaceIcon === icon }"
                    :aria-label="icon"
                    :aria-pressed="workspaceIcon === icon"
                    @click="workspaceIcon = icon"
                  >
                    <MsIcon :name="icon" :size="22" />
                  </button>

                  <UiPopover
                    v-model:open="iconPickerOpen"
                    class="settings__icon-popover"
                    align="start"
                  >
                    <template #trigger>
                      <UiButton icon="apps">
                        {{ $t("settings.iconMore") }}
                      </UiButton>
                    </template>
                    <IconPicker
                      v-model="workspaceIcon"
                      @update:model-value="iconPickerOpen = false"
                    />
                  </UiPopover>
                </div>
              </SettingsRow>
            </SettingsSection>

            <SettingsSection>
              <SettingsRow
                :label="$t('settings.language')"
                :hint="$t('settings.languageHint')"
                anchor="language"
              >
                <UiSelect
                  v-model="localeSetting"
                  :options="localeOptions"
                  :label="$t('settings.language')"
                />
              </SettingsRow>
            </SettingsSection>

            <SettingsSection :title="$t('settings.sectionStorage')" anchor="storage">
              <SettingsRow
                :label="$t('settings.storage')"
                :hint="$t('settings.storageHint')"
                anchor="storage"
                stacked
              >
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
              </SettingsRow>
            </SettingsSection>

            <SettingsSection :title="$t('settings.sectionApplication')" anchor="application">
              <SettingsRow
                v-if="updateChannel !== 'unsupported'"
                :label="$t('updates.title')"
                :hint="updateHint"
                anchor="updates"
                stacked
              >
                <div class="settings__inline-actions">
                  <span
                    v-if="updateStatus === 'available' && updateInfo?.version"
                    class="settings__ok"
                  >
                    {{ $t("updates.available", { version: updateInfo.version }) }}
                  </span>
                  <code
                    v-if="updateChannel === 'desktop-package-managed' && updateManager?.command"
                    class="settings__update-command"
                  >
                    {{ updateManager.command }}
                  </code>
                  <UiButton :disabled="updateStatus === 'checking'" @click="checkForUpdates()">
                    {{ updateStatus === "checking" ? $t("updates.checking") : $t("updates.check") }}
                  </UiButton>
                </div>
              </SettingsRow>
              <SettingsRow
                :label="$t('settings.project')"
                :hint="$t('settings.projectHint')"
                anchor="project"
              >
                <UiButton @click="openProject">
                  {{ $t("settings.projectOpen") }}
                </UiButton>
              </SettingsRow>
              <SettingsRow
                :label="$t('shortcuts.title')"
                :hint="$t('shortcuts.hint')"
                anchor="shortcuts"
              >
                <UiButton @click="openShortcuts">
                  {{ $t("shortcuts.title") }}
                </UiButton>
              </SettingsRow>
            </SettingsSection>
          </section>

          <!-- Long Typst-source fields live on their own tab so General stays a
             short form: name, icon, language. -->
          <section
            v-show="activeTab === 'content'"
            class="settings__tabpanel"
            data-settings-tab="content"
          >
            <SettingsSection :title="$t('settings.sectionDailyNotes')" anchor="daily-notes">
              <SettingsRow
                :label="$t('settings.template')"
                :hint="$t('settings.templateHint')"
                anchor="daily-template"
                stacked
              >
                <TypstSourceField
                  :value="settings.dailyNoteTemplate"
                  :aria-label="$t('settings.template')"
                  @change="onDailyTemplateChange"
                />
              </SettingsRow>
            </SettingsSection>

            <SettingsSection :title="$t('settings.sectionPageSource')" anchor="page-source">
              <SettingsRow
                :label="$t('settings.prelude')"
                :hint="$t('settings.preludeHint')"
                anchor="page-prelude"
                stacked
              >
                <TypstSourceField
                  :value="settings.pagePrelude ?? ''"
                  :aria-label="$t('settings.prelude')"
                  placeholder="#set text(size: 11pt)  // runs before every page, after theme/fonts"
                  @change="onPagePreludeChange"
                />
              </SettingsRow>
            </SettingsSection>

            <SettingsSection
              :title="$t('settings.publishDefaults')"
              :hint="$t('settings.publishDefaultsHint')"
              anchor="publishing-defaults"
            >
              <SettingsRow
                :label="$t('settings.langs')"
                :hint="$t('settings.publishSeparator')"
                anchor="publish-langs"
              >
                <UiTagsInput
                  v-model="publishLangs"
                  :label="$t('settings.langs')"
                  :placeholder="'en, de'"
                />
              </SettingsRow>
              <SettingsRow
                :label="$t('settings.tags')"
                :hint="$t('settings.publishSeparator')"
                anchor="publish-tags"
              >
                <UiTagsInput
                  v-model="publishTags"
                  :label="$t('settings.tags')"
                  :placeholder="$t('settings.tags')"
                />
              </SettingsRow>
              <SettingsRow
                :label="$t('settings.includePdf')"
                :hint="$t('settings.includePdfHint')"
                anchor="publish-pdf"
              >
                <UiSwitch
                  :model-value="publishDefaults.includePdf"
                  :aria-label="$t('settings.includePdf')"
                  @update:model-value="togglePdf"
                />
              </SettingsRow>
            </SettingsSection>
          </section>

          <section
            v-show="activeTab === 'editor'"
            class="settings__tabpanel"
            data-settings-tab="editor"
          >
            <SettingsSection
              :title="$t('settings.editor')"
              :hint="$t('settings.sectionEditorHint')"
              anchor="editor"
            >
              <SettingsRow
                :label="$t('settings.editorSoftWrap')"
                :hint="$t('settings.editorSoftWrapHint')"
                anchor="editor-soft-wrap"
              >
                <UiSwitch v-model="editorSoftWrap" :aria-label="$t('settings.editorSoftWrap')" />
              </SettingsRow>
              <SettingsRow
                :label="$t('settings.editorContentWidth')"
                :hint="$t('settings.editorContentWidthHint')"
                anchor="editor-content-width"
              >
                <UiSelect
                  v-model="editorContentWidth"
                  :options="editorContentWidthOptions"
                  :label="$t('settings.editorContentWidth')"
                />
              </SettingsRow>
              <SettingsRow
                :label="$t('settings.editorLineNumbers')"
                :hint="$t('settings.editorLineNumbersHint')"
                anchor="editor-line-numbers"
              >
                <UiSwitch
                  v-model="editorLineNumbers"
                  :aria-label="$t('settings.editorLineNumbers')"
                />
              </SettingsRow>
              <SettingsRow
                :label="$t('settings.editorScrollPastEnd')"
                :hint="$t('settings.editorScrollPastEndHint')"
                anchor="editor-scroll-past-end"
              >
                <UiSwitch
                  v-model="editorScrollPastEnd"
                  :aria-label="$t('settings.editorScrollPastEnd')"
                />
              </SettingsRow>
              <SettingsRow
                :label="$t('settings.editorSplitScroll')"
                :hint="$t('settings.editorSplitScrollHint')"
                anchor="editor-split-scroll"
              >
                <UiSelect
                  v-model="editorSplitScroll"
                  :options="editorSplitScrollOptions"
                  :label="$t('settings.editorSplitScroll')"
                />
              </SettingsRow>
              <SettingsRow
                :label="$t('settings.editorVim')"
                :hint="$t('settings.editorVimHint')"
                anchor="editor-vim"
              >
                <UiSwitch v-model="editorVim" :aria-label="$t('settings.editorVim')" />
              </SettingsRow>
            </SettingsSection>

            <SettingsSection
              :title="$t('settings.sectionSpellcheck')"
              :hint="$t('settings.spellcheckHint')"
              anchor="spelling"
            >
              <SettingsRow :label="$t('settings.spellcheck')" anchor="spellcheck">
                <UiSelect
                  v-model="spellcheck"
                  :options="spellcheckOptions"
                  :label="$t('settings.spellcheck')"
                />
              </SettingsRow>

              <SettingsRow
                v-if="spellcheck === 'harper'"
                :label="$t('settings.spellcheckDictionary')"
                :hint="$t('settings.spellcheckDictionaryHint')"
                anchor="spellcheck-dictionary"
                stacked
              >
                <textarea
                  class="settings__input settings__textarea settings__textarea--dictionary"
                  :value="settings.spellcheckWords.join('\n')"
                  rows="4"
                  spellcheck="false"
                  :aria-label="$t('settings.spellcheckDictionary')"
                  :placeholder="$t('settings.spellcheckDictionaryPlaceholder')"
                  @change="onDictionaryChange"
                />
              </SettingsRow>

              <SettingsRow
                v-if="spellcheck === 'harper' && settings.spellcheckIgnoredLints.length"
                :label="
                  $t('settings.spellcheckIgnored', {
                    count: settings.spellcheckIgnoredLints.length,
                  })
                "
                :hint="$t('settings.spellcheckIgnoredHint')"
                anchor="spellcheck-ignored"
                stacked
              >
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
                      :size="20"
                      @click="removeIgnoredLint(entry.hash)"
                    />
                  </li>
                </ul>
                <UiButton size="small" @click="clearIgnoredLints">
                  {{ $t("settings.spellcheckIgnoredClear") }}
                </UiButton>
              </SettingsRow>
            </SettingsSection>
          </section>

          <section
            v-show="activeTab === 'appearance'"
            class="settings__tabpanel"
            data-settings-tab="appearance"
          >
            <SettingsSection
              :title="$t('settings.theme')"
              :hint="$t('settings.themeHint')"
              anchor="theme"
            >
              <SettingsRow :label="$t('settings.themePalette')" anchor="theme" stacked>
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
                      <span
                        class="theme-card__dot"
                        :style="{ background: option.swatch.background }"
                      />
                      <span class="theme-card__dot" :style="{ background: option.swatch.accent }" />
                      <span class="theme-card__dot" :style="{ background: option.swatch.text }" />
                    </span>
                    <span class="theme-card__label">{{ option.label }}</span>
                  </button>
                </div>
              </SettingsRow>

              <SettingsRow
                :label="$t('settings.themeMode')"
                :hint="$t('settings.themeModeHint')"
                anchor="theme-mode"
              >
                <UiSelect
                  v-model="themeMode"
                  :options="themeModeOptions"
                  :label="$t('settings.themeMode')"
                />
              </SettingsRow>

              <SettingsRow
                v-if="paletteDraft"
                :label="$t('settings.customPalette')"
                :hint="$t('settings.customPaletteHint')"
                anchor="custom-palette"
                stacked
              >
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
              </SettingsRow>
            </SettingsSection>

            <SettingsSection
              :title="$t('settings.sectionInterface')"
              :hint="$t('settings.sectionInterfaceHint')"
              anchor="interface"
            >
              <SettingsRow
                :label="$t('settings.uiSize')"
                :hint="$t('settings.uiSizeHint')"
                anchor="ui-size"
              >
                <UiSelect
                  v-model="uiSize"
                  :options="uiSizeOptions"
                  :label="$t('settings.uiSize')"
                />
              </SettingsRow>

              <SettingsRow
                :label="$t('settings.uiDensity')"
                :hint="$t('settings.uiDensityHint')"
                anchor="ui-density"
              >
                <UiSelect
                  v-model="uiDensity"
                  :options="uiDensityOptions"
                  :label="$t('settings.uiDensity')"
                />
              </SettingsRow>

              <SettingsRow
                :label="$t('settings.uiRadius')"
                :hint="$t('settings.uiRadiusHint')"
                anchor="ui-radius"
              >
                <UiSelect
                  v-model="uiRadius"
                  :options="uiRadiusOptions"
                  :label="$t('settings.uiRadius')"
                />
              </SettingsRow>

              <!-- Device-local: the bar belongs to this window, not the workspace. -->
              <SettingsRow
                :label="$t('settings.appBar')"
                :hint="$t('settings.appBarHint')"
                anchor="app-bar"
              >
                <UiSwitch v-model="appBarVisible" :aria-label="$t('settings.appBar')" />
              </SettingsRow>
            </SettingsSection>

            <SettingsSection
              :title="$t('settings.sectionTypography')"
              :hint="$t('settings.sectionTypographyHint')"
              anchor="typography"
            >
              <SettingsRow
                :label="$t('settings.textSize')"
                :hint="$t('settings.textSizeHint')"
                anchor="text-size"
              >
                <UiNumberField
                  v-model="textSize"
                  :min="8"
                  :max="72"
                  :step="1"
                  :label="$t('settings.textSize')"
                />
              </SettingsRow>

              <SettingsRow
                :label="$t('settings.textFont')"
                :hint="$t('settings.textFontHint')"
                anchor="text-font"
              >
                <FontPicker
                  v-model="textFont"
                  :options="textFontOptions"
                  :label="$t('settings.textFont')"
                  :placeholder="$t('settings.fontSearch')"
                />
              </SettingsRow>

              <SettingsRow
                :label="$t('settings.mathFont')"
                :hint="$t('settings.mathFontHint')"
                anchor="math-font"
              >
                <FontPicker
                  v-model="mathFont"
                  :options="mathFontOptions"
                  :label="$t('settings.mathFont')"
                  :placeholder="$t('settings.fontSearch')"
                />
              </SettingsRow>

              <SettingsRow
                :label="$t('settings.codeFont')"
                :hint="$t('settings.codeFontHint')"
                anchor="code-font"
              >
                <FontPicker
                  v-model="codeFont"
                  :options="codeFontOptions"
                  :label="$t('settings.codeFont')"
                  :placeholder="$t('settings.fontSearch')"
                />
              </SettingsRow>

              <SettingsRow
                :label="$t('settings.ligatures')"
                :hint="$t('settings.ligaturesHint')"
                anchor="ligatures"
              >
                <UiSwitch
                  :model-value="settings.typography.ligatures"
                  :aria-label="$t('settings.ligatures')"
                  @update:model-value="setLigatures"
                />
              </SettingsRow>

              <SettingsRow
                :label="$t('settings.kerning')"
                :hint="$t('settings.kerningHint')"
                anchor="kerning"
              >
                <UiSwitch
                  :model-value="settings.typography.kerning"
                  :aria-label="$t('settings.kerning')"
                  @update:model-value="setKerning"
                />
              </SettingsRow>
            </SettingsSection>

            <SettingsSection
              :title="$t('settings.sectionFonts')"
              :hint="$t('settings.sectionFontsHint')"
              anchor="fonts"
            >
              <SettingsRow
                :label="$t('settings.workspaceFonts')"
                :hint="$t('settings.workspaceFontsHint')"
                anchor="workspace-fonts"
                stacked
              >
                <!-- The panel is the drop target and the file picker's label, so
                   the whole row opens the chooser as well as accepting a drop. -->
                <label
                  ref="fontDropZone"
                  class="settings__drop"
                  :class="{ 'settings__drop--over': isOverDropZone }"
                >
                  <MsIcon name="font_download" :size="20" />
                  <span class="settings__drop-body">
                    <span class="settings__drop-text">{{ $t("settings.fontDrop") }}</span>
                    <span class="settings__drop-hint">{{ $t("settings.fontDropHint") }}</span>
                  </span>
                  <input
                    type="file"
                    accept=".ttf,.otf,.ttc,font/*"
                    multiple
                    class="settings__font-input"
                    @change="uploadFonts"
                  />
                </label>

                <p v-if="fontUploadError" class="settings__error" role="alert">
                  {{ fontUploadError }}
                </p>

                <ul v-if="settings.customFonts.length" class="settings__font-list">
                  <li v-for="font in settings.customFonts" :key="font.family">
                    <MsIcon name="font_download" :size="18" />
                    <span class="settings__font-family">{{ font.family }}</span>
                    <span
                      v-if="missingFonts.includes(font.family)"
                      class="settings__font-missing"
                      :title="$t('settings.fontMissingHint')"
                    >
                      {{ $t("settings.fontMissing") }}
                    </span>
                    <span v-else class="settings__font-count">
                      {{
                        $t(
                          "settings.fontFaceCount",
                          { count: font.hashes.length },
                          font.hashes.length,
                        )
                      }}
                    </span>
                    <UiIconButton
                      icon="delete"
                      :size="18"
                      danger
                      :label="$t('settings.fontRemove')"
                      @click="dropFont(font.family)"
                    />
                  </li>
                </ul>
              </SettingsRow>

              <SettingsRow
                :label="$t('settings.loadSystemFonts')"
                :hint="
                  supportsLocalFonts()
                    ? $t('settings.systemFontsHint')
                    : $t('settings.cannotEnumerate')
                "
                anchor="system-fonts"
              >
                <div class="settings__system-fonts">
                  <template v-if="supportsLocalFonts()">
                    <UiButton
                      v-if="!systemFontsLoaded"
                      variant="primary"
                      :disabled="systemFontsLoading"
                      @click="installSystemFonts"
                    >
                      {{
                        systemFontsLoading ? $t("settings.loading") : $t("settings.loadSystemFonts")
                      }}
                    </UiButton>
                    <p v-if="systemFontsLoaded" class="settings__ok">
                      {{
                        $t("settings.systemFontsLoaded", {
                          count: systemFontFamilies.length,
                        })
                      }}
                    </p>
                  </template>

                  <p v-if="systemFontsError" class="settings__error">
                    {{ systemFontsError }}
                  </p>
                </div>
              </SettingsRow>
            </SettingsSection>
          </section>

          <section v-show="activeTab === 'ai'" class="settings__tabpanel" data-settings-tab="ai">
            <SettingsSection :title="$t('settings.tabAi')">
              <SettingsRow
                :label="$t('settings.aiEnable')"
                :hint="$t('settings.aiEnableHint')"
                anchor="ai-enabled"
              >
                <UiSwitch
                  :model-value="aiSettings.enabled"
                  :aria-label="$t('settings.aiEnable')"
                  @update:model-value="(value) => updateAiSettings({ enabled: value })"
                />
              </SettingsRow>
            </SettingsSection>

            <template v-if="aiSettings.enabled">
              <SettingsSection :title="$t('settings.sectionAiProvider')" anchor="ai-provider">
                <SettingsRow :label="$t('settings.provider')" anchor="ai-provider" stacked>
                  <div class="settings__row settings__provider-row">
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
                </SettingsRow>

                <template v-if="activeProvider">
                  <SettingsRow :label="$t('settings.providerName')" anchor="ai-provider-name">
                    <UiTextField
                      :value="activeProvider.name"
                      :aria-label="$t('settings.providerName')"
                      @change="
                        updateAiProvider({
                          name: ($event.target as HTMLInputElement).value.trim() || 'Provider',
                        })
                      "
                    />
                  </SettingsRow>
                  <SettingsRow :label="$t('settings.providerKind')" anchor="ai-provider-kind">
                    <UiSelect
                      :model-value="activeProvider.kind"
                      :options="aiKindOptions"
                      :label="$t('settings.providerKind')"
                      @update:model-value="
                        (value) => updateAiProvider({ kind: value as AiProviderSettings['kind'] })
                      "
                    />
                  </SettingsRow>
                  <SettingsRow
                    :label="$t('settings.baseUrl')"
                    :hint="$t('settings.baseUrlHint')"
                    anchor="ai-base-url"
                  >
                    <UiTextField
                      :value="activeProvider.baseUrl"
                      :aria-label="$t('settings.baseUrl')"
                      :placeholder="baseUrlPlaceholder(activeProvider.kind)"
                      @change="
                        updateAiProvider({
                          baseUrl: ($event.target as HTMLInputElement).value.trim(),
                        })
                      "
                    />
                  </SettingsRow>
                  <SettingsRow :label="$t('settings.model')" anchor="ai-model">
                    <UiTextField
                      :value="activeProvider.model"
                      :aria-label="$t('settings.model')"
                      @change="
                        updateAiProvider({
                          model: ($event.target as HTMLInputElement).value.trim(),
                        })
                      "
                    />
                  </SettingsRow>
                  <SettingsRow
                    v-if="activeProvider.kind !== 'ollama'"
                    :label="$t('settings.apiKey')"
                    :hint="$t('settings.keysHint')"
                    anchor="ai-api-key"
                  >
                    <UiTextField
                      type="password"
                      :value="activeKey"
                      :aria-label="$t('settings.apiKey')"
                      :placeholder="activeProvider.kind === 'anthropic' ? 'sk-ant-...' : 'sk-...'"
                      @change="onAiKeyChange"
                    />
                  </SettingsRow>
                </template>
              </SettingsSection>

              <SettingsSection :title="$t('settings.sectionAiBehavior')" anchor="ai-behavior">
                <SettingsRow :label="$t('settings.defaultProvider')" anchor="ai-default-provider">
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
                </SettingsRow>

                <SettingsRow :label="$t('settings.aiLiveRender')" anchor="ai-live-render">
                  <UiSwitch
                    :model-value="aiSettings.liveRender"
                    :aria-label="$t('settings.aiLiveRender')"
                    @update:model-value="(value) => updateAiSettings({ liveRender: value })"
                  />
                </SettingsRow>
                <SettingsRow :label="$t('settings.aiPageContext')" anchor="ai-page-context">
                  <UiSwitch
                    :model-value="aiSettings.pageContext"
                    :aria-label="$t('settings.aiPageContext')"
                    @update:model-value="(value) => updateAiSettings({ pageContext: value })"
                  />
                </SettingsRow>
                <SettingsRow :label="$t('settings.aiTools')" anchor="ai-tools">
                  <UiSwitch
                    :model-value="aiSettings.tools"
                    :aria-label="$t('settings.aiTools')"
                    @update:model-value="(value) => updateAiSettings({ tools: value })"
                  />
                </SettingsRow>
                <SettingsRow :label="$t('settings.aiRepairAttempts')" anchor="ai-repair-attempts">
                  <UiNumberField
                    :model-value="aiSettings.repairAttempts"
                    :label="$t('settings.aiRepairAttempts')"
                    :min="0"
                    :max="5"
                    @update:model-value="
                      (value) => updateAiSettings({ repairAttempts: value ?? 0 })
                    "
                  />
                </SettingsRow>
              </SettingsSection>
            </template>
          </section>

          <section
            v-show="activeTab === 'sync'"
            class="settings__tabpanel"
            data-settings-tab="sync"
          >
            <SettingsSection :title="$t('settings.tabSync')">
              <div class="settings__panel-body">
                <SyncPanel @open-profile="openProfile" />
              </div>
            </SettingsSection>
          </section>

          <section
            v-show="activeTab === 'export'"
            class="settings__tabpanel"
            data-settings-tab="export"
          >
            <SettingsSection :title="$t('settings.tabExport')">
              <div class="settings__panel-body">
                <WorkspaceExportPanel v-if="store" :store="store" />
              </div>
            </SettingsSection>
          </section>
        </div>
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
  width: min(62rem, calc(100vw - var(--space-8)));
  height: min(48rem, calc(100dvh - var(--space-16)));
  padding: var(--space-5);
  overflow: hidden;
}

/* The search field sits above the rail so it reads as a way into the whole
   dialog, not as another option inside a tab. */
.settings__search {
  margin-bottom: var(--space-3);
}

.settings__search .ui-text-field {
  max-width: 30rem;
}

.settings__search-icon {
  color: var(--color-text-secondary);
}

/* The input is a search field for the browser's semantics, but the trailing
   button is the visible clear action. Two cross icons read as a bug. */
.settings__search .ui-text-field__input::-webkit-search-cancel-button,
.settings__search .ui-text-field__input::-webkit-search-decoration {
  appearance: none;
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
  grid-template-columns: 14rem minmax(0, 1fr);
  gap: var(--space-4);
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
  padding: var(--space-2) var(--space-2-5);
  font-family: inherit;
  font-size: var(--text-md);
  text-align: left;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.settings__tab:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.settings__tab--active {
  color: var(--color-text);
  background: var(--color-accent-soft);
  font-weight: 600;
}

.settings__tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings__panels {
  container-name: settings-panels;
  container-type: inline-size;
  min-height: 0;
  padding-right: var(--space-1);
  /* padding-bottom: var(--space-4); */
  overflow-y: auto;
}

.settings__close {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
}

@media (max-width: 56rem) {
  .settings {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
  }

  /* A scrolling strip uses one row of height instead of three, which leaves
     the panel the space a phone actually needs. */
  .settings__nav {
    flex-direction: row;
    gap: var(--space-1);
    padding: 0 0 var(--space-3);
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .settings__nav::-webkit-scrollbar {
    display: none;
  }

  .settings__nav > .settings__tab {
    flex: none;
    width: auto;
    padding: var(--space-1-5) var(--space-2);
  }
}

.settings__tabpanel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.settings__panel-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* Search results list every matching option with its tab, so the answer says
   where it lives before the click. */
.settings__search-results {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.settings__search-count {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.settings__search-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.settings__search-hit {
  display: flex;
  align-items: center;
  gap: var(--space-2-5);
  width: 100%;
  padding: var(--space-2) var(--space-2-5);
  font: inherit;
  color: inherit;
  text-align: left;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.settings__search-hit:hover {
  background: var(--color-surface-3);
  border-color: var(--color-border-strong);
}

.settings__search-hit-icon {
  flex: none;
  color: var(--color-text-secondary);
}

.settings__search-hit-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.settings__search-hit-label {
  font-size: var(--text-md);
  font-weight: 500;
}

.settings__search-hit-hint {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings__search-hit-tab {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.settings__search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-8) var(--space-4);
  color: var(--color-text-secondary);
  text-align: center;
  background: var(--color-surface-2);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
}

.settings__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.settings__provider-row {
  flex-wrap: nowrap;
}

.settings__provider-row .ui-select__trigger {
  flex: 1;
  width: auto;
  min-width: 10rem;
}

.settings__inline-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

/* Sync and Export bring their own layouts, so they only need the card inset. */
.settings__panel-body {
  padding: var(--space-3);
}

.settings__icon-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.settings__icon-choice {
  display: grid;
  place-items: center;
  width: calc(var(--control-md) + var(--space-1));
  height: calc(var(--control-md) + var(--space-1));
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.settings__icon-choice:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
  border-color: var(--color-border-strong);
}

.settings__icon-choice--active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.settings__icon-popover {
  width: min(22rem, calc(100vw - var(--space-8)));
  padding: var(--space-2);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 30px rgb(0 0 0 / 0.12);
  z-index: 90;
  animation: ui-overlay-fade-in var(--motion-fast);
}

.settings__icon-popover[data-state="closed"] {
  animation: ui-overlay-fade-out var(--motion-exit);
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

.settings__input {
  padding: var(--space-1-5) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: inherit;
  font-size: var(--text-md);
}

/* One quiet row. The list below is the content; this is only the way in. */
.settings__drop {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2-5);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    border-color var(--motion-fast),
    color var(--motion-fast);
}

.settings__drop:hover,
.settings__drop--over {
  border-color: var(--color-accent);
  border-style: solid;
  color: var(--color-accent);
}

.settings__drop-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.settings__drop-text {
  font-size: var(--text-sm);
}

.settings__drop-hint {
  font-size: var(--text-xs);
  opacity: 0.75;
}

/* The file input is driven by the label button around it. */
.settings__font-input {
  display: none;
}

.settings__font-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  width: 100%;
}

.settings__font-list li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.settings__font-family {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings__font-count {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.settings__font-missing {
  font-size: var(--text-sm);
  color: var(--color-warning);
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

.settings__update-command {
  max-width: 20rem;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 48rem) {
  .settings__storage {
    flex-direction: column;
    align-items: stretch;
  }
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
   value field. ColorSwatch paints through --reka-color-swatch-color, and the
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
