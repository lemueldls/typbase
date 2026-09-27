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
    {
      id: "underline",
      run: toggleUnderline,
      icon: "format_underlined",
      label: "underline",
    },
    {
      id: "strike",
      run: toggleStrike,
      icon: "strikethrough_s",
      label: "strike",
    },
    { id: "code", run: toggleCode, icon: "code", label: "code" },
    { id: "math", run: toggleMath, icon: "functions", label: "math" },
    { id: "link", run: insertLink, icon: "link", label: "link" },
  ],
  [{ id: "heading", run: cycleHeading, icon: "format_h1", label: "heading" }],
  [
    {
      id: "bulletList",
      run: toggleList,
      icon: "format_list_bulleted",
      label: "bulletList",
    },
    {
      id: "orderedList",
      run: toggleEnum,
      icon: "format_list_numbered",
      label: "orderedList",
    },
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

const { workspace } = useWorkspace();
const { t } = useI18n();
const pickerOpen = ref(false);
const pickerQuery = ref("");

const pages = computed(() => {
  const store = workspace.value;
  if (!store) return [];

  const needle = pickerQuery.value.trim().toLowerCase();

  return store
    .listPages()
    .filter(
      (page) =>
        !needle ||
        page.title.toLowerCase().includes(needle) ||
        page.path.toLowerCase().includes(needle),
    )
    .slice(0, 50);
});

/** Options for the page-link autocomplete; UiCombobox takes them filtered. */
const pageOptions = computed(() =>
  pages.value.map((page) => ({
    value: page.id,
    label: page.title,
    description: page.path,
  })),
);

// Every open starts from a full list; reka's trigger toggles `open`.
watch(pickerOpen, (open) => {
  if (open) pickerQuery.value = "";
});

/** A picked page becomes `#typbase.page-link("<id>")`; a selection wraps. */
function insertPageLink(pageId: string): void {
  const view = props.view;
  if (!view) return;

  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  const insert = text
    ? `#typbase.page-link("${pageId}", body: [${text}])`
    : `#typbase.page-link("${pageId}")`;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
  pickerOpen.value = false;
  view.focus();
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
      <template v-for="item in group" :key="item.id">
        <UiTooltip :text="$t(`formatting.${item.label}`)">
          <ToolbarButton
            type="button"
            class="edit-toolbar__button"
            :aria-label="$t(`formatting.${item.label}`)"
            :disabled="disabled || !view"
            @click="run(item)"
          >
            <MsIcon :name="item.icon" :size="18" />
          </ToolbarButton>
        </UiTooltip>

        <UiCombobox
          v-if="item.id === 'link'"
          v-model:open="pickerOpen"
          v-model="pickerQuery"
          :options="pageOptions"
          :label="$t('formatting.pageLink')"
          :placeholder="$t('links.searchPages')"
          :empty="$t('links.noPages')"
          :disabled="disabled || !view"
          class="edit-toolbar__picker"
          @select="insertPageLink"
        >
          <template #trigger>
            <ToolbarButton
              type="button"
              class="edit-toolbar__button"
              :aria-label="$t('formatting.pageLink')"
              :disabled="disabled || !view"
            >
              <MsIcon name="add_link" :size="18" />
            </ToolbarButton>
          </template>
        </UiCombobox>
      </template>
    </template>
  </ToolbarRoot>
</template>

<style>
.edit-toolbar {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
}

.edit-toolbar__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-sm);
  height: var(--control-sm);
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
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
  height: calc(1.2rem * var(--ui-size));
  margin: 0 var(--space-1);
  background: var(--color-border);
}

/* Page-link autocomplete: width only. UiCombobox owns the surface, input,
   list, and empty state, so only the picker's width differs from the base. */
.combobox.edit-toolbar__picker {
  width: min(280px, calc(100vw - var(--space-8)));
}
</style>
