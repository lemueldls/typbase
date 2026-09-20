<script setup lang="ts">
import { SplitterPanel } from "reka-ui";
import faviconUrl from "~~/public/favicon.svg?url";

import { refreshSections, toSections } from "~/lib/ai/generators";
import { engineAvailable } from "~/lib/engineHealth";
import { testApi } from "~/lib/testApi";
import { VIEW_MODES, type ViewModeId } from "~/lib/view";

const {
  workspace,
  workspaces,
  error,
  ensure,
  dataRevision,
  bootProgress,
  bootNote,
  workspaceGeneration,
  switching,
  storageSetup,
} = useWorkspace();

const loaded = ref(false);
const activeBootStep = computed(
  () => bootProgress.value.find((step) => step.status === "active") ?? bootProgress.value.at(-1),
);
const currentPageId = ref<string>("");
const currentPluginId = ref<string | null>(null);
const mode = ref<ViewModeId>("write");
const paletteOpen = ref(false);
/** Sidebar drawer state (mobile only). */
const navOpen = ref(false);
/** Desktop gets a resizable splitter; mobile keeps the drawer. */
const isDesktop = useMediaQuery("(min-width: 769px)");

/** Name of the workspace being opened, for the switching pill. */
const switchingName = computed(
  () => workspaces.value.find((entry) => entry.id === switching.value)?.name ?? null,
);

/** Desktop sidebar collapse. Reka-ui persists the collapsed layout, so the
 *  initial state is read from the panel rather than assumed. */
const navPanel = useTemplateRef<InstanceType<typeof SplitterPanel>>("navPanel");
const sidebarCollapsed = ref(false);

function syncSidebarCollapsed() {
  const panel = navPanel.value;
  if (panel) sidebarCollapsed.value = (panel.getSize() ?? 0) === 0;
}

onMounted(() => nextTick(syncSidebarCollapsed));
watch(isDesktop, (desktop) => {
  if (desktop) nextTick(syncSidebarCollapsed);
});

function toggleSidebar() {
  const panel = navPanel.value;
  if (!panel) return;

  if (sidebarCollapsed.value) {
    sidebarCollapsed.value = false;
    panel.expand();
  } else {
    sidebarCollapsed.value = true;
    panel.collapse();
  }
}

const { ensure: ensureSearch } = useSearch();

// Cmd-K / Ctrl-K opens the search palette.
onKeyStroke((event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    paletteOpen.value = !paletteOpen.value;
  }
});

// Search snapshots links: the palette needs the index started.
watch(
  paletteOpen,
  async (open) => {
    if (open && workspace.value) {
      const instance = await ensureSearch(workspace.value);
      void instance;
    }
  },
  { immediate: true },
);

/** Home page when set, else the first page; empty when the workspace has none. */
function fallbackPageId(): string {
  const store = workspace.value;
  if (!store) return "";

  return store.getSettings().homePageId ?? store.listPages()[0]?.id ?? "";
}

// Switching workspaces swaps the store under the shell; the generation key
// remounts Sidebar/PageView, so the page id must be re-selected first. The
// watcher runs pre-render in the same tick as the bump.
watch(workspaceGeneration, () => {
  currentPageId.value = fallbackPageId();
  currentPluginId.value = null;
});

// Demo capture and e2e tests reach the active store through this handle.
watch(
  workspace,
  (store) => {
    testApi.store = store ?? null;
  },
  { immediate: true },
);

testApi.openPage = (id) => openPage(id);
testApi.setMode = (value) => void setMode(value as ViewModeId);

// Section metadata should stay fresh even without the editor being open:
// the store's page changes drive a re-extract on every page switch.
watch(currentPageId, async (id) => {
  setPluginCurrentPage(id || null);
  if (!id || !workspace.value) return;

  const store = workspace.value;
  const text = await store.loadPageText(id);
  const typstState = await useTypst().catch(() => null);
  if (!typstState) return;

  await refreshSections(store, id, text, (source) =>
    engineAvailable() ? toSections(typstState.extractSections(source), source) : null,
  );
});

const { locale, setLocale } = useI18n();

// Theme tokens and UI language follow the active workspace, not just the one
// loaded at boot: both composables watch the store, so creating or switching
// a workspace applies its settings without a reload.
useTheme(() => workspace.value);
useAppLocale(locale, setLocale, () => workspace.value);

const pageQuery = useRouteQuery<string>("page", "");
const modeQuery = useRouteQuery<string>("mode", "write");
const viewQuery = useRouteQuery<string>("view", "");

