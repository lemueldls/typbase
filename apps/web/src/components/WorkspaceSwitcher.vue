<script setup lang="ts">
import type { WorkspaceInfo } from "@typbase/typing";

const props = defineProps<{ mode: "screen" | "menu" }>();

const {
  workspaces,
  activeWorkspaceId,
  switching,
  switchWorkspace,
  deleteWorkspace,
  reorderWorkspaces,
} = useWorkspace();

const {
  dragging: draggingWorkspace,
  gapIndex: workspaceGapIndex,
  rowHeight: workspaceRowHeight,
  dragged: workspaceDragged,
  start: startWorkspaceDrag,
} = useListDrag({
  itemSelector: "[data-drag-workspace]",
  container: () => document.querySelector<HTMLElement>('[data-drag-list="workspaces"]'),
  ids: () => workspaces.value.map((info) => info.id),
  onReorder: (ids) => void reorderWorkspaces(ids),
});

/** The open slot, sized to the held row. */
const workspaceGapStyle = computed(() => ({ height: `${workspaceRowHeight.value ?? 0}px` }));

/** Moves one workspace a slot; the registry array is the order. */
function moveWorkspace(index: number, delta: -1 | 1): void {
  const ids = workspaces.value.map((info) => info.id);
  const to = index + delta;
  if (to < 0 || to >= ids.length) return;

  const [id] = ids.splice(index, 1);
  ids.splice(to, 0, id!);
  void reorderWorkspaces(ids);
}

const { t, locale } = useI18n();
function formatOpened(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value).format(new Date(timestamp));
}

const busy = ref(false);
const error = ref("");

const newOpen = defineModel<boolean>("open", { default: false });

const dialogOpen = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const editing = ref<WorkspaceInfo | null>(null);

/** Workspace queued for deletion. The target survives the dialog's close
 *  event: reka's action closes the dialog before the confirm handler runs. */
const pendingDelete = ref<WorkspaceInfo | null>(null);
const confirmOpen = ref(false);

function askDelete(info: WorkspaceInfo) {
  pendingDelete.value = info;
  confirmOpen.value = true;
}

function openCreate() {
  if (props.mode === "menu") newOpen.value = false;
  dialogMode.value = "create";
  editing.value = null;
  dialogOpen.value = true;
}

function openRename(info: WorkspaceInfo) {
  if (props.mode === "menu") newOpen.value = false;
  dialogMode.value = "edit";
  editing.value = info;
  dialogOpen.value = true;
}

