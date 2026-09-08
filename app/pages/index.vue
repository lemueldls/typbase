<script setup lang="ts">
import { SplitterPanel as SplitterPanelComponent } from "reka-ui";

import type { ViewMode } from "~/components/workspace/PageView.vue";

import MainPane from "~/components/workspace/MainPane.vue";
import SearchPalette from "~/components/workspace/SearchPalette.vue";
import Sidebar from "~/components/workspace/Sidebar.vue";
import WorkspaceSwitcher from "~/components/workspace/WorkspaceSwitcher.vue";
import { useAppLocale } from "~/composables/appLocale";
import { useSearch } from "~/composables/search";
import { useTheme } from "~/composables/theme";
import { useTypst } from "~/composables/typst";
import { useWorkspace } from "~/composables/workspace";
import { refreshSections, toSections } from "~/lib/ai/generators";

const {
  workspace,
  error,
  ensure,
  dataRevision,
  bootProgress,
  bootNote,
  workspaceGeneration,
} = useWorkspace();

const loaded = ref(false);
const currentPageId = ref<string>("");
const mode = ref<ViewMode>("write");
const paletteOpen = ref(false);
/** Sidebar drawer state (mobile only). */
const navOpen = ref(false);
/** Desktop gets a resizable splitter; mobile keeps the drawer. */
const isDesktop = useMediaQuery("(min-width: 769px)");

/** Desktop sidebar collapse. Reka-ui persists the collapsed layout, so the
 *  initial state is read from the panel rather than assumed. */
const navPanel = ref<InstanceType<typeof SplitterPanelComponent>>();
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

// Switching workspaces swaps the store under the shell; the generation key
// remounts Sidebar/PageView, so the page id must be re-selected first. The
// watcher runs pre-render in the same tick as the bump.
watch(workspaceGeneration, () => {
  const store = workspace.value;
  if (!store) {
    currentPageId.value = "";
    return;
  }

  const settings = store.getSettings();
  currentPageId.value = settings.homePageId ?? store.listPages()[0]?.id ?? "";
});

// Section metadata should stay fresh even without the editor being open:
// the store's page changes drive a re-extract on every page switch.
watch(currentPageId, async (id) => {
  if (!id || !workspace.value) return;

  const store = workspace.value;
  const text = await store.loadPageText(id);
  const typstState = await useTypst().catch(() => null);
  if (!typstState) return;

  await refreshSections(store, id, text, (source) =>
    toSections(typstState.extractSections(source)),
  );
});

onMounted(async () => {
  await ensure();
  loaded.value = true;

  const store = workspace.value;
  if (!store) return; // no workspaces; the chooser handles it

  // Tokens + Typst renderer colors follow the workspace setting.
  useTheme(store).refresh();
  // UI language follows the workspace setting; "auto" keeps the browser one.
  useAppLocale(store);

  const settings = store.getSettings();

  // Open the home page when there is one, else the first page.
  if (settings.homePageId) {
    currentPageId.value = settings.homePageId;
  } else {
    currentPageId.value = store.listPages()[0]?.id ?? "";
  }
});

// Keep the URL shareable-ish: ?page=<id>&mode=<mode>.
const route = useRoute();
const router = useRouter();

watch(currentPageId, (id) => {
  if (loaded.value && id) {
    void router.replace({
      query: { ...route.query, page: id, mode: mode.value },
    });
  }
});

watch(mode, (value) => {
  if (loaded.value && currentPageId.value) {
    void router.replace({
      query: { ...route.query, page: currentPageId.value, mode: value },
    });
  }
});

function openPage(id: string) {
  navOpen.value = false; // drawer interactions close after selection
  if (id) currentPageId.value = id;
  else {
    // Deleted the open page; fall back to home/first page.
    const store = workspace.value;
    if (!store) return;

    const settings = store.getSettings();
    currentPageId.value = settings.homePageId ?? store.listPages()[0]?.id ?? "";
  }
}

// Persist pending snapshot writes when the tab goes away.
useEventListener("pagehide", () => {
  void workspace.value?.flush();
});

async function setMode(value: ViewMode) {
  mode.value = value;
}

definePageMeta({ ssr: false });
</script>