/** Query values can be string arrays or null; a page/mode id is a plain string. */
function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isViewMode(value: unknown): value is ViewModeId {
  return (
    typeof value === "string" && (VIEW_MODES.map((m) => m.id) as readonly string[]).includes(value)
  );
}

onMounted(async () => {
  await ensure();
  loaded.value = true;

  const store = workspace.value;
  if (!store) return; // no workspaces; the chooser handles it

  const linkedId = queryString(pageQuery.value);
  const linked = linkedId ? store.getPage(linkedId) : undefined;
  if (linked) currentPageId.value = linked.id;
  else currentPageId.value = fallbackPageId();

  if (isViewMode(modeQuery.value)) mode.value = modeQuery.value;
  else syncModeToPage(currentPageId.value);

  // A ?view=plugin:<instance> link reopens the plugin pane when it exists.
  const linkedView = queryString(viewQuery.value);
  const instanceId = linkedView.startsWith("plugin:") ? linkedView.slice("plugin:".length) : "";
  if (instanceId && store.getPluginInstance(instanceId)) currentPluginId.value = instanceId;

  setPluginNavigation({ openPage, openPlugin });
});

watch(currentPageId, (id) => {
  testApi.pageId = id || null;
});

watch(currentPageId, (id) => {
  if (loaded.value && id && pageQuery.value !== id) pageQuery.value = id;
});

watch(mode, (value) => {
  if (loaded.value && currentPageId.value && modeQuery.value !== value) {
    modeQuery.value = value;
  }
});

// Back/forward or a pasted link changes the query under us.
watch(pageQuery, (raw) => {
  const id = queryString(raw);
  if (!loaded.value || !id || id === currentPageId.value) return;

  const store = workspace.value;
  if (store?.getPage(id)) {
    currentPageId.value = id;
    return;
  }

  // Stale id: same fallback as a missing page, and rewrite the URL so it stops
  // pointing at a page this workspace does not have.
  const fallback = fallbackPageId();
  currentPageId.value = fallback;
  if (queryString(pageQuery.value) !== fallback) pageQuery.value = fallback;
});

watch(modeQuery, (value) => {
  if (loaded.value && value !== mode.value && isViewMode(value)) mode.value = value;
});

function pluginViewValue(instanceId: string | null): string {
  return instanceId ? `plugin:${instanceId}` : "";
}

watch(currentPluginId, (id) => {
  if (!loaded.value) return;
  const value = pluginViewValue(id);
  if (queryString(viewQuery.value) !== value) viewQuery.value = value;
});

// Back/forward or a pasted link changes the open pane under us.
watch(viewQuery, (raw) => {
  if (!loaded.value) return;

  const value = queryString(raw);
  const instanceId = value.startsWith("plugin:") ? value.slice("plugin:".length) : "";
  if (!instanceId) {
    currentPluginId.value = null;
    return;
  }

  if (workspace.value?.getPluginInstance(instanceId)) currentPluginId.value = instanceId;
  else if (queryString(viewQuery.value) === value) viewQuery.value = "";
});

// A deleted instance must not leave the shell on an empty plugin pane.
watch(dataRevision, () => {
  if (currentPluginId.value && !workspace.value?.getPluginInstance(currentPluginId.value)) {
    currentPluginId.value = null;
  }
});

function openPage(id: string) {
  navOpen.value = false; // drawer interactions close after selection
  currentPluginId.value = null; // opening a page leaves the plugin pane
  // An empty id means the open page was deleted; fall back to home/first.
  currentPageId.value = id || fallbackPageId();
  syncModeToPage(currentPageId.value);
}

/**
 * Notebook pages open in notebook mode instead of the default write mode, and
 * documents do not stay in notebook mode. A deliberately chosen
 * split/source/read mode carries across both kinds.
 */
function syncModeToPage(pageId: string) {
  const page = workspace.value?.getPage(pageId);
  if (!page) return;

  if (page.kind === "notebook" && mode.value === "write") mode.value = "notebook";
  else if (page.kind === "document" && mode.value === "notebook") mode.value = "write";
}

function openPlugin(instanceId: string) {
  navOpen.value = false;
  if (instanceId) currentPluginId.value = instanceId;
}

function closePlugin() {
  currentPluginId.value = null;
}

// Persist pending snapshot writes when the tab goes away.
useEventListener("pagehide", () => {
  void workspace.value?.flush();
});

