<script setup lang="ts">
import type { WorkspaceInfo } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { useWorkspace } from "~/composables/workspace";
import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";

import WorkspaceDialog from "./WorkspaceDialog.vue";

/**
 * Workspace switching: a full chooser card when no workspace is open
 * (mode="screen") and a popover menu for the sidebar (mode="menu"). Create
 * and edit go through WorkspaceDialog; delete stays a confirm.
 */
const props = defineProps<{ mode: "screen" | "menu" }>();

const { workspaces, activeWorkspaceId, switchWorkspace, deleteWorkspace } = useWorkspace();

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

function openCreate() {
  dialogMode.value = "create";
  editing.value = null;
  dialogOpen.value = true;
}

function openRename(info: WorkspaceInfo) {
  dialogMode.value = "edit";
  editing.value = info;
  dialogOpen.value = true;
}

async function onSwitch(id: string) {
  if (id === activeWorkspaceId.value || busy.value) return;
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

async function onDelete(info: WorkspaceInfo) {
  if (!window.confirm(t("switcher.deleteConfirm", { name: info.name }))) return;
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

function iconFor(info: WorkspaceInfo): MaterialSymbol {
  return (info.icon as MaterialSymbol | undefined) ?? DEFAULT_WORKSPACE_ICON;
}
</script>

<template>
  <div v-if="mode === 'screen'" class="ws-screen">
    <h1 class="ws-screen__title">{{ $t("switcher.title") }}</h1>

    <ul v-if="workspaces.length" class="ws-screen__list">
      <li v-for="info in workspaces" :key="info.id" class="ws-screen__item">
        <span class="ws-screen__icon" aria-hidden="true">
          <MsIcon :name="iconFor(info)" :size="20" />
        </span>
        <button
          type="button"
          class="ws-screen__open"
          :class="{ 'ws-screen__open--active': active(info.id) }"
          :disabled="busy"
          @click="onSwitch(info.id)"
        >
          <span class="ws-screen__name">{{ info.name }}</span>
          <span class="ws-screen__meta">
            {{
              active(info.id)
                ? $t("switcher.current")
                : $t("switcher.opened", { date: formatOpened(info.lastOpenedAt) })
            }}
          </span>
        </button>
        <div class="ws-screen__actions">
          <button
            type="button"
            class="button button--ghost button--tiny"
            :aria-label="t('switcher.renameAria', { name: info.name })"
            @click="openRename(info)"
          >
            <MsIcon name="edit" :size="12" /> Rename
          </button>
          <button
            type="button"
            class="button button--ghost button--tiny ws-screen__danger"
            :aria-label="t('switcher.deleteAria', { name: info.name })"
            @click="onDelete(info)"
          >
            <MsIcon name="delete" :size="12" /> Delete
          </button>
        </div>
      </li>
    </ul>
    <p v-else class="ws-screen__hint">{{ $t("switcher.noWorkspaces") }}</p>

    <button
      type="button"
      class="button button--primary ws-screen__add"
      :disabled="busy"
      @click="openCreate"
    >
      <MsIcon name="add" :size="16" />
      {{ $t("switcher.add") }}
    </button>

    <p v-if="error" class="ws-screen__error" role="alert">{{ error }}</p>
  </div>

  <template v-else>
    <PopoverRoot v-model:open="newOpen">
      <PopoverTrigger as-child>
        <slot>
          <button type="button" class="button button--icon" :aria-label="$t('switcher.switchAria')">
            <MsIcon name="swap_horiz" :size="16" />
          </button>
        </slot>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="menu ws-menu" :side-offset="6" align="start">
          <button
            v-for="info in workspaces"
            :key="info.id"
            type="button"
            class="menu__item ws-menu__item"
            :class="{ 'ws-menu__item--active': active(info.id) }"
            :disabled="busy"
            @click="onSwitch(info.id)"
          >
            <span class="ws-menu__label">
              <MsIcon :name="iconFor(info)" :size="16" class="ws-menu__icon" />
              <span class="ws-menu__name">{{ info.name }}</span>
            </span>
            <span class="ws-menu__actions">
              <button
                type="button"
                class="button button--ghost button--tiny"
                :aria-label="t('switcher.renameAria', { name: info.name })"
                @click.stop="openRename(info)"
              >
                <MsIcon name="edit" :size="12" />
              </button>
              <button
                type="button"
                class="button button--ghost button--tiny ws-menu__danger"
                :aria-label="t('switcher.deleteAria', { name: info.name })"
                @click.stop="onDelete(info)"
              >
                <MsIcon name="delete" :size="12" />
              </button>
            </span>
          </button>

          <div class="menu__separator" />

          <button type="button" class="menu__item ws-menu__add" @click="openCreate">
            <MsIcon name="add" :size="16" />
            {{ $t("switcher.add") }}
          </button>

          <p v-if="error" class="ws-menu__error" role="alert">{{ error }}</p>
          <p class="ws-menu__hint">{{ $t("switcher.hint") }}</p>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </template>

  <WorkspaceDialog v-model:open="dialogOpen" :mode="dialogMode" :workspace="editing" />
</template>

<style scoped>
.ws-screen {
  display: grid;
  place-content: center;
  gap: 1rem;
  width: min(480px, calc(100vw - 2rem));
  margin: 0 auto;
}

.ws-screen__title {
  margin: 0;
  text-align: center;
  font-size: 1.3rem;
}

.ws-screen__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ws-screen__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface);
}

.ws-screen__icon {
  display: grid;
  place-content: center;
  width: 2.2rem;
  height: 2.2rem;
  flex: none;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 0.5rem;
}

.ws-screen__open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  align-items: flex-start;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  color: var(--text);
}

.ws-screen__open--active .ws-screen__name {
  color: var(--accent);
}

.ws-screen__name {
  font-weight: 600;
}

.ws-screen__meta {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.ws-screen__actions {
  display: flex;
  gap: 0.25rem;
}

.ws-screen__danger,
.ws-menu__danger {
  color: var(--danger);
}

.ws-screen__hint {
  color: var(--text-secondary);
  text-align: center;
}

.ws-screen__add {
  justify-content: center;
}

.ws-screen__error,
.ws-menu__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.85rem;
}

.ws-menu {
  width: min(280px, calc(100vw - 2rem));
}

.ws-menu__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.ws-menu__item--active .ws-menu__name {
  color: var(--accent);
}

.ws-menu__label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.ws-menu__icon {
  flex: none;
  color: var(--text-secondary);
}

.ws-menu__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-menu__actions {
  display: inline-flex;
  gap: 0.1rem;
}

.ws-menu__add {
  color: var(--accent);
}

.ws-menu__hint {
  margin: 0;
  padding: 0.35rem 0.6rem 0.5rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
</style>
