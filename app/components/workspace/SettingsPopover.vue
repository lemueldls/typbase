<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { ThemePaletteTokens, WorkspaceSettings } from "@typbase/typing";

import { useAppLocale } from "~/composables/appLocale";
import { useSearch } from "~/composables/search";
import { applyTheme, useTheme } from "~/composables/theme";
import {
  bumpRenderRevision,
  loadSystemFonts,
  systemFontFamilies,
  systemFontsError,
  systemFontsLoaded,
  systemFontsLoading,
  useTypst,
} from "~/composables/typst";
import { useWorkspace } from "~/composables/workspace";
import { getAiKeys, setAiKeys } from "~/lib/ai/keys";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const { dataRevision, atproto, atprotoStatus, atprotoReady } = useWorkspace();
const { t } = useI18n();
const appLocale = useAppLocale(props.store);

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
function togglePdf(event: Event) {
  props.store.updateSettings({
    publish: {
      ...publishDefaults.value,
      includePdf: (event.target as HTMLInputElement).checked,
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

// Theme picker: named themes from the registry, custom palette override.
const THEME_OPTIONS = [
  { id: "default", label: "Default" },
  { id: "catppuccin", label: "Catppuccin" },
  { id: "evergarden", label: "Evergarden" },
  { id: "melange", label: "Melange" },
  { id: "nord", label: "Nord" },
  { id: "gruvbox", label: "Gruvbox" },
  { id: "custom", label: "Custom (palette from settings)" },
];
const CUSTOM_THEME_ID = "custom";
const customPaletteText = ref("");
watch(
  () => settings.value.themeName,
  (name) => {
    if (name === CUSTOM_THEME_ID && !customPaletteText.value) {
      customPaletteText.value = JSON.stringify(settings.value.themeCustom ?? {}, null, 2);
    }
  },
  { immediate: true },
);
function onThemeNameChange(event: Event) {
  const name = (event.target as HTMLSelectElement).value;
  const patch: Partial<WorkspaceSettings> = { themeName: name };
  if (name === CUSTOM_THEME_ID && customPaletteText.value) {
    const palette = parseCustomPalette(customPaletteText.value);
    if (palette === null) {
      themeError.value = "Custom palette is not valid JSON of token -> color.";
      return;
    }
    patch.themeCustom = palette;
  }
  themeError.value = "";
  props.store.updateSettings(patch);
  // Apply immediately; the structure-change echo also refreshes, but the
  // editor should not wait on it.
  applyTheme(props.store.getSettings());
  bumpRenderRevision();
}
function parseCustomPalette(text: string): ThemePaletteTokens | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const tokens = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry) => typeof entry[1] === "string",
      ),
    );
    return Object.keys(tokens).length > 0 ? (tokens as ThemePaletteTokens) : null;
  } catch {
    return null;
  }
}
const themeError = ref("");
/** Settings tab; keeps the popover from becoming a scroll marathon. */
const activeTab = ref<"general" | "appearance" | "publish" | "ai" | "search" | "sync">("general");

