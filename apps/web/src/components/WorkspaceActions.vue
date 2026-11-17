<script setup lang="ts">
/**
 * The workspace actions menu. It sits beside the workspace name so settings,
 * site, files, packages, and the account are discoverable without opening the
 * switcher first. The switcher stays a switcher.
 */
const emit = defineEmits<{
  (e: "search"): void;
  (e: "account"): void;
  (e: "graph"): void;
  (e: "chat"): void;
  (e: "site"): void;
  (e: "files"): void;
}>();

const { workspace } = useWorkspace();
const open = ref(false);
const packagesOpen = ref(false);

function closeMenu(): void {
  open.value = false;
}

function openPackages(): void {
  open.value = false;
  packagesOpen.value = true;
}
</script>

<template>
  <UiPopover v-model:open="open" class="menu ws-menu" align="center">
    <template #trigger>
      <slot>
        <UiIconButton icon="more_vert" :label="$t('sidebar.workspaceActions')" />
      </slot>
    </template>

    <div class="ws-menu__header">
      <span>{{ $t("sidebar.workspaceActions") }}</span>
    </div>

    <WorkspaceCommands
      standalone
      :close="closeMenu"
      :open-packages="openPackages"
      @search="emit('search')"
      @account="emit('account')"
      @graph="emit('graph')"
      @chat="emit('chat')"
      @site="emit('site')"
      @files="emit('files')"
    />
  </UiPopover>

  <PackageBrowser v-if="workspace" v-model:open="packagesOpen" :store="workspace" />
</template>
