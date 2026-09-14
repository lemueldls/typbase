<script setup lang="ts">
import type { EditorView } from "@codemirror/view";
import type { MaterialSymbol } from "material-symbols";

import { redo, undo } from "@codemirror/commands";
import {
  cycleHeading,
  toggleCode,
  toggleEmph,
  toggleEnum,
  toggleList,
  toggleMath,
  toggleStrong,
  toggleStrike,
  toggleUnderline,
} from "@typbase/codemirror";

const props = defineProps<{
  view?: EditorView | null;
  disabled?: boolean;
}>();

interface ToolbarItem {
  id: string;
  run: (view: EditorView) => void;
  icon: MaterialSymbol;
  label: string;
}

const groups: ToolbarItem[][] = [
  [
    { id: "undo", run: undo, icon: "undo", label: "undo" },
    { id: "redo", run: redo, icon: "redo", label: "redo" },
  ],
  [
    { id: "bold", run: toggleStrong, icon: "format_bold", label: "bold" },
    { id: "italic", run: toggleEmph, icon: "format_italic", label: "italic" },
    { id: "underline", run: toggleUnderline, icon: "format_underlined", label: "underline" },
    { id: "strike", run: toggleStrike, icon: "strikethrough_s", label: "strike" },
    { id: "code", run: toggleCode, icon: "code", label: "code" },
    { id: "math", run: toggleMath, icon: "functions", label: "math" },
    { id: "link", run: insertLink, icon: "link", label: "link" },
  ],
  [{ id: "heading", run: cycleHeading, icon: "format_h1", label: "heading" }],
  [
    { id: "bulletList", run: toggleList, icon: "format_list_bulleted", label: "bulletList" },
    { id: "orderedList", run: toggleEnum, icon: "format_list_numbered", label: "orderedList" },
  ],
];

/** Link insertion gets the URL placeholder selected for immediate typing. */
function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  const url = "https://";
  const insert = `#link("${url}")[${text}]`;
  const urlFrom = from + '#link("'.length;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: urlFrom, head: urlFrom + url.length },
  });
}

function run(item: ToolbarItem) {
  const editor = props.view;
  if (!editor || props.disabled) return;

  item.run(editor);
  editor.focus();
}
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
        :key="item.id"
        type="button"
        class="edit-toolbar__button"
        :aria-label="$t(`formatting.${item.label}`)"
        :disabled="disabled || !view"
        @click="run(item)"
      >
        <MsIcon :name="item.icon" :size="18" />
      </ToolbarButton>
    </template>
  </ToolbarRoot>
</template>

<style scoped>
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