// Typst sources that drive page structure: the daily template placeholders
// (see WorkspaceStore.createDailyNote) and the workspace prelude appended to
// every compile. Both sync through settings like everything else.
function themeOptionLabel(id: string): string {
  if (id === "custom") return t("settings.custom");
  return THEME_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

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

function onCustomPaletteChange() {
  const palette = parseCustomPalette(customPaletteText.value);
  if (!palette) {
    themeError.value = "Keep it valid JSON of token -> color (e.g. surface, text, accent).";
    return;
  }
  themeError.value = "";
  props.store.updateSettings({ themeCustom: palette });
  applyTheme(props.store.getSettings());
  bumpRenderRevision();
}

// Search status.
const { ensure: ensureSearch, search } = useSearch();
const searchStatus = computed(() => search.value?.status ?? null);
async function onRebuildIndex() {
  await search.value?.rebuild();
}
async function toggleSemantic(event: Event) {
  const semantic = (event.target as HTMLInputElement).checked;
  props.store.updateSettings({
    search: { ...props.store.getSearchSettings(), semantic },
  });
  if (semantic) {
    await search.value?.reembedAll();
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
  try {
    // Redirect flow: the page navigates to the PDS; login returns only when
    // the redirect was intercepted. Do not await forever.
    void atproto.value.signIn(identifier);
  } catch (cause) {
    signInError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    resetSignInBusy();
  }
}

async function onSignOut() {
  await atproto.value?.signOut();
}

onMounted(() => {
  // The index worker boots on first settings open; harmless if already up.
  void ensureSearch(props.store);
  useTheme(props.store).refresh();
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

const fontOptions = computed(() => {
  const bundled = new Set(["Maple Mono", "New Computer Modern Math"]);
  const options = [...bundled];
  for (const family of systemFontFamilies.value) {
    if (!options.includes(family)) options.push(family);
  }

  return options;
});

function supportsLocalFonts() {
  return typeof window !== "undefined" && "queryLocalFonts" in window;
}

async function installSystemFonts() {
  const typstState = await useTypst();
  await loadSystemFonts(typstState);
  // The wasm font book grew; open panes recompile on the revision bump.
  bumpRenderRevision();
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
          <label class="settings__field">
            <span>{{ $t("settings.name") }}</span>
            <input class="settings__input" :value="settings.name" @change="renameWorkspace" />
          </label>

          <label class="settings__field">
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
          </label>

          <label class="settings__field">
            <span>{{ $t("settings.template") }}</span>
            <textarea
              class="settings__input settings__textarea"
              :value="settings.dailyNoteTemplate"
              rows="5"
              spellcheck="false"
              @change="onDailyTemplateChange"
            />
            <span class="settings__hint">{{ $t("settings.templateHint") }}</span>
          </label>

          <label class="settings__field">
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
          </label>
        </section>

        <section v-show="activeTab === 'appearance'" class="settings__tabpanel">
          <label class="settings__field">
            <span>{{ $t("settings.theme") }}</span>
            <select
              class="settings__input"
              :value="settings.themeName ?? 'default'"
              @change="onThemeNameChange"
            >
              <option v-for="option in THEME_OPTIONS" :key="option.id" :value="option.id">
                {{ themeOptionLabel(option.id) }}
              </option>
            </select>
          </label>

          <label class="settings__field">
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
          </label>

          <label v-if="settings.themeName === 'custom'" class="settings__field">
            <span>{{ $t("settings.customPalette") }}</span>
            <textarea
              v-model="customPaletteText"
              class="settings__input settings__textarea"
              rows="8"
              spellcheck="false"
              placeholder='{ "surface": "#1b1d21", "accent": "#6ea6e3", ... }'
              @change="onCustomPaletteChange"
            />
            <span class="settings__hint">
              Tokens: surface, surface2, surface3, border, borderStrong, text, textSecondary,
              accent, accentSoft, danger, dangerSoft, ok, warning. Missing tokens fall back to the
              default theme.
            </span>
          </label>
          <p v-if="themeError" class="settings__error" role="alert">{{ themeError }}</p>

          <label class="settings__field">
            <span>{{ $t("settings.textFont") }}</span>
            <select class="settings__input" :value="settings.font" @change="onFontChange">
              <option v-for="font in fontOptions" :key="font" :value="font">
                {{ font }}
              </option>
            </select>
          </label>

          <label class="settings__field">
            <span>{{ $t("settings.mathFont") }}</span>
            <select
              class="settings__input"
              :value="settings.mathFont ?? 'New Computer Modern Math'"
              @change="onMathFontChange"
            >
              <option value="">{{ $t("settings.sameAsText") }}</option>
              <option v-for="font in fontOptions" :key="font" :value="font">
                {{ font }}
              </option>
            </select>
          </label>

          <label class="settings__field">
            <span>{{ $t("settings.codeFont") }}</span>
            <select
              class="settings__input"
              :value="settings.codeFont ?? ''"
              @change="onCodeFontChange"
            >
              <option value="">{{ $t("settings.sameAsText") }}</option>
              <option v-for="font in fontOptions" :key="font" :value="font">
                {{ font }}
              </option>
            </select>
          </label>

          <div class="settings__system-fonts">
            <p class="settings__hint">
              Installs every system font into the Typst engine, so documents can use any installed
              family.
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
                {{ $t("settings.systemFontsLoaded", { count: systemFontFamilies.length }) }}
              </p>
            </template>
            <p v-else class="settings__hint">{{ $t("settings.cannotEnumerate") }}</p>

            <p v-if="systemFontsError" class="settings__error">
              {{ systemFontsError }}
            </p>
          </div>
        </section>

        <section v-show="activeTab === 'publish'" class="settings__tabpanel">
          <section class="settings__section">
            <h4 class="settings__heading">Publish defaults</h4>
            <label class="settings__field">
              <span>{{ $t("settings.langs") }}</span>
              <input
                class="settings__input"
                :value="publishLangs"
                placeholder="en, de"
                @change="publishLangs = ($event.target as HTMLInputElement).value"
              />
            </label>
            <label class="settings__field">
              <span>{{ $t("settings.tags") }}</span>
              <input
                class="settings__input"
                :value="publishTags"
                :placeholder="$t('settings.tags')"
                @change="publishTags = ($event.target as HTMLInputElement).value"
              />
            </label>
            <label class="settings__check">
              <input type="checkbox" :checked="publishDefaults.includePdf" @change="togglePdf" />
              <span>{{ $t("settings.includePdf") }}</span>
            </label>
          </section>
        </section>
        <section v-show="activeTab === 'ai'" class="settings__tabpanel">
          <section class="settings__section">
            <h4 class="settings__heading">AI</h4>
            <label class="settings__check">
              <input
                type="checkbox"
                :checked="aiConfig.enabled"
                @change="updateAiPatching({ enabled: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ $t("settings.aiEnable") }}</span>
            </label>
            <p class="settings__hint">
              Off by default: nothing is generated or sent to a provider until you enable this.
            </p>
            <template v-if="aiConfig.enabled">
              <label class="settings__field">
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
              </label>
              <label class="settings__field">
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
              </label>
              <label class="settings__field">
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
              </label>
              <template v-if="aiConfig.provider !== 'ollama'">
                <label class="settings__field">
                  <span>{{ $t("settings.apiKey") }}</span>
                  <input
                    class="settings__input"
                    type="password"
                    :value="aiKeys.openai ?? aiKeys.anthropic ?? ''"
                    :placeholder="aiConfig.provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'"
                    @change="onAiKeyChange"
                  />
                </label>
              </template>
              <p class="settings__hint">{{ $t("settings.keysHint") }}</p>
            </template>
          </section>
        </section>
        <section v-show="activeTab === 'search'" class="settings__tabpanel">
          <section class="settings__section">
            <h4 class="settings__heading">Search</h4>
            <label class="settings__check">
              <input
                type="checkbox"
                :checked="props.store.getSearchSettings().semantic"
                @change="toggleSemantic"
              />
              <span>{{ $t("settings.semantic") }}</span>
            </label>
            <p class="settings__hint">
              <template v-if="searchStatus">
                Index: {{ searchStatus.docs }} pages · {{ searchStatus.blocks }} blocks ·
                {{ searchStatus.mode === "opfs" ? "persistent" : "in-memory (no OPFS/isolation)" }}
                <template v-if="searchStatus.semantic"> · model ready</template>
              </template>
              <template v-else>Index is starting...</template>
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
                  {{ $t("settings.signedInAs", { did: shortDid(atprotoStatus.did) }) }}
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

              <p v-if="signInError" class="settings__error">{{ signInError }}</p>
              <p v-if="!atprotoStatus.relayConnected" class="settings__hint">
                {{ $t("settings.syncRelayOff") }}
              </p>
            </template>
            <p v-else class="settings__hint">{{ $t("settings.syncRequiresServer") }}</p>
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
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}

.settings__tab {
  padding: 0.25rem 0.55rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 0.35rem;
  cursor: pointer;
}

.settings__tab:hover {
  color: var(--text);
}

.settings__tab--active {
  color: var(--text);
  background: var(--surface);
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

.settings__check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
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
  color: var(--text-secondary);
}

.settings__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.settings__field > span {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.settings__input {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  background: var(--surface);
  color: inherit;
  font-size: 0.9rem;
}

.settings__divider {
  height: 1px;
  background: var(--border);
  margin: 0.75rem 0;
}

.settings__hint {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.settings__ok {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--ok);
}

.settings__error {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--danger);
}
</style>
