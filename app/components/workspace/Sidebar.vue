<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";

import { useWorkspace } from "~/composables/workspace";

import CategoriesDialog from "./CategoriesDialog.vue";
import NewPageDialog from "./NewPageDialog.vue";
import SettingsPopover from "./SettingsPopover.vue";

const props = defineProps<{
  store: WorkspaceStore;
  currentPageId: string | null;
}>();

const emit = defineEmits<{
  (e: "select", pageId: string): void;
}>();

const { dataRevision } = useWorkspace();

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

const dailyPages = computed(() => pages.value.filter((page) => page.path.startsWith("daily/")));
const regularPages = computed(() => pages.value.filter((page) => !page.path.startsWith("daily/")));
const uncategorized = computed(() => regularPages.value.filter((page) => !page.categoryId));

function pagesForCategory(categoryId: string) {
  return regularPages.value.filter((page) => page.categoryId === categoryId);
}

const today = new Date();
const todayISO = today.toISOString().slice(0, 10);

const week = computed(() =>
  Array.from({ length: 7 }, (_, index) => {
    const offset = 6 - index;
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const iso = date.toISOString().slice(0, 10);
    const label =
      iso === todayISO
        ? "Today"
        : date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          });

    return {
      iso,
      label,
      page: dailyPages.value.find((page) => page.path === `daily/${iso}.typ`),
    };
  }),
);

async function openToday() {
  const page = await props.store.createDailyNote(todayISO);
  emit("select", page.id);
}

async function selectDaily(day: { page: PageMeta | undefined; iso: string }) {
  if (day.page) {
    emit("select", day.page.id);
    return;
  }

  const page = await props.store.createDailyNote(day.iso);
  emit("select", page.id);
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
      <span class="sidebar__name">{{ settings.name }}</span>
      <SettingsPopover :store="store">
        <button type="button" class="button button--icon" aria-label="Workspace settings">⚙</button>
      </SettingsPopover>
    </header>

    <div class="sidebar__section">
      <div class="sidebar__section-title">
        <span>Daily</span>
        <NewPageDialog :store="store" @created="onCreated">
          <button type="button" class="button button--primary button--small">New page</button>
        </NewPageDialog>
      </div>

      <button type="button" class="sidebar__row sidebar__row--today" @click="openToday">
        ✳ Today
      </button>

      <ul class="sidebar__list">
        <li v-for="day in week" :key="day.iso">
          <button
            type="button"
            class="sidebar__row"
            :class="{ 'sidebar__row--active': day.page?.id === currentPageId }"
            @click="selectDaily(day)"
          >
            <span class="sidebar__row-dot" :class="{ 'sidebar__row-dot--filled': !!day.page }" />
            {{ day.label }}
          </button>
        </li>
      </ul>
    </div>

    <div class="sidebar__section sidebar__section--pages">
      <div class="sidebar__section-title">
        <span>Pages</span>
        <CategoriesDialog :store="store">
          <button type="button" class="button button--ghost button--small">Categories</button>
        </CategoriesDialog>
      </div>

      <button
        v-if="settings.homePageId"
        type="button"
        class="sidebar__row sidebar__row--home"
        @click="emit('select', settings.homePageId)"
      >
        ⌂ Home
      </button>

      <div v-for="category in categories" :key="category.id" class="sidebar__group">
        <span class="sidebar__group-title">{{ category.name }}</span>
        <ul class="sidebar__list">
          <li v-for="page in pagesForCategory(category.id)" :key="page.id" class="sidebar__item">
            <button
              type="button"
              class="sidebar__row"
              :class="{ 'sidebar__row--active': page.id === currentPageId }"
              @click="emit('select', page.id)"
            >
              <span class="sidebar__row-label">{{ page.title }}</span>
              <span
                v-if="settings.homePageId === page.id"
                class="sidebar__row-home"
                title="Home page"
                >⌂</span
              >
            </button>

            <DropdownMenuRoot>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="button button--icon button--tiny"
                  :aria-label="`Actions for ${page.title}`"
                >
                  ⋯
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
                  <DropdownMenuItem @select="setHome(page)">Set as home</DropdownMenuItem>
                  <DropdownMenuSeparator class="menu__separator" />
                  <DropdownMenuItem class="menu__danger" @select="remove(page)">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </li>
        </ul>
      </div>

      <div v-if="uncategorized.length" class="sidebar__group">
        <span class="sidebar__group-title">General</span>
        <ul class="sidebar__list">
          <li v-for="page in uncategorized" :key="page.id" class="sidebar__item">
            <button
              type="button"
              class="sidebar__row"
              :class="{ 'sidebar__row--active': page.id === currentPageId }"
              @click="emit('select', page.id)"
            >
              <span class="sidebar__row-label">{{ page.title }}</span>
              <span
                v-if="settings.homePageId === page.id"
                class="sidebar__row-home"
                title="Home page"
                >⌂</span
              >
            </button>

            <DropdownMenuRoot>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="button button--icon button--tiny"
                  :aria-label="`Actions for ${page.title}`"
                >
                  ⋯
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
                  <DropdownMenuItem @select="setHome(page)">Set as home</DropdownMenuItem>
                  <DropdownMenuSeparator class="menu__separator" />
                  <DropdownMenuItem class="menu__danger" @select="remove(page)">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </li>
        </ul>
      </div>

      <p v-if="pages.length === 0" class="sidebar__empty">No pages yet.</p>
    </div>

    <!-- rename dialog -->
    <DialogRoot :open="!!renameTarget" @update:open="onRenameOpenChange">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="dialog">
          <DialogTitle class="dialog__title">Rename page</DialogTitle>
          <form class="dialog__form" @submit.prevent="rename">
            <label class="dialog__field">
              <span>Title</span>
              <input v-model="renameTitle" class="dialog__input" autofocus />
            </label>
            <div class="dialog__actions">
              <button type="button" class="button button--ghost" @click="renameTarget = undefined">
                Cancel
              </button>
              <button type="submit" class="button button--primary">Rename</button>
            </div>
          </form>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
    <footer class="sidebar__footer">
      <NuxtLink to="/debug" class="button button--ghost button--small">⛭ debug lab</NuxtLink>
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

.sidebar__name {
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  min-width: 0;
  padding: 0.35rem 0.45rem;
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

.sidebar__row--today {
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
