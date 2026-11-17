<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

import { DEFAULT_WORKSPACE_ICON } from "~/lib/symbols";

/**
 * The workspace identity shown in the main header when the sidebar is not
 * available. It combines the switcher with the workspace actions, so a
 * collapsed shell never loses the workspace context or its commands.
 */
const emit = defineEmits<{
  (e: "search"): void;
  (e: "account"): void;
  (e: "graph"): void;
  (e: "chat"): void;
  (e: "site"): void;
  (e: "files"): void;
}>();

const { workspaces, activeWorkspaceId, workspace } = useWorkspace();
const settings = useWorkspaceValue(
  workspace,
  ["settings"],
  (store) => store.getSettings(),
  undefined,
);

const workspaceIcon = computed<MaterialSymbol>(() => {
  const info = workspaces.value.find((entry) => entry.id === activeWorkspaceId.value);
  return (info?.icon as MaterialSymbol | undefined) ?? DEFAULT_WORKSPACE_ICON;
});
</script>

<template>
  <WorkspaceSwitcher mode="menu">
    <UiTooltip :text="$t('sidebar.workspaceActions')">
      <button type="button" class="workspace-crumb" :aria-label="$t('sidebar.workspaceActions')">
        <span class="workspace-crumb__icon">
          <MsIcon :name="workspaceIcon" :size="22" />
        </span>
        <span class="workspace-crumb__name">{{ settings?.name }}</span>
        <MsIcon class="workspace-crumb__separator" name="keyboard_arrow_right" />
      </button>
    </UiTooltip>

    <template #commands="{ close, openPackages }">
      <WorkspaceCommands
        standalone
        :close="close"
        :open-packages="openPackages"
        @search="emit('search')"
        @account="emit('account')"
        @graph="emit('graph')"
        @chat="emit('chat')"
        @site="emit('site')"
        @files="emit('files')"
      />
    </template>
  </WorkspaceSwitcher>
</template>

<style>
.workspace-crumb {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
  max-width: 12rem;
  height: var(--control-md);
  padding: 0 var(--space-0-5);
  font-family: inherit;
  font-size: var(--text-lg);
  color: var(--color-text-secondary);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.workspace-crumb:hover,
.workspace-crumb[data-state="open"] {
  color: var(--color-text);
  /* background: var(--color-surface-3); */
}

.workspace-crumb__icon {
  display: grid;
  place-content: center;
  width: var(--control-sm);
  height: var(--control-sm);
  flex: none;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: var(--radius-sm);
}

.workspace-crumb__name {
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-crumb:hover .workspace-crumb__name,
.workspace-crumb[data-state="open"] .workspace-crumb__name {
  color: var(--color-text);
}

.workspace-crumb__separator {
  flex: none;
  /* font-size: var(--text-md); */
  /* line-height: 1; */
  color: var(--color-text-secondary);
}

/* The name carries the identity once there is room for it. The icon takes
   over when the name is hidden, so the left cluster keeps one leading glyph
   in the common case instead of an icon plus text. */
@media (min-width: 40rem) {
  .workspace-crumb__icon {
    display: none;
  }
}

@media (max-width: 40rem) {
  .workspace-crumb__name {
    display: none;
  }
}
</style>
