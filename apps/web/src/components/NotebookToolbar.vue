<script setup lang="ts">
import type { NotebookSession } from "~/lib/notebook";

const props = defineProps<{
  session: NotebookSession;
  disabled: boolean;
  compact: boolean;
}>();

const emit = defineEmits<{
  (e: "addCell"): void;
  (e: "releaseAll"): void;
}>();
</script>

<template>
  <div class="notebook-toolbar" :class="{ 'notebook-toolbar--compact': compact }">
    <UiButton
      variant="ghost"
      size="small"
      icon="add"
      class="notebook-toolbar__add"
      :aria-label="$t('notebook.addCell')"
      :disabled="disabled"
      data-notebook-add-cell
      @click="emit('addCell')"
    >
      <span class="notebook-toolbar__add-label">{{ $t("notebook.addCell") }}</span>
    </UiButton>

    <div class="notebook-toolbar__actions">
      <UiIconButton
        variant="ghost"
        control="small"
        :size="18"
        icon="play_arrow"
        :label="$t('notebook.releaseAll')"
        :disabled="disabled || Object.keys(props.session.held).length === 0"
        @click="emit('releaseAll')"
      />
    </div>
  </div>
</template>

<style>
.notebook-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--pane-header-pad-x) var(--space-2);
  background: var(--color-surface-2);
  overflow-x: auto;
  scrollbar-width: none;
}

.notebook-toolbar::-webkit-scrollbar {
  display: none;
}

.notebook-toolbar > * {
  flex: none;
}

.notebook-toolbar__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}

.notebook-toolbar--compact .notebook-toolbar__add {
  width: var(--control-sm);
  padding: 0;
  gap: 0;
}

.notebook-toolbar--compact .notebook-toolbar__add-label {
  display: none;
}
</style>
