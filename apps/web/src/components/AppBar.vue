<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { todayISO } from "~/lib/format";
import { isMac } from "~/lib/platform";

/**
 * The app bar: a slim strip of window-level chrome above the panes. It owns the
 * window's menus (file, view), where you can go (back, forward), how you find
 * things (search), and how this window is doing (updates, engine, sync).
 * Page-level controls stay in the pane toolbars, and the workspace switcher stays
 * in the sidebar header, so nothing here competes with a row of the page tree.
 *
 * The menus sit left and navigation and search sit in the center, the way an
 * editor's command bar does, so the controls that matter do not drift toward the
 * window's edges as the items on either side change.
 *
 * Its state comes from the shared composables: the navigation mirror, the
 * palette, the update channel, and the engine's health.
 */
const props = defineProps<{
  store: WorkspaceStore;
  /** "Back to Linear algebra" when the mirror knows the destination. */
  backLabel: string;
  forwardLabel: string;
  /** Whether the sidebar is showing, which the view menu names. */
  sidebarVisible: boolean;
}>();

const emit = defineEmits<{
  (e: "openPage", pageId: string): void;
  (e: "toggleSidebar"): void;
}>();

const nav = useNavHistory();
const { show: showSearch } = useSearchPalette();
const appUpdates = useAppUpdates();

/** reka's menubar root holds the value of whichever menu is open. */
const openMenu = ref("");
const newPageOpen = ref(false);
const settingsOpen = ref(false);
const workspaceExportOpen = ref(false);

const searchHint = computed(() => (isMac() ? "⌘K" : "Ctrl K"));
const updateReady = computed(() => appUpdates.status.value === "available");
const sidebarLabel = computed(() =>
  props.sidebarVisible ? "sidebar.hideSidebar" : "sidebar.showSidebar",
);
const sidebarIcon = computed(() => (props.sidebarVisible ? "left_panel_close" : "left_panel_open"));

function onCreated(page: { id: string }): void {
  emit("openPage", page.id);
}

/** Creates today's daily note when it is missing, then opens it. */
async function openToday(): Promise<void> {
  const page = await props.store.createDailyNote(todayISO());
  emit("openPage", page.id);
}
</script>

<template>
  <div class="app-bar" data-tauri-drag-region="deep">
    <div class="app-bar__side">
      <UiMenubar v-model:open="openMenu">
        <UiMenubarMenu :label="$t('nav.menuFile')" value="file">
          <UiMenubarItem icon="note_add" @select="newPageOpen = true">
            {{ $t("sidebar.newPage") }}
          </UiMenubarItem>
          <UiMenubarItem icon="calendar_today" @select="openToday">
            {{ $t("nav.menuToday") }}
          </UiMenubarItem>

          <UiMenubarSeparator />

          <UiMenubarItem icon="search" @select="showSearch()">
            {{ $t("nav.search") }}
          </UiMenubarItem>

          <UiMenubarSeparator />

          <UiMenubarItem icon="folder_zip" @select="workspaceExportOpen = true">
            {{ $t("exportWorkspace.title") }}
          </UiMenubarItem>

          <UiMenubarItem icon="settings" @select="settingsOpen = true">
            {{ $t("sidebar.workspaceSettings") }}
          </UiMenubarItem>
        </UiMenubarMenu>

        <UiMenubarMenu :label="$t('nav.menuView')" value="view">
          <UiMenubarItem :icon="sidebarIcon" @select="emit('toggleSidebar')">
            {{ $t(sidebarLabel) }}
          </UiMenubarItem>
        </UiMenubarMenu>
      </UiMenubar>
    </div>

    <div class="app-bar__center">
      <UiIconButton
        icon="arrow_back"
        :label="backLabel"
        :disabled="!nav.canBack.value"
        variant="ghost"
        class="app-bar__nav button--tiny"
        @click="nav.goBack()"
      />
      <UiIconButton
        icon="arrow_forward"
        :label="forwardLabel"
        :disabled="!nav.canForward.value"
        variant="ghost"
        class="app-bar__nav button--tiny"
        @click="nav.goForward()"
      />

      <UiTooltip :text="$t('nav.search')">
        <button type="button" class="app-bar__search" @click="showSearch()">
          <MsIcon name="search" :size="18" class="app-bar__search-icon" />
          <span class="app-bar__search-label">{{ $t("nav.search") }}</span>
          <kbd class="app-bar__search-hint">{{ searchHint }}</kbd>
        </button>
      </UiTooltip>
    </div>

    <div class="app-bar__side app-bar__side--end">
      <UiButton
        v-if="updateReady"
        variant="primary"
        size="small"
        class="app-bar__update"
        @click="appUpdates.open.value = true"
      >
        {{ $t("nav.updateReady") }}
      </UiButton>

      <AppBarEngine />
      <AppBarAccount />
    </div>

    <NewPageDialog v-model:open="newPageOpen" :store="store" @created="onCreated" />
    <WorkspaceExportDialog v-model:open="workspaceExportOpen" :store="store" />
    <SettingsDialog v-model:open="settingsOpen" :store="store" />
  </div>
</template>

<style>
.app-bar {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  align-items: center;
  gap: var(--space-2);
  height: var(--app-bar-height);
  padding: 0 var(--space-1);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.app-bar__side {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.app-bar__side--end {
  justify-content: flex-end;
}

.app-bar__center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: 0;
}

.app-bar__nav {
  flex: none;
  color: var(--color-text-secondary);
}

.app-bar__nav:not(:disabled):hover {
  color: var(--color-text);
}

/* A field that is not an input: the palette takes the typing, so the bar only
   has to look like somewhere you could. */
.app-bar__search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 1 var(--app-bar-search-width);
  margin-left: var(--space-1);
  min-width: var(--control-md);
  height: var(--control-sm);
  padding: 0 var(--space-2);
  font-family: inherit;
  font-size: var(--text-sm);
  text-align: left;
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--motion-fast),
    border-color var(--motion-fast);
}

.app-bar__search:hover {
  color: var(--color-text);
  background: var(--color-surface);
  border-color: var(--color-border-strong);
}

.app-bar__search:focus-visible {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.app-bar__search-icon {
  flex: none;
}

.app-bar__search-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.app-bar__search-hint {
  flex: none;
  margin-left: auto;
  padding: 0 var(--space-1);
  font-family: inherit;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
}
</style>