async function onSwitch(id: string) {
  // A drop still fires a click on whatever sits under the pointer.
  if (id === activeWorkspaceId.value || busy.value || workspaceDragged.value) return;
  busy.value = true;
  error.value = "";
  try {
    await switchWorkspace(id);
    if (props.mode === "menu") newOpen.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function confirmDelete() {
  const info = pendingDelete.value;
  if (!info) return;
  pendingDelete.value = null;
  confirmOpen.value = false;

  try {
    if (props.mode === "menu") newOpen.value = false;
    await deleteWorkspace(info.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function active(id: string | null): boolean {
  return id != null && id === activeWorkspaceId.value;
}

function statusFor(info: WorkspaceInfo): string {
  if (active(info.id)) return t("switcher.current");

  return t("switcher.opened", { date: formatOpened(info.lastOpenedAt) });
}
</script>

<template>
  <div v-if="mode === 'screen'" class="ws-screen">
    <header class="ws-screen__header" data-tauri-drag-region="deep">
      <h1 class="ws-screen__title">{{ $t("switcher.title") }}</h1>
      <!-- <p class="ws-screen__subtitle">{{ $t("switcher.hint") }}</p> -->
    </header>

    <ul v-if="workspaces.length" class="ws-screen__list" data-drag-list="workspaces">
      <template v-for="(info, index) in workspaces" :key="info.id">
        <li
          v-if="workspaceGapIndex === index"
          class="ws-gap"
          data-drag-gap
          :style="workspaceGapStyle"
          aria-hidden="true"
        />
        <li>
          <WorkspaceRow
            :info="info"
            :active="active(info.id)"
            :switching="switching === info.id"
            :disabled="busy"
            :status="statusFor(info)"
            :first="index === 0"
            :last="index === workspaces.length - 1"
            :dragging="draggingWorkspace === info.id"
            @select="onSwitch(info.id)"
            @rename="openRename(info)"
            @remove="askDelete(info)"
            @move="(delta) => moveWorkspace(index, delta)"
            @drag-start="(event) => startWorkspaceDrag(event, info.id)"
          />
        </li>
      </template>
      <li
        v-if="workspaceGapIndex === workspaces.length"
        class="ws-gap"
        data-drag-gap
        :style="workspaceGapStyle"
        aria-hidden="true"
      />
    </ul>
    <p v-else class="ws-screen__hint">{{ $t("switcher.noWorkspaces") }}</p>

    <UiButton variant="primary" class="ws-screen__add" :disabled="busy" @click="openCreate">
      <MsIcon name="add" :size="20" />
      {{ $t("switcher.add") }}
    </UiButton>

    <p v-if="error" class="ws-screen__error" role="alert">{{ error }}</p>
  </div>

  <template v-else>
    <UiPopover v-model:open="newOpen" class="menu ws-menu" align="start" :side-offset="6">
      <template #trigger>
        <slot>
          <UiIconButton icon="swap_horiz" :label="$t('switcher.switchAria')" />
        </slot>
      </template>

      <div class="ws-menu__header">
        <span>{{ $t("switcher.heading") }}</span>
        <span class="ws-menu__count">{{ workspaces.length }}</span>
      </div>

      <ul class="ws-menu__list" data-drag-list="workspaces">
        <template v-for="(info, index) in workspaces" :key="info.id">
          <li
            v-if="workspaceGapIndex === index"
            class="ws-gap"
            data-drag-gap
            :style="workspaceGapStyle"
            aria-hidden="true"
          />
          <li>
            <WorkspaceRow
              :info="info"
              :active="active(info.id)"
              :switching="switching === info.id"
              :disabled="busy"
              :status="statusFor(info)"
              :first="index === 0"
              :last="index === workspaces.length - 1"
              :dragging="draggingWorkspace === info.id"
              @select="onSwitch(info.id)"
              @rename="openRename(info)"
              @remove="askDelete(info)"
              @move="(delta) => moveWorkspace(index, delta)"
              @drag-start="(event) => startWorkspaceDrag(event, info.id)"
            />
          </li>
        </template>
        <li
          v-if="workspaceGapIndex === workspaces.length"
          class="ws-gap"
          data-drag-gap
          :style="workspaceGapStyle"
          aria-hidden="true"
        />
      </ul>

      <div class="menu__separator" />

      <button type="button" class="menu__item ws-menu__add" @click="openCreate">
        <MsIcon name="add" :size="20" />
        {{ $t("switcher.add") }}
      </button>

      <p v-if="error" class="ws-menu__error" role="alert">{{ error }}</p>
      <!-- <p class="ws-menu__hint">{{ $t("switcher.hint") }}</p> -->
    </UiPopover>
  </template>

  <WorkspaceDialog v-model:open="dialogOpen" :mode="dialogMode" :workspace="editing" />

  <UiConfirmDialog
    :open="confirmOpen"
    :title="$t('switcher.deleteTitle')"
    :description="$t('switcher.deleteConfirm', { name: pendingDelete?.name ?? '' })"
    @update:open="(value) => !value && (confirmOpen = false)"
    @confirm="confirmDelete"
  />
</template>

<style>
.ws-screen {
  display: grid;
  place-content: center;
  gap: var(--space-4);
  width: min(480px, calc(100vw - var(--space-8) - var(--safe-left) - var(--safe-right)));
  margin: 0 auto;
}

.ws-screen__header {
  text-align: center;
}

.ws-screen__title {
  margin: 0 0 var(--space-1-5);
  font-size: var(--text-2xl);
}

.ws-screen__subtitle {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.ws-screen__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
}

.ws-screen__list > li {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.ws-screen__list > .ws-gap,
.ws-menu__list > .ws-gap {
  flex: none;
  background: var(--color-accent-soft);
  border: 1px dashed var(--color-accent);
  border-radius: var(--radius-sm);
}

.ws-screen__hint {
  color: var(--color-text-secondary);
  text-align: center;
}

.ws-screen__add {
  justify-content: center;
}

.ws-screen__error,
.ws-menu__error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-md);
}

.ws-menu {
  width: min(320px, calc(100vw - var(--space-8)));
  padding: var(--space-1-5);
}

.ws-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1-5) var(--space-2-5) var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.ws-menu__count {
  font-weight: 500;
}

.ws-menu__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.ws-menu__add {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  color: var(--color-accent);
  font-weight: 600;
}

.ws-menu__hint {
  margin: 0;
  padding: var(--space-1-5) var(--space-2-5) var(--space-1-5);
  font-size: var(--text-xs);
  line-height: var(--leading-tight);
  color: var(--color-text-secondary);
}
</style>
