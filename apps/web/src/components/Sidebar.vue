<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";

const props = defineProps<{
  store: WorkspaceStore;
  currentPageId: string | null;
}>();

const emit = defineEmits<{
  (e: "select", pageId: string): void;
  (e: "openPlugin", instanceId: string): void;
  /** Collapses the desktop panel / closes the mobile drawer. */
  (e: "collapseRequest"): void;
}>();

const { dataRevision, workspaces, activeWorkspaceId } = useWorkspace();
const { t, locale } = useI18n();

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

/** Today's daily note when it exists; the Today row's menu deletes it. */
const todayPage = computed(() => pages.value.find((page) => page.path === `daily/${todayISO}.typ`));

/** Day notes except today's, newest first; the "Today" row covers today. */
const recentDays = computed(() => {
  void dataRevision.value;

  return pages.value
    .filter(
      (page) =>
        page.path.startsWith("daily/") &&
        page.path.slice("daily/".length, "daily/".length + 10) !== todayISO,
    )
    .sort((a, b) => b.path.localeCompare(a.path))
    .slice(0, 7);
});

function dayLabel(page: PageMeta): string {
  const iso = page.path.slice("daily/".length, "daily/".length + 10);
  return new Intl.DateTimeFormat(locale.value, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

async function openToday() {
  const page = await props.store.createDailyNote(todayISO);
  emit("select", page.id);
}

const renameTarget = ref<PageMeta>();
const packagesOpen = ref(false);
const renameTitle = ref("");
/** Page queued for deletion. The target survives the dialog's close event:
 *  reka's action closes the dialog before the confirm handler runs. */
const pendingDelete = ref<PageMeta>();
const confirmOpen = ref(false);

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

function askRemove(page: PageMeta) {
  pendingDelete.value = page;
  confirmOpen.value = true;
}

async function confirmRemove() {
  const page = pendingDelete.value;
  if (!page) return;
  pendingDelete.value = undefined;
  confirmOpen.value = false;

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
      <WorkspaceSwitcher mode="menu">
        <UiTooltip :text="$t('sidebar.switchWorkspace')">
          <button type="button" class="sidebar__workspace">
            <MsIcon :name="workspaceIcon" :size="20" class="sidebar__icon" />
            <span class="sidebar__name">{{ settings.name }}</span>
            <MsIcon name="keyboard_arrow_down" :size="20" class="sidebar__chevron" />
          </button>
        </UiTooltip>
      </WorkspaceSwitcher>
      <div class="sidebar__header-actions">
        <SettingsPopover :store="store">
          <UiIconButton icon="settings" :label="$t('sidebar.workspaceSettings')" />
        </SettingsPopover>
        <!-- <UiIconButton
          icon="chevron_left"
          :label="$t('sidebar.hideSidebar')"
          class="sidebar__collapse"
          @click="emit('collapseRequest')"
        /> -->
      </div>
    </header>

    <div class="sidebar__sections">
      <div class="sidebar__section">
        <div class="sidebar__section-title">
          <span>{{ $t("sidebar.daily") }}</span>
          <div class="sidebar__section-actions">
            <CalendarDialog :store="store" @select="emit('select', $event)">
              <UiIconButton icon="calendar_month" :label="$t('sidebar.calendar')" variant="ghost" />
            </CalendarDialog>
          </div>
        </div>

        <ul class="sidebar__list">
          <li
            class="sidebar__item"
            :class="{ 'sidebar__item--active': todayPage && todayPage.id === currentPageId }"
          >
            <button
              type="button"
              class="sidebar__row sidebar__row--today"
              :aria-current="todayPage && todayPage.id === currentPageId ? 'page' : undefined"
              @click="openToday"
            >
              <MsIcon name="calendar_today" :size="20" />
              {{ $t("sidebar.today") }}
            </button>
            <UiMenu v-if="todayPage">
              <template #trigger>
                <UiIconButton
                  icon="more_vert"
                  :size="20"
                  :label="t('sidebar.actions', { title: todayPage.title })"
                  variant="ghost"
                  class="button--tiny sidebar__row-more"
                />
              </template>
              <UiMenuItem danger icon="delete" @select="askRemove(todayPage)">
                {{ $t("sidebar.delete") }}
              </UiMenuItem>
            </UiMenu>
          </li>

          <!-- Day notes, most recent first. Tapping opens the note; the Today
             row above creates today's lazily on first tap. -->
          <li
            v-for="day in recentDays"
            :key="day.id"
            class="sidebar__item"
            :class="{ 'sidebar__item--active': day.id === currentPageId }"
          >
            <button
              type="button"
              class="sidebar__row"
              :aria-current="day.id === currentPageId ? 'page' : undefined"
              @click="emit('select', day.id)"
            >
              <MsIcon name="calendar_month" :size="20" />
              <UiTruncatedText class="sidebar__day-label" :text="dayLabel(day)" />
            </button>
            <UiMenu>
              <template #trigger>
                <UiIconButton
                  icon="more_vert"
                  :size="20"
                  :label="t('sidebar.actions', { title: day.title })"
                  variant="ghost"
                  class="button--tiny sidebar__row-more"
                />
              </template>
              <UiMenuItem danger icon="delete" @select="askRemove(day)">
                {{ $t("sidebar.delete") }}
              </UiMenuItem>
            </UiMenu>
          </li>
        </ul>
      </div>

      <div class="sidebar__section">
        <div class="sidebar__section-title">
          <span>{{ $t("sidebar.pages") }}</span>
          <div class="sidebar__section-actions">
            <NewPageDialog :store="store" @created="onCreated">
              <UiIconButton icon="add" :label="$t('sidebar.newPage')" variant="ghost" :size="20" />
            </NewPageDialog>
            <!-- <CategoriesDialog :store="store">
            <UiIconButton icon="category" :label="$t('sidebar.categories')" />
          </CategoriesDialog> -->
          </div>
        </div>

        <button
          v-if="settings.homePageId"
          type="button"
          class="sidebar__row sidebar__row--home"
          @click="emit('select', settings.homePageId)"
        >
          <MsIcon name="home" :size="20" />
          {{ $t("sidebar.home") }}
        </button>

        <div v-for="category in categories" :key="category.id" class="sidebar__group">
          <span class="sidebar__group-title">{{ category.name }}</span>
          <ul class="sidebar__list">
            <li
              v-for="page in pagesForCategory(category.id)"
              :key="page.id"
              class="sidebar__item"
              :class="{ 'sidebar__item--active': page.id === currentPageId }"
            >
              <button
                type="button"
                class="sidebar__row"
                :aria-current="page.id === currentPageId ? 'page' : undefined"
                @click="emit('select', page.id)"
              >
                <UiTruncatedText class="sidebar__row-label" :text="page.title" />
                <UiTooltip v-if="settings.homePageId === page.id" :text="$t('sidebar.homePage')">
                  <span class="sidebar__row-home">
                    <MsIcon name="home" :size="20" />
                  </span>
                </UiTooltip>
              </button>

              <UiMenu>
                <template #trigger>
                  <UiIconButton
                    icon="more_vert"
                    :size="20"
                    :label="t('sidebar.actions', { title: page.title })"
                    variant="ghost"
                    class="button--tiny sidebar__row-more"
                  />
                </template>

                <UiMenuItem
                  @select="
                    renameTarget = page;
                    renameTitle = page.title;
                  "
                >
                  {{ $t("common.rename") }}
                </UiMenuItem>
                <UiMenuItem @select="setHome(page)">{{ $t("sidebar.setHome") }}</UiMenuItem>
                <UiMenuSeparator />
                <UiMenuItem danger @select="askRemove(page)">
                  {{ $t("sidebar.delete") }}
                </UiMenuItem>
              </UiMenu>
            </li>
          </ul>
        </div>

        <div v-if="uncategorized.length" class="sidebar__group">
          <span class="sidebar__group-title">{{ $t("sidebar.general") }}</span>
          <ul class="sidebar__list">
            <li
              v-for="page in uncategorized"
              :key="page.id"
              class="sidebar__item"
              :class="{ 'sidebar__item--active': page.id === currentPageId }"
            >
              <button
                type="button"
                class="sidebar__row"
                :aria-current="page.id === currentPageId ? 'page' : undefined"
                @click="emit('select', page.id)"
              >
                <UiTruncatedText class="sidebar__row-label" :text="page.title" />
                <UiTooltip v-if="settings.homePageId === page.id" :text="$t('sidebar.homePage')">
                  <span class="sidebar__row-home">
                    <MsIcon name="home" :size="20" />
                  </span>
                </UiTooltip>
              </button>

              <UiMenu>
                <template #trigger>
                  <UiIconButton
                    icon="more_vert"
                    :size="20"
                    :label="t('sidebar.actions', { title: page.title })"
                    variant="ghost"
                    class="button--tiny sidebar__row-more"
                  />
                </template>

                <UiMenuItem
                  @select="
                    renameTarget = page;
                    renameTitle = page.title;
                  "
                >
                  {{ $t("common.rename") }}
                </UiMenuItem>
                <UiMenuItem @select="setHome(page)">{{ $t("sidebar.setHome") }}</UiMenuItem>
                <UiMenuSeparator />
                <UiMenuItem danger @select="askRemove(page)">
                  {{ $t("sidebar.delete") }}
                </UiMenuItem>
              </UiMenu>
            </li>
          </ul>
        </div>

        <p v-if="pages.length === 0" class="sidebar__empty">{{ $t("sidebar.noPages") }}</p>
      </div>

      <div class="sidebar__section">
        <PluginSidebar @open-plugin="emit('openPlugin', $event)" />
      </div>
    </div>

    <!-- rename dialog -->
    <UiDialog
      :open="renameTarget !== undefined"
      :title="$t('sidebar.renameTitle')"
      @update:open="onRenameOpenChange"
    >
      <form class="dialog__form" @submit.prevent="rename">
        <Label class="dialog__field">
          <span>{{ $t("sidebar.title") }}</span>
          <input v-model="renameTitle" class="dialog__input" autofocus />
        </Label>
        <div class="dialog__actions">
          <button type="button" class="button button--ghost" @click="renameTarget = undefined">
            {{ $t("common.cancel") }}
          </button>
          <button type="submit" class="button button--primary">
            {{ $t("sidebar.rename") }}
          </button>
        </div>
      </form>
    </UiDialog>

    <UiConfirmDialog
      :open="confirmOpen"
      :title="$t('sidebar.deleteTitle')"
      :description="$t('sidebar.deleteConfirm', { title: pendingDelete?.title ?? '' })"
      @update:open="(value) => !value && (confirmOpen = false)"
      @confirm="confirmRemove"
    />

    <footer class="sidebar__footer">
      <!-- <NuxtLink to="/debug" class="button button--ghost button--small">
        <MsIcon name="science" :size="16" />
        {{ $t("sidebar.debugLab") }}
      </NuxtLink> -->
      <PackageBrowser v-model:open="packagesOpen" :store="store">
        <button type="button" class="button button--ghost button--tiny">
          <MsIcon name="package_2" :size="16" />
          {{ $t("packages.title") }}
        </button>
      </PackageBrowser>
      <WorkspaceExportDialog :store="store">
        <button type="button" class="button button--ghost button--tiny">
          <MsIcon name="download" :size="16" />
          {{ $t("exportWorkspace.title") }}
        </button>
      </WorkspaceExportDialog>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}

/* Matches the page toolbar's min-height so the app chrome lines up. */
.sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3-5);
  border-bottom: 1px solid var(--color-border);
}

