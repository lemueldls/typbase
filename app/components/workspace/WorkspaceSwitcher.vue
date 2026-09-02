<script setup lang="ts">
import { useWorkspace } from "~/composables/workspace";

/**
 * Workspace switching: a full chooser card when no workspace is open
 * (mode="screen") and a popover menu for the sidebar (mode="menu").
 */
const props = defineProps<{ mode: "screen" | "menu" }>();

const {
  workspaces,
  activeWorkspaceId,
  switchWorkspace,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
} = useWorkspace();

const busy = ref(false);
const error = ref("");

const creating = ref(false);
const newName = ref("");
const newOpen = defineModel<boolean>("open", { default: false });

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

async function onCreate() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await createWorkspace(newName.value);
    newName.value = "";
    creating.value = false;
    if (props.mode === "menu") newOpen.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function onRename(info: { id: string; name: string }) {
  const name = window.prompt("Rename workspace", info.name);
  if (!name?.trim()) return;
  try {
    await renameWorkspace(info.id, name);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function onDelete(info: { id: string; name: string }) {
  if (!window.confirm(`Delete workspace "${info.name}" and all its pages? This cannot be undone.`))
    return;
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
</script>

<template>
  <div v-if="mode === 'screen'" class="ws-screen">
    <h1 class="ws-screen__title">Open a workspace</h1>

    <ul v-if="workspaces.length" class="ws-screen__list">
      <li v-for="info in workspaces" :key="info.id" class="ws-screen__item">
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
                ? "current"
                : `opened ${new Date(info.lastOpenedAt).toLocaleDateString()}`
            }}
          </span>
        </button>
        <div class="ws-screen__actions">
          <button type="button" class="button button--ghost button--tiny" @click="onRename(info)">
            Rename
          </button>
          <button
            type="button"
            class="button button--ghost button--tiny ws-screen__danger"
            @click="onDelete(info)"
          >
            Delete
          </button>
        </div>
      </li>
    </ul>
    <p v-else class="ws-screen__hint">No workspaces yet. Create one below.</p>

    <form class="ws-screen__create" @submit.prevent="onCreate">
      <input
        v-model="newName"
        class="dialog__input ws-screen__input"
        placeholder="New workspace name"
        aria-label="New workspace name"
      />
      <button type="submit" class="button button--primary" :disabled="busy">Create</button>
    </form>

    <p v-if="error" class="ws-screen__error">{{ error }}</p>
  </div>

  <template v-else>
    <PopoverRoot v-model:open="newOpen">
      <PopoverTrigger as-child>
        <slot>
          <button type="button" class="button button--icon" aria-label="Switch workspace">⇄</button>
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
            <span class="ws-menu__name">{{ info.name }}</span>
            <span class="ws-menu__actions">
              <button
                type="button"
                class="button button--ghost button--tiny"
                @click.stop="onRename(info)"
              >
                ⋯
              </button>
              <button
                type="button"
                class="button button--ghost button--tiny ws-menu__danger"
                @click.stop="onDelete(info)"
              >
                ✕
              </button>
            </span>
          </button>

          <div class="menu__separator" />

          <form class="ws-menu__create" @submit.prevent="onCreate">
            <input
              v-model="newName"
              class="settings__input ws-menu__input"
              placeholder="New workspace…"
              aria-label="New workspace name"
            />
            <button type="submit" class="button button--small button--primary" :disabled="busy">
              New
            </button>
          </form>

          <p v-if="error" class="ws-menu__error">{{ error }}</p>
          <p class="ws-menu__hint">Each workspace syncs as its own space; data never mixes.</p>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </template>
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

.ws-screen__create {
  display: flex;
  gap: 0.5rem;
}

.ws-screen__input {
  flex: 1;
  min-width: 0;
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

.ws-menu__create {
  display: flex;
  gap: 0.4rem;
  padding: 0.35rem 0.6rem;
}

.ws-menu__input {
  flex: 1;
  min-width: 0;
}

.ws-menu__hint {
  margin: 0.5rem 0 0;
  padding: 0.4rem 0.6rem 0.2rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
</style>
