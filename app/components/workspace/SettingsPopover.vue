<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { useSearch } from "~/composables/search";
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

const { workspaceId, dataRevision, atproto, atprotoStatus, atprotoReady } = useWorkspace();

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

// AI config (syncs; keys do not).
const aiConfig = computed(() => props.store.getAiConfig());
function updateAiPatching(patch: Record<string, unknown>) {
  props.store.updateSettings({ ai: { ...aiConfig.value, ...patch } });
}
const aiKeys = ref(getAiKeys());

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
});

function formatAgo(timestamp: number): string {
  if (!timestamp) return "never";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;

  return `${Math.floor(seconds / 86400)}d ago`;
}

function shortDid(did: string | null): string {
  if (!did) return "";

  return did.length > 18 ? `${did.slice(0, 10)}…${did.slice(-6)}` : did;
}

// Loro maps are not reactive; the workspace bumps dataRevision on any change.
const settings = computed(() => {
  void dataRevision.value;

  return props.store.getSettings();
});

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
        <h3 class="popover__title">Workspace settings</h3>

        <label class="settings__field">
          <span>Name</span>
          <input class="settings__input" :value="settings.name" @change="renameWorkspace" />
        </label>

        <label class="settings__field">
          <span>Text font</span>
          <select class="settings__input" :value="settings.font" @change="onFontChange">
            <option v-for="font in fontOptions" :key="font" :value="font">
              {{ font }}
            </option>
          </select>
        </label>

        <label class="settings__field">
          <span>Math font</span>
          <select
            class="settings__input"
            :value="settings.mathFont ?? 'New Computer Modern Math'"
            @change="onMathFontChange"
          >
            <option value="">Same as text font</option>
            <option v-for="font in fontOptions" :key="font" :value="font">
              {{ font }}
            </option>
          </select>
        </label>

        <label class="settings__field">
          <span>Code font</span>
          <select
            class="settings__input"
            :value="settings.codeFont ?? ''"
            @change="onCodeFontChange"
          >
            <option value="">Same as text font</option>
            <option v-for="font in fontOptions" :key="font" :value="font">
              {{ font }}
            </option>
          </select>
        </label>

        <div class="settings__divider" />

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
                  placeholder="handle or DID"
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
              <p class="settings__ok">Signed in as {{ shortDid(atprotoStatus.did) }}</p>
              <p class="settings__hint">
                Status: {{ atprotoStatus.pendingUpdates }} pending
                <template v-if="atprotoStatus.pendingUpdates">, exporting…</template>
                <template v-else>in sync</template>
                · exported {{ formatAgo(atprotoStatus.lastExportAt) }} · imported
                {{ formatAgo(atprotoStatus.lastImportAt) }}
              </p>
              <p class="settings__hint" :class="{ settings__error: atprotoStatus.error }">
                {{
                  atprotoStatus.error ?? "Record data is plaintext to every member of the space."
                }}
              </p>

              <div v-if="atprotoStatus.members.length" class="settings__members">
                <p class="settings__hint">Members</p>
                <ul>
                  <li v-for="member in atprotoStatus.members" :key="member.did">
                    {{ shortDid(member.did) }}
                  </li>
                </ul>
              </div>

              <button type="button" class="button" :disabled="!atprotoReady" @click="onSignOut">
                Sign out
              </button>
            </template>

            <p v-if="signInError" class="settings__error">{{ signInError }}</p>
            <p v-if="!atprotoStatus.relayConnected" class="settings__hint">
              Live relay offline; edits still sync through the PDS.
            </p>
          </template>
          <p v-else class="settings__hint">
            Sync requires the app server (OAuth client metadata). Running a static build keeps this
            workspace fully local.
          </p>
        </section>

        <div class="settings__divider" />

        <section class="settings__section">
          <h4 class="settings__heading">Publish defaults</h4>
          <label class="settings__field">
            <span>Languages</span>
            <input
              class="settings__input"
              :value="publishLangs"
              placeholder="en, de"
              @change="publishLangs = ($event.target as HTMLInputElement).value"
            />
          </label>
          <label class="settings__field">
            <span>Tags</span>
            <input
              class="settings__input"
              :value="publishTags"
              placeholder="notes, journal"
              @change="publishTags = ($event.target as HTMLInputElement).value"
            />
          </label>
          <label class="settings__check">
            <input type="checkbox" :checked="publishDefaults.includePdf" @change="togglePdf" />
            <span>Include a PDF</span>
          </label>
        </section>

        <div class="settings__divider" />

        <section class="settings__section">
          <h4 class="settings__heading">AI</h4>
          <label class="settings__field">
            <span>Provider</span>
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
            <span>Base URL</span>
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
            <span>Model</span>
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
              <span>API key (device only)</span>
              <input
                class="settings__input"
                type="password"
                :value="aiKeys.openai ?? aiKeys.anthropic ?? ''"
                :placeholder="aiConfig.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'"
                @change="onAiKeyChange"
              />
            </label>
          </template>
          <p class="settings__hint">Keys stay in local.json, never in synced settings.</p>
        </section>

        <div class="settings__divider" />

        <section class="settings__section">
          <h4 class="settings__heading">Search</h4>
          <label class="settings__check">
            <input
              type="checkbox"
              :checked="props.store.getSearchSettings().semantic"
              @change="toggleSemantic"
            />
            <span>Semantic search (downloads a model)</span>
          </label>
          <p class="settings__hint">
            <template v-if="searchStatus">
              Index: {{ searchStatus.docs }} pages · {{ searchStatus.blocks }} blocks ·
              {{ searchStatus.mode === "opfs" ? "persistent" : "in-memory (no OPFS/isolation)" }}
              <template v-if="searchStatus.semantic"> · model ready</template>
            </template>
            <template v-else>Index is starting…</template>
          </p>
          <button type="button" class="button button--small" @click="onRebuildIndex">
            Rebuild
          </button>
        </section>

        <div class="settings__divider" />

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
              {{ systemFontsLoading ? "Loading…" : "Load system fonts" }}
            </button>
            <p v-if="systemFontsLoaded" class="settings__ok">
              {{ systemFontFamilies.length }} system font families installed.
            </p>
          </template>
          <p v-else class="settings__hint">This browser cannot enumerate system fonts.</p>

          <p v-if="systemFontsError" class="settings__error">
            {{ systemFontsError }}
          </p>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
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