async function setMode(value: ViewModeId) {
  mode.value = value;
}

definePageMeta({ ssr: false });
</script>

<template>
  <main class="app">
    <div v-if="loaded && switching" class="app__switching" role="status">
      <span class="app__switching-spinner" aria-hidden="true" />
      <span class="app__switching-label">
        {{ switchingName ? $t("boot.switchingTo", { name: switchingName }) : $t("boot.switching") }}
      </span>
    </div>

    <Transition name="splash">
      <div v-if="!loaded" class="app__splash" role="status" aria-live="polite">
        <img class="app__splash-mark" :src="faviconUrl" alt="" />
        <h1 class="app__splash-title">Typbase</h1>
        <div class="app__splash-bar" aria-hidden="true"><span /></div>
        <p class="app__splash-step">
          {{ activeBootStep?.label ?? $t("boot.title") }}
          <template v-if="activeBootStep?.detail"> · {{ activeBootStep.detail }}</template>
        </p>
        <p v-if="bootNote" class="app__splash-note">{{ bootNote }}</p>
        <p v-if="error" class="app__splash-error">{{ error }}</p>
      </div>
    </Transition>

    <StorageSetup v-if="loaded && storageSetup" :setup="storageSetup" />

    <template v-if="loaded && !storageSetup && workspace">
      <div
        :key="workspaceGeneration"
        class="app__content"
        :class="{ 'app__content--switching': switching }"
        :aria-busy="switching ? true : undefined"
        :inert="switching ? true : undefined"
      >
        <SplitterGroup
          v-if="isDesktop"
          direction="horizontal"
          auto-save-id="typbase:sidebar"
          class="app__splitter"
        >
          <SplitterPanel
            ref="navPanel"
            class="app__nav-panel"
            size-unit="px"
            :default-size="264"
            :min-size="200"
            :max-size="480"
            collapsible
            :collapsed-size="0"
            @collapse="sidebarCollapsed = true"
            @expand="sidebarCollapsed = false"
            @resize="syncSidebarCollapsed"
          >
            <Sidebar
              :store="workspace"
              :current-page-id="currentPageId"
              @select="openPage"
              @open-plugin="openPlugin"
              @collapse-request="toggleSidebar"
            />
          </SplitterPanel>

          <SplitterResizeHandle
            v-show="!sidebarCollapsed"
            class="app__resize-handle"
            :aria-label="$t('sidebar.resizeSidebar')"
          />

          <SplitterPanel class="app__main-panel" :default-size="76">
            <div class="app__main">
              <MainPane
                :page-id="currentPageId"
                :plugin-instance-id="currentPluginId"
                :model-value="mode"
                @update:model-value="setMode"
                @open-page="openPage"
                @open-plugin="openPlugin"
                @close-plugin="closePlugin"
              >
                <template #nav-toggle>
                  <UiIconButton
                    v-if="sidebarCollapsed"
                    :icon="sidebarCollapsed ? 'chevron_right' : 'chevron_left'"
                    :label="
                      sidebarCollapsed ? $t('sidebar.showSidebar') : $t('sidebar.hideSidebar')
                    "
                    class="app__nav-toggle app__nav-toggle--desktop"
                    @click="toggleSidebar"
                  />
                </template>
              </MainPane>
            </div>
          </SplitterPanel>
        </SplitterGroup>

        <!-- Mobile drawer + main pane. -->
        <template v-else>
          <div
            class="app__nav"
            :class="{ 'app__nav--open': navOpen }"
            :aria-hidden="navOpen ? 'false' : undefined"
          >
            <Sidebar
              :store="workspace"
              :current-page-id="currentPageId"
              @select="openPage"
              @open-plugin="openPlugin"
              @collapse-request="navOpen = false"
            />
          </div>

          <button
            v-if="navOpen"
            type="button"
            class="app__backdrop"
            :aria-label="$t('boot.closeNav')"
            @click="navOpen = false"
          />

          <div class="app__main">
            <MainPane
              :page-id="currentPageId"
              :plugin-instance-id="currentPluginId"
              :model-value="mode"
              @update:model-value="setMode"
              @open-page="openPage"
              @open-plugin="openPlugin"
              @close-plugin="closePlugin"
            >
              <template #nav-toggle>
                <UiIconButton
                  icon="menu"
                  :size="24"
                  :label="$t('boot.openNav')"
                  variant="ghost"
                  class="app__nav-toggle"
                  @click="navOpen = true"
                />
              </template>
            </MainPane>
          </div>
        </template>

        <PluginOverlay />

        <SearchPalette
          v-if="paletteOpen && workspace"
          :store="workspace"
          @close="paletteOpen = false"
        />
      </div>
    </template>

    <div v-if="loaded && !storageSetup && !workspace" class="app__chooser">
      <WorkspaceSwitcher mode="screen" />
    </div>
  </main>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.app__content {
  display: contents;
}

