<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

/**
 * The whole-workspace export on its own, opened from the app bar's file menu.
 * The panel is the same one Settings renders; this only gives it a dialog and a
 * home outside the settings tree, which is where a user looks for "export".
 *
 * The dialog's content unmounts when it closes, so the panel mounts fresh each
 * open and re-selects every page.
 */
const props = defineProps<{ store: WorkspaceStore }>();

const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <UiDialog
    v-model:open="open"
    class="workspace-export-dialog"
    :title="$t('exportWorkspace.title')"
  >
    <template v-if="$slots.default" #trigger>
      <slot />
    </template>

    <WorkspaceExportPanel :store="props.store" />
  </UiDialog>
</template>

<style>
.workspace-export-dialog {
  width: min(760px, calc(100vw - var(--space-8)));
}
</style>
