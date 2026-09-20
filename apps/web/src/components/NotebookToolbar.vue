<script setup lang="ts">
import type { NotebookSession } from "~/lib/notebook";

const props = defineProps<{
  session: NotebookSession;
  /** Cell selected in command mode, or null while editing. */
  selected: number | null;
  autoRun: boolean;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (e: "runCell"): void;
  (e: "runAll"): void;
  (e: "restart"): void;
  (e: "clearOutput"): void;
  (e: "addCell"): void;
  (e: "toggleAutoRun"): void;
}>();

const activeIndex = computed(() => props.selected ?? props.session.active);

const status = computed(() => {
  if (props.session.running !== null) return "notebook.running";
  if (props.selected !== null) return "notebook.commandHint";

  return null;
});
</script>

<template>
  <div class="notebook-toolbar">
    <UiIconButton
      icon="play_arrow"
      :label="$t('notebook.runCell')"
      :disabled="disabled || activeIndex === null"
      @click="emit('runCell')"
    />
    <UiIconButton
      icon="fast_forward"
      :label="$t('notebook.runAll')"
      :disabled="disabled"
      @click="emit('runAll')"
    />
    <UiIconButton
      icon="restart_alt"
      :label="$t('notebook.restart')"
      :disabled="disabled"
      @click="emit('restart')"
    />
    <UiIconButton
      icon="add"
      :label="$t('notebook.addCell')"
      :disabled="disabled"
      @click="emit('addCell')"
    />
    <UiIconButton
      icon="delete_sweep"
      :label="$t('notebook.clearOutput')"
      :disabled="disabled || activeIndex === null"
      @click="emit('clearOutput')"
    />

    <span class="notebook-toolbar__spacer" />

    <span v-if="status" class="notebook-toolbar__status">{{ $t(status) }}</span>

    <UiSwitch
      class="notebook-toolbar__autorun"
      :model-value="autoRun"
      :label="$t('notebook.autoRun')"
      @update:model-value="emit('toggleAutoRun')"
    />
  </div>
</template>

<style scoped>
.notebook-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow-x: auto;
  scrollbar-width: none;
}

.notebook-toolbar::-webkit-scrollbar {
  display: none;
}

.notebook-toolbar__spacer {
  flex: 1;
}

.notebook-toolbar__status {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.notebook-toolbar__autorun {
  flex: none;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  white-space: nowrap;
}
</style>
