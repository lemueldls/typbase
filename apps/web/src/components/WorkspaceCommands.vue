<script setup lang="ts">
import { pushToast } from "~/composables/toasts";

/**
 * The command half of the workspace menu. The collapsed-shell crumb puts it
 * above the workspace list in `WorkspaceSwitcher`, and `WorkspaceActions`
 * renders it on its own, so the actions stay reachable with the sidebar
 * collapsed or hidden.
 */
const props = defineProps<{
  /** Closes the popover that hosts the command group. */
  close?: () => void;
  /** Opens the package browser, which lives outside the popover. */
  openPackages?: () => void;
  /** Omit the leading separator; the host already separates the group. */
  standalone?: boolean;
}>();

const emit = defineEmits<{
  (e: "search"): void;
  (e: "account"): void;
  (e: "graph"): void;
  (e: "chat"): void;
  (e: "site"): void;
  (e: "files"): void;
}>();

const { workspace, activeWorkspaceId, atprotoStatus } = useWorkspace();
const settings = useWorkspaceValue(
  workspace,
  ["settings"],
  (store) => store.getSettings(),
  undefined,
);
const aiEnabled = computed(() => settings.value?.ai.enabled ?? false);

const accountLabel = computed(() =>
  atprotoStatus.value.signedIn ? "account.menuLabel" : "account.signIn",
);

const settingsDialog = useSettingsDialog();

function run(action: () => void): void {
  // The navigation handlers consume the top layer, which is this popover.
  // Close after the action so its watcher sees the consumed entry.
  action();
  props.close?.();
}

function openPackageBrowser(): void {
  props.openPackages?.();
}

async function copyWorkspaceId(): Promise<void> {
  const id = activeWorkspaceId.value;
  if (!id) return;

  try {
    await navigator.clipboard.writeText(id);
    pushToast({ titleKey: "common.copied", duration: 1800 });
  } catch (cause) {
    console.error("[workspace] copy id failed:", cause);
  }
  props.close?.();
}
</script>

<template>
  <div v-if="!standalone" class="menu__separator" />

  <button type="button" class="menu__item" @click="run(() => emit('search'))">
    <MsIcon name="search" :size="20" />
    <span class="workspace-commands__label">{{ $t("palette.title") }}</span>
  </button>
  <button type="button" class="menu__item" @click="run(() => emit('graph'))">
    <MsIcon name="hub" :size="20" />
    <span class="workspace-commands__label">{{ $t("graph.title") }}</span>
  </button>
  <button v-if="aiEnabled" type="button" class="menu__item" @click="run(() => emit('chat'))">
    <MsIcon name="forum" :size="20" />
    <span class="workspace-commands__label">{{ $t("chat.title") }}</span>
  </button>

  <div class="menu__separator" />

  <button type="button" class="menu__item" @click="run(() => settingsDialog.show())">
    <MsIcon name="settings" :size="20" />
    <span class="workspace-commands__label">{{ $t("sidebar.workspaceSettings") }}</span>
  </button>
  <button type="button" class="menu__item" @click="run(() => emit('site'))">
    <MsIcon name="public" :size="20" />
    <span class="workspace-commands__label">{{ $t("site.title") }}</span>
  </button>
  <button type="button" class="menu__item" @click="run(() => emit('files'))">
    <MsIcon name="folder_open" :size="20" />
    <span class="workspace-commands__label">{{ $t("explorer.title") }}</span>
  </button>
  <button type="button" class="menu__item" @click="openPackageBrowser">
    <MsIcon name="package_2" :size="20" />
    <span class="workspace-commands__label">{{ $t("packages.title") }}</span>
  </button>

  <div class="menu__separator" />

  <button type="button" class="menu__item" @click="run(() => emit('account'))">
    <MsIcon name="account_circle" :size="20" />
    <span class="workspace-commands__label">{{ $t(accountLabel) }}</span>
  </button>
  <button type="button" class="menu__item" @click="void copyWorkspaceId()">
    <MsIcon name="content_copy" :size="20" />
    <span class="workspace-commands__label">{{ $t("common.copyWorkspaceId") }}</span>
  </button>
</template>

<style>
.workspace-commands__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