.sidebar__workspace {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  flex: 1;
  min-width: 0;
  height: var(--control-md);
  padding: var(--space-1) var(--space-1-5);
  margin-left: calc(var(--space-1-5) * -1);
  font-family: inherit;
  font-size: var(--text-lg);
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.sidebar__workspace:hover,
.sidebar__workspace[data-state="open"] {
  background: var(--color-surface-2);
}

.sidebar__icon {
  flex: none;
}

.sidebar__chevron {
  flex: none;
  color: var(--color-text-secondary);
}

.sidebar__name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-xl);
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.sidebar__header-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.sidebar__sections {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar__section {
  padding: var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  overflow-y: auto;
}

.sidebar__section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 0 var(--space-1-5);
  font-size: var(--text-md);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.sidebar__section-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.sidebar__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.sidebar__day-label {
  min-width: 0;
}

.sidebar__item {
  display: flex;
  align-items: center;
  gap: var(--space-0-5);
  padding-right: var(--space-1);
  border-radius: var(--radius-sm);
  transition: background 0.12s ease;
}

/* The highlight covers the whole item, menu button included, so the row and
   its actions read as one surface. */
.sidebar__item:hover {
  background: var(--color-surface-2);
}

.sidebar__item--active,
.sidebar__item--active:hover {
  background: var(--color-accent-soft);
}

.sidebar__item .sidebar__row:hover {
  background: transparent;
}

.sidebar__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  width: 100%;
  min-width: 0;
  padding: var(--space-2) var(--space-2-5);
  font-size: var(--text-md);
  text-align: left;
  font-family: inherit;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.sidebar__row:hover {
  background: var(--color-surface-2);
}

/* The row's menu button: revealed on hover/focus and tinted like the row
   surface instead of carrying its own button chrome. :deep() because the
   class sits on UiIconButton's inner button. */
.sidebar__item :deep(.sidebar__row-more) {
  flex: none;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.sidebar__item :deep(.sidebar__row-more:hover),
.sidebar__item :deep(.sidebar__row-more[data-state="open"]) {
  background: color-mix(in srgb, var(--color-text) 10%, transparent);
}

.sidebar__item:hover :deep(.sidebar__row-more),
.sidebar__item :deep(.sidebar__row-more:focus-visible),
.sidebar__item :deep(.sidebar__row-more[data-state="open"]) {
  opacity: 1;
}

@media (hover: none) {
  .sidebar__item :deep(.sidebar__row-more) {
    opacity: 1;
  }
}

.sidebar__row--today,
.sidebar__row--calendar {
  font-weight: 600;
}

.sidebar__row-label {
  min-width: 0;
}

.sidebar__row-home {
  color: var(--color-text-secondary);
  font-size: var(--text-md);
}

.sidebar__group {
  margin-bottom: var(--space-2);
}

.sidebar__group-title {
  display: block;
  padding: var(--space-1-5) var(--space-2) var(--space-1);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.sidebar__empty {
  padding: var(--space-2);
  font-size: var(--text-md);
  color: var(--color-text-secondary);
}

.sidebar__footer {
  padding: var(--space-2);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  justify-content: flex-end;
}

/* The two footer actions share one row at text-xs; longer locales wrap. */
.sidebar__footer .button {
  font-size: var(--text-xs);
}
</style>