/* Workspace switch feedback: a pill + indeterminate bar over the shell, and
   a dimmed, inert content area until the new store is live. The content div
   is `display: contents`, so the dim has to target its children. */
/* Workspace switch feedback: a floating status pill over the dimmed, inert
   content area (see .app__content--switching). */
.app__switching {
  position: fixed;
  top: var(--space-3-5);
  left: 50%;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3-5);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.18);
  pointer-events: none;
  animation: app-switching-in 0.15s ease-out;
  transform: translateX(-50%);
}

.app__switching-spinner {
  width: calc(0.95rem * var(--ui-size));
  height: calc(0.95rem * var(--ui-size));
  flex: none;
  border: 2px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: app-switching-spin 0.7s linear infinite;
}

.app__switching-label {
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
}

@keyframes app-switching-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes app-switching-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(var(--space-1) * -1));
  }

  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

.app__content--switching > * {
  pointer-events: none;
  opacity: 0.7;
  transition: opacity 0.15s ease;
}

.app__chooser {
  flex: 1;
  display: grid;
  place-content: center;
}

.app__main {
  position: relative;
  min-width: 0;
}

/* Desktop layout: the sidebar panel is px-sized, so it keeps its width when
   the window resizes and only the main panel flexes. */
.app__splitter {
  flex: 1;
  min-width: 0;
}

.app__nav-panel :deep(.sidebar) {
  border-right: 0;
}

.app__main-panel .app__main {
  height: 100%;
}

.app__resize-handle {
  width: 6px;
  flex: 0 0 6px;
  position: relative;
  cursor: col-resize;
  outline: none;
}

.app__resize-handle::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  background: var(--color-border);
}

.app__resize-handle:hover::before,
.app__resize-handle:focus-visible::before,
.app__resize-handle[data-resize-handle-active]::before {
  width: 3px;
  background: var(--color-accent);
}

/* Mobile: sidebar becomes a drawer below the breakpoint. The nav toggle lives
   in the toolbar flow (MainPane slot), so it pushes content rather than
   floating over it. Slot content is compiled in this component's scope, so
   the toggle styles belong here, not in MainPane.

   The desktop variant renders whenever the desktop shell does; its icon and
   label flip with the sidebar state so it can collapse and expand. */
/* :deep() targets UiIconButton's inner button; component-wrapped buttons do
   not receive the consumer's scope attribute. */
.app__main :deep(.app__nav-toggle),
.app__backdrop {
  display: none;
}

.app__main :deep(.app__nav-toggle--desktop) {
  display: inline-flex;
  padding: var(--space-1-5) var(--space-2);
}

.app__main :deep(.app__nav-toggle:focus-visible),
.app__main :deep(.app__nav-toggle--desktop:focus-visible) {
  background: var(--color-surface-2);
}

@media (max-width: 768px) {
  .app__main :deep(.app__nav-toggle) {
    display: inline-flex;
  }

  .app__nav {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 60;
    width: min(84vw, 320px);
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
  }

  .app__nav--open {
    transform: translateX(0);
  }

  .app__backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 55;
    background: var(--color-overlay);
    border: none;
  }
}

.app__splash {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--space-4);
  background: var(--color-surface);
  color: var(--color-text);
  user-select: none;
}

.app__splash-mark {
  width: 3.5rem;
  height: 3.5rem;
  display: block;
}

.app__splash-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.app__splash-bar {
  position: relative;
  width: 11rem;
  height: 3px;
  overflow: hidden;
  background: var(--color-border);
  border-radius: var(--radius-full);
}

.app__splash-bar span {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background: var(--color-accent);
  border-radius: inherit;
  animation: app-splash-slide 1.1s ease-in-out infinite;
}

@keyframes app-splash-slide {
  0% {
    left: -40%;
  }

  100% {
    left: 100%;
  }
}

.app__splash-step {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.app__splash-note {
  max-width: 26rem;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  text-align: center;
}

.app__splash-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}

.splash-leave-active {
  transition: opacity 0.25s ease;
}

.splash-leave-to {
  opacity: 0;
}

.app__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
}
</style>
