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
    .filter((page) => !needle || page.title.toLowerCase().includes(needle))
    .slice(0, 50);
});

function openPicker(): void {
  pickerQuery.value = "";
  pickerOpen.value = true;
}

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

        <UiPopover v-if="item.id === 'link'" v-model:open="pickerOpen" class="edit-toolbar__picker">
          <template #trigger>
            <UiTooltip :text="$t('formatting.pageLink')">
              <ToolbarButton
                type="button"
                class="edit-toolbar__button"
                :aria-label="$t('formatting.pageLink')"
                :disabled="disabled || !view"
                @click="openPicker"
              >
                <MsIcon name="add_link" :size="18" />
              </ToolbarButton>
            </UiTooltip>
          </template>

          <UiTextField
            v-model="pickerQuery"
            size="small"
            :label="$t('links.searchPages')"
            :placeholder="$t('links.searchPages')"
            class="edit-toolbar__picker-search"
          />
          <ul class="edit-toolbar__picker-list">
            <li v-for="candidate in pages" :key="candidate.id">
              <button
                type="button"
                class="edit-toolbar__picker-row"
                @click="insertPageLink(candidate.id)"
              >
                <UiTruncatedText :text="candidate.title" />
              </button>
            </li>
          </ul>
          <p v-if="pages.length === 0" class="edit-toolbar__picker-empty">
            {{ $t("links.noPages") }}
          </p>
        </UiPopover>
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

/* Page-link picker. Portaled popover content, so the styles live here rather
   than next to the toolbar's own classes. */
.edit-toolbar__picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: min(280px, calc(100vw - var(--space-8)));
  max-height: calc(100dvh - 8rem);
  padding: var(--space-2);
}

.edit-toolbar__picker-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}

.edit-toolbar__picker-row {
  display: block;
  width: 100%;
  padding: var(--space-1) var(--space-2);
  text-align: left;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.edit-toolbar__picker-row:hover {
  background: var(--color-surface-2);
}

.edit-toolbar__picker-empty {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
