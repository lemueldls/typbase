<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { useWorkspace } from "~/composables/workspace";
import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";

import CalendarDialog from "./CalendarDialog.vue";
import CategoriesDialog from "./CategoriesDialog.vue";
import NewPageDialog from "./NewPageDialog.vue";
import SettingsPopover from "./SettingsPopover.vue";
import WorkspaceSwitcher from "./WorkspaceSwitcher.vue";

const props = defineProps<{
  store: WorkspaceStore;
  currentPageId: string | null;
}>();

const emit = defineEmits<{
  (e: "select", pageId: string): void;
}>();

const { dataRevision, workspaces, activeWorkspaceId } = useWorkspace();
const { t } = useI18n();

/** The active workspace's registry icon; falls back to the default folder. */
const workspaceIcon = computed<MaterialSymbol>(() => {
  const info = workspaces.value.find((entry) => entry.id === activeWorkspaceId.value);
  return (info?.icon as MaterialSymbol | undefined) ?? DEFAULT_WORKSPACE_ICON;
});

const pages = computed(() => {
  void dataRevision.value;

  return props.store.listPages();
});

const categories = computed(() => {
  void dataRevision.value;

  return props.store.listCategories();
});

const settings = computed(() => {
  void dataRevision.value;

  return props.store.getSettings();
});

const regularPages = computed(() => pages.value.filter((page) => !page.path.startsWith("daily/")));
const uncategorized = computed(() => regularPages.value.filter((page) => !page.categoryId));

function pagesForCategory(categoryId: string) {
  return regularPages.value.filter((page) => page.categoryId === categoryId);
}

const today = new Date();
const todayISO = today.toISOString().slice(0, 10);

async function openToday() {
  const page = await props.store.createDailyNote(todayISO);
  emit("select", page.id);
}

/** A daily note was deleted from the calendar; fall back if it was open. */
function onCalendarDeleted(pageId: string) {
  if (props.currentPageId === pageId) emit("select", "");
}

const renameTarget = ref<PageMeta>();
const renameTitle = ref("");

async function rename() {
  if (!renameTarget.value) return;

  const title = renameTitle.value.trim();
  if (!title) return;

  await props.store.updatePageTitle(renameTarget.value.id, title);
  renameTarget.value = undefined;
}

async function setHome(page: PageMeta) {
  await props.store.updateSettings({ homePageId: page.id });
}

async function remove(page: PageMeta) {
  if (!window.confirm(`Delete "${page.title}"? This cannot be undone.`)) return;

  await props.store.deletePage(page.id);
  if (props.currentPageId === page.id) emit("select", "");
}

function onRenameOpenChange(open: boolean) {
  if (!open) renameTarget.value = undefined;
}

function onCreated(page: PageMeta) {
  emit("select", page.id);
}
</script>

