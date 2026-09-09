<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

import type { EditCommand } from "~/lib/editorCommands";

/**
 * Typst formatting toolbar: inline wrappers, line prefixes, history. Sits in
 * the PageView toolbar row; commands hit the editor through EditablePane.
 */
defineProps<{ disabled?: boolean }>();

const emit = defineEmits<{ (e: "command", command: EditCommand): void }>();

const groups: Array<Array<{ command: EditCommand; icon: MaterialSymbol; label: string }>> = [
  [
    { command: "undo", icon: "undo", label: "undo" },
    { command: "redo", icon: "redo", label: "redo" },
  ],
  [
    { command: "bold", icon: "format_bold", label: "bold" },
    { command: "italic", icon: "format_italic", label: "italic" },
    { command: "underline", icon: "format_underlined", label: "underline" },
    { command: "strike", icon: "strikethrough_s", label: "strike" },
    { command: "code", icon: "code", label: "code" },
    { command: "math", icon: "functions", label: "math" },
    { command: "link", icon: "link", label: "link" },
  ],
  [
    { command: "heading1", icon: "format_h1", label: "heading1" },
    { command: "heading2", icon: "format_h2", label: "heading2" },
    { command: "heading3", icon: "format_h3", label: "heading3" },
  ],
  [
    { command: "bulletList", icon: "format_list_bulleted", label: "bulletList" },
    { command: "orderedList", icon: "format_list_numbered", label: "orderedList" },
  ],
];
</script>

<template>
  <ToolbarRoot
    class="edit-toolbar"
    :aria-label="$t('formatting.title')"
    :aria-disabled="disabled || undefined"
  >
    <template v-for="(group, index) in groups" :key="index">
      <ToolbarSeparator v-if="index > 0" class="edit-toolbar__separator" />
      <ToolbarButton
        v-for="item in group"
        :key="item.command"
        type="button"
        class="edit-toolbar__button"
        :aria-label="$t(`formatting.${item.label}`)"
        :disabled="disabled"
        @click="emit('command', item.command)"
      >
        <MsIcon :name="item.icon" :size="18" />
      </ToolbarButton>
    </template>
  </ToolbarRoot>
</template>

<style scoped>
/* Bare button row; the hosting `.page-view__format` strip supplies the
   background and scroll, so this stays flat and full-width. */
.edit-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
}

.edit-toolbar__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: 0.35rem;
  cursor: pointer;
}

.edit-toolbar__button:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-surface-3);
}

.edit-toolbar__button:disabled {
  opacity: 0.5;
  cursor: default;
}

.edit-toolbar__separator {
  width: 1px;
  height: 1.2rem;
  margin: 0 0.3rem;
  background: var(--color-border);
}
</style>