<template>
  <main class="app">
    <div v-if="!loaded" class="app__loading">
      <h2 class="app__loading-title">{{ $t("boot.title") }}</h2>

      <ul class="boot-steps">
        <li
          v-for="step in bootProgress"
          :key="step.id"
          class="boot-step"
          :class="`boot-step--${step.status}`"
        >
          <span class="boot-step__marker" aria-hidden="true">
            <span v-if="step.status === 'active'" class="boot-step__spinner" />
            <template v-else-if="step.status === 'done'">✓</template>
            <template v-else-if="step.status === 'error'">!</template>
            <template v-else>·</template>
          </span>
          <span class="boot-step__label">{{ step.label }}</span>
          <span v-if="step.detail" class="boot-step__detail">{{
            step.detail
          }}</span>
        </li>
      </ul>

      <p v-if="bootNote" class="app__note">{{ bootNote }}</p>
      <p v-if="error" class="app__error">{{ error }}</p>
    </div>

    <template v-else-if="workspace">
      <div :key="workspaceGeneration" class="app__content">
        <!-- Desktop: resizable sidebar via a reka-ui splitter. The nav panel is
             pixel-sized so it keeps its width when the window grows; the saved
             layout persists per workspace. Mobile: fixed drawer below. -->
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
          >
            <Sidebar
              :store="workspace"
              :current-page-id="currentPageId"
              @select="openPage"
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
                :model-value="mode"
                @update:model-value="setMode"
                @open-page="openPage"
              >
                <template #nav-toggle>
                  <!-- Desktop: reappears only while the sidebar is collapsed. -->
                  <button
                    v-if="sidebarCollapsed"
                    type="button"
                    class="button button--icon app__nav-toggle app__nav-toggle--desktop"
                    :aria-label="$t('sidebar.showSidebar')"
                    @click="toggleSidebar"
                  >
                    <MsIcon name="chevron_right" :size="20" />
                  </button>
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
              :model-value="mode"
              @update:model-value="setMode"
              @open-page="openPage"
            >
              <template #nav-toggle>
                <button
                  type="button"
                  class="button button--icon app__nav-toggle"
                  :aria-label="$t('boot.openNav')"
                  @click="navOpen = true"
                >
                  <MsIcon name="menu" :size="24" />
                </button>
              </template>
            </MainPane>
          </div>
        </template>

        <SearchPalette
          v-if="paletteOpen && workspace"
          :store="workspace"
          @close="paletteOpen = false"
        />
      </div>
    </template>

    <div v-else class="app__chooser">
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
  background: var(--border);
}

.app__resize-handle:hover::before,
.app__resize-handle:focus-visible::before,
.app__resize-handle[data-resize-handle-active]::before {
  width: 3px;
  background: var(--accent);
}

/* Mobile: sidebar becomes a drawer below the breakpoint. The nav toggle lives
   in the toolbar flow (MainPane slot), so it pushes content rather than
   floating over it. Slot content is compiled in this component's scope, so
   the toggle styles belong here, not in MainPane.

   The desktop variant only renders while the sidebar is collapsed (v-if in
   the shell), so it is visible at any width. */
.app__nav-toggle,
.app__backdrop {
  display: none;
}

.app__nav-toggle--desktop {
  display: inline-flex;
  padding: 0.35rem 0.55rem;
  margin-right: 0.25rem;
}

/* The toggle is a chrome control, not a form control: no outline ring. A
   focus background keeps keyboard users oriented instead. */
.app__nav-toggle,
.app__nav-toggle--desktop {
  outline: none;
}

.app__nav-toggle:focus-visible,
.app__nav-toggle--desktop:focus-visible {
  background: var(--surface-2);
}

@media (max-width: 768px) {
  .app__nav-toggle {
    display: inline-flex;
    padding: 0.45rem 0.65rem;
    margin-right: 0.25rem;
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
    background: var(--overlay);
    border: none;
  }
}

.app__loading {
  flex: 1;
  display: grid;
  place-content: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  text-align: center;
  align-content: center;
}

.app__loading-title {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
  color: var(--text);
}

.app__error {
  color: var(--danger);
}

.app__note {
  max-width: 26rem;
  margin: 0.5rem auto 0;
  font-size: 0.8rem;
}

.boot-steps {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  text-align: left;
  min-width: 18rem;
}

.boot-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.boot-step--active {
  color: var(--text);
}

.boot-step--done {
  color: var(--ok);
}

.boot-step--error {
  color: var(--danger);
}

.boot-step__marker {
  width: 1.1rem;
  text-align: center;
  font-weight: 600;
  flex: none;
}

.boot-step__label {
  flex: none;
}

.boot-step__detail {
  font-size: 0.78rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.boot-step__spinner {
  display: inline-block;
  width: 0.8em;
  height: 0.8em;
  border: 2px solid var(--text-secondary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: boot-spin 0.8s linear infinite;
  vertical-align: -1px;
}

@keyframes boot-spin {
  to {
    transform: rotate(360deg);
  }
}

.app__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}
</style>