<template>
  <aside class="sidebar">
    <header class="sidebar__header">
      <span class="sidebar__title-group">
        <MsIcon :name="workspaceIcon" :size="18" class="sidebar__icon" />
        <span class="sidebar__name">{{ settings.name }}</span>
      </span>
      <div class="sidebar__header-actions">
        <WorkspaceSwitcher mode="menu">
          <button type="button" class="button button--icon" aria-label="Switch workspace">
            <MsIcon name="swap_horiz" :size="16" />
          </button>
        </WorkspaceSwitcher>
        <SettingsPopover :store="store">
          <button type="button" class="button button--icon" aria-label="Workspace settings">
            <MsIcon name="settings" :size="16" />
          </button>
        </SettingsPopover>
      </div>
    </header>

    <div class="sidebar__section">
      <div class="sidebar__section-title">
        <span>{{ $t("sidebar.daily") }}</span>
      </div>

      <button type="button" class="sidebar__row sidebar__row--today" @click="openToday">
        <MsIcon name="calendar_today" :size="14" />
        {{ $t("sidebar.today") }}
      </button>

      <CalendarDialog :store="store" @select="emit('select', $event)" @deleted="onCalendarDeleted">
        <button type="button" class="sidebar__row sidebar__row--calendar">
          <MsIcon name="calendar_month" :size="14" />
          {{ $t("sidebar.calendar") }}
        </button>
      </CalendarDialog>
    </div>

    <div class="sidebar__section sidebar__section--pages">
      <div class="sidebar__section-title">
        <span>{{ $t("sidebar.pages") }}</span>
        <div class="sidebar__section-actions">
          <NewPageDialog :store="store" @created="onCreated">
            <button
              type="button"
              class="button button--primary button--icon"
              :aria-label="$t('sidebar.newPage')"
            >
              <MsIcon name="add" :size="14" />
            </button>
          </NewPageDialog>
          <CategoriesDialog :store="store">
            <button type="button" class="button button--ghost button--small">
              {{ $t("sidebar.categories") }}
            </button>
          </CategoriesDialog>
        </div>
      </div>

      <button
        v-if="settings.homePageId"
        type="button"
        class="sidebar__row sidebar__row--home"
        @click="emit('select', settings.homePageId)"
      >
        <MsIcon name="home" :size="14" />
        {{ $t("sidebar.home") }}
      </button>

      <div v-for="category in categories" :key="category.id" class="sidebar__group">
        <span class="sidebar__group-title">{{ category.name }}</span>
        <ul class="sidebar__list">
          <li v-for="page in pagesForCategory(category.id)" :key="page.id" class="sidebar__item">
            <button
              type="button"
              class="sidebar__row"
              :class="{ 'sidebar__row--active': page.id === currentPageId }"
              :aria-current="page.id === currentPageId ? 'page' : undefined"
              @click="emit('select', page.id)"
            >
              <span class="sidebar__row-label">{{ page.title }}</span>
              <span
                v-if="settings.homePageId === page.id"
                class="sidebar__row-home"
                :title="$t('sidebar.homePage')"
              >
                <MsIcon name="home" :size="12" />
              </span>
            </button>

            <DropdownMenuRoot>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="button button--icon button--tiny"
                  :aria-label="t('sidebar.actions', { title: page.title })"
                >
                  <MsIcon name="more_horiz" :size="14" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent class="menu" :side-offset="4" align="end">
                  <DropdownMenuItem
                    @select="
                      renameTarget = page;
                      renameTitle = page.title;
                    "
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem @select="setHome(page)">{{
                    $t("sidebar.setHome")
                  }}</DropdownMenuItem>
                  <DropdownMenuSeparator class="menu__separator" />
                  <DropdownMenuItem class="menu__danger" @select="remove(page)">
                    {{ $t("sidebar.delete") }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </li>
        </ul>
      </div>

      <div v-if="uncategorized.length" class="sidebar__group">
        <span class="sidebar__group-title">{{ $t("sidebar.general") }}</span>
        <ul class="sidebar__list">
          <li v-for="page in uncategorized" :key="page.id" class="sidebar__item">
            <button
              type="button"
              class="sidebar__row"
              :class="{ 'sidebar__row--active': page.id === currentPageId }"
              :aria-current="page.id === currentPageId ? 'page' : undefined"
              @click="emit('select', page.id)"
            >
              <span class="sidebar__row-label">{{ page.title }}</span>
              <span
                v-if="settings.homePageId === page.id"
                class="sidebar__row-home"
                :title="$t('sidebar.homePage')"
              >
                <MsIcon name="home" :size="12" />
              </span>
            </button>

            <DropdownMenuRoot>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="button button--icon button--tiny"
                  :aria-label="t('sidebar.actions', { title: page.title })"
                >
                  <MsIcon name="more_horiz" :size="14" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent class="menu" :side-offset="4" align="end">
                  <DropdownMenuItem
                    @select="
                      renameTarget = page;
                      renameTitle = page.title;
                    "
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem @select="setHome(page)">{{
                    $t("sidebar.setHome")
                  }}</DropdownMenuItem>
                  <DropdownMenuSeparator class="menu__separator" />
                  <DropdownMenuItem class="menu__danger" @select="remove(page)">
                    {{ $t("sidebar.delete") }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </li>
        </ul>
      </div>

      <p v-if="pages.length === 0" class="sidebar__empty">{{ $t("sidebar.noPages") }}</p>
    </div>

    <!-- rename dialog -->
    <DialogRoot :open="!!renameTarget" @update:open="onRenameOpenChange">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="dialog">
          <DialogTitle class="dialog__title">{{ $t("sidebar.renameTitle") }}</DialogTitle>
          <form class="dialog__form" @submit.prevent="rename">
            <label class="dialog__field">
              <span>{{ $t("sidebar.title") }}</span>
              <input v-model="renameTitle" class="dialog__input" autofocus />
            </label>
            <div class="dialog__actions">
              <button type="button" class="button button--ghost" @click="renameTarget = undefined">
                Cancel
              </button>
              <button type="submit" class="button button--primary">
                {{ $t("sidebar.rename") }}
              </button>
            </div>
          </form>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
    <footer class="sidebar__footer">
      <NuxtLink to="/debug" class="button button--ghost button--small">
        <MsIcon name="science" :size="13" />
        {{ $t("sidebar.debugLab") }}
      </NuxtLink>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--surface);
}

.sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid var(--border);
}

.sidebar__title-group {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.sidebar__icon {
  flex: none;
}

.sidebar__name {
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar__header-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.sidebar__section {
  padding: 0.75rem 0.5rem;
  border-bottom: 1px solid var(--border);
  overflow-y: auto;
}

.sidebar__section--pages {
  flex: 1;
  min-height: 0;
}

.sidebar__section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0 0.4rem 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.sidebar__section-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.sidebar__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.sidebar__item {
  display: flex;
  align-items: center;
  gap: 0.1rem;
}

.sidebar__row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: 1;
  width: 100%;
  min-width: 0;
  padding: 0.45rem 0.6rem;
  font-size: 0.9rem;
  text-align: left;
  color: var(--text);
  background: transparent;
  border: none;
  border-radius: 0.35rem;
  cursor: pointer;
}

.sidebar__row:hover {
  background: var(--surface-2);
}

.sidebar__row--active {
  background: var(--accent-soft);
}

.sidebar__row--today,
.sidebar__row--calendar {
  font-weight: 600;
}

.sidebar__row-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar__row-home {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.sidebar__row-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--border-strong);
  flex-shrink: 0;
}

.sidebar__row-dot--filled {
  background: var(--accent);
}

.sidebar__group {
  margin-bottom: 0.5rem;
}

.sidebar__group-title {
  display: block;
  padding: 0.4rem 0.45rem 0.2rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.sidebar__empty {
  padding: 0.5rem 0.45rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.sidebar__footer {
  padding: 0.5rem;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
}
</style>
