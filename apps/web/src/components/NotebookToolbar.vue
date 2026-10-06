<script setup lang="ts">
import { NOTEBOOK_CELL_TYPES } from "@typbase/codemirror";

import type { NotebookCellType, NotebookSession } from "~/lib/notebook";

const props = defineProps<{
  session: NotebookSession;
  /** The cell the actions apply to, or null when there is none. */
  active: number | null;
  disabled: boolean;
  compact: boolean;
}>();

const emit = defineEmits<{
  (e: "addCell"): void;
  (e: "split"): void;
  (e: "merge"): void;
  (e: "releaseAll"): void;
  (e: "setType", type: NotebookCellType): void;
}>();

const typeLabels: Record<NotebookCellType, string> = {
  prose: "notebook.prose",
  code: "notebook.code",
  log: "notebook.log",
  hidden: "notebook.hidden",
};

const activeType = computed<NotebookCellType>(
  () => props.session.cells[props.active ?? -1]?.kind ?? "prose",
);

const hasCell = computed(() => props.active !== null);
</script>

<template>
  <div class="notebook-toolbar" :class="{ 'notebook-toolbar--compact': compact }">
    <UiIconButton
      icon="add"
      :label="$t('notebook.addCell')"
      :disabled="disabled"
      @click="emit('addCell')"
    />

    <UiMenu align="start">
      <template #trigger>
        <UiIconButton
          icon="category"
          :label="$t('notebook.cellType')"
          :disabled="disabled || !hasCell"
        />
      </template>
      <DropdownMenuRadioGroup
        :model-value="activeType"
        @update:model-value="(value) => emit('setType', value as NotebookCellType)"
      >
        <DropdownMenuRadioItem
          v-for="type in NOTEBOOK_CELL_TYPES"
          :key="type"
          :value="type"
          class="menu__item"
          :disabled="disabled || !hasCell"
        >
          {{ $t(typeLabels[type]) }}
          <MsIcon name="check" :size="16" class="menu__item-check" />
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </UiMenu>

    <UiIconButton
      icon="call_split"
      :label="$t('notebook.split')"
      :disabled="disabled || !hasCell"
      @click="emit('split')"
    />
    <UiIconButton
      icon="merge_type"
      :label="$t('notebook.merge')"
      :disabled="disabled || props.active === null || props.active === 0"
      @click="emit('merge')"
    />
    <UiIconButton
      icon="play_arrow"
      :label="$t('notebook.releaseAll')"
      :disabled="disabled || Object.keys(session.held).length === 0"
      @click="emit('releaseAll')"
    />
  </div>
</template>

<style>
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

.notebook-toolbar--compact {
  position: sticky;
  bottom: 0;
  z-index: 2;
  border-top: 1px solid var(--color-border);
  border-bottom: none;
  padding-bottom: calc(var(--safe-bottom) + var(--space-1));
}
</style>
