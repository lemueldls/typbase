<script setup lang="ts">
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { insertTabLike, typstLanguageData, typstStaticHighlighting } from "@typbase/codemirror";

const props = defineProps<{
  value: string;
  placeholder?: string;
  /** Accessible name, since the settings row's text is not tied to the editor. */
  ariaLabel?: string;
}>();

const emit = defineEmits<{ (e: "change", value: string): void }>();

const host = useTemplateRef<HTMLDivElement>("host");
let view: EditorView | undefined;
let dirty = false;

const fieldTheme = EditorView.theme({
  "&": {
    minHeight: "8rem",
    maxHeight: "20rem",
    fontSize: "var(--text-sm)",
    color: "var(--color-text)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "var(--leading-normal)",
    overflowY: "auto",
    flex: "1 1 0",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    padding: "var(--space-2) 0",
    caretColor: "var(--color-accent)",
  },
  ".cm-line": {
    padding: "0 var(--space-2)",
  },
  ".cm-placeholder": {
    color: "var(--color-text-secondary)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-accent)",
  },
  // The base theme's focused-selection rule is as specific as the editor
  // theme's, so the same selector shape is needed to win on order.
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 26%, transparent)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 30%, transparent)",
  },
  // The editor scales headings up. A settings field keeps its line height, so
  // only the colors carry over.
  ".typ-heading, .typ-heading-level-1, .typ-heading-level-2, .typ-heading-level-3, .typ-heading-level-4, .typ-heading-level-5, .typ-heading-level-6":
    {
      fontSize: "inherit",
    },
});

function commit(): void {
  if (!view || !dirty) return;

  dirty = false;
  emit("change", view.state.doc.toString());
}

onMounted(() => {
  if (!host.value) return;

  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.value,
      extensions: [
        typstStaticHighlighting,
        // Bracket pairs, comment tokens, and word characters without a
        // language: `closeBrackets` reads the pairs from here.
        typstLanguageData,
        closeBrackets(),
        drawSelection(),
        history(),
        EditorView.lineWrapping,
        keymap.of([
          { key: "Tab", run: insertTabLike },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.contentAttributes.of({
          spellcheck: "false",
          ...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {}),
        }),
        ...(props.placeholder ? [placeholder(props.placeholder)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) dirty = true;
          if (update.focusChanged && !update.view.hasFocus) commit();
        }),
        fieldTheme,
      ],
    }),
  });
});

watch(
  () => props.value,
  (value) => {
    if (!view || view.state.doc.toString() === value) return;

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    dirty = false;
  },
);

onBeforeUnmount(() => {
  commit();
  view?.destroy();
  view = undefined;
});
</script>

<template>
  <div ref="host" class="source-field" />
</template>

<style>
.source-field {
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.source-field:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}
</style>
