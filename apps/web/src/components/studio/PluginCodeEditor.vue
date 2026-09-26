<script setup lang="ts">
/**
 * Standalone CodeMirror editor for the plugin studio. Typst files get the
 * engine-free scanner from @typbase/codemirror, so editing works even when
 * the wasm engine is down. Cmd/Ctrl+S emits `save`; the page owns writes.
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { typstStaticHighlighting } from "@typbase/codemirror";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** `typst` highlights as Typst; anything else is plain text. */
    language?: "typst" | "text";
    readonly?: boolean;
  }>(),
  { language: "typst", readonly: false },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "save"): void;
}>();

const host = useTemplateRef<HTMLDivElement>("host");
let view: EditorView | undefined;
let applying = false;

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--text-sm)",
    color: "var(--color-text)",
    backgroundColor: "var(--color-surface)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "var(--leading-normal)",
  },
  ".cm-content": {
    padding: "var(--space-2) 0",
    caretColor: "var(--color-accent)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-accent)",
  },
  ".cm-gutters": {
    color: "var(--color-text-secondary)",
    backgroundColor: "var(--color-surface-2)",
    border: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, transparent)",
  },
});

onMounted(() => {
  if (!host.value) return;

  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              emit("save");
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...(props.language === "typst" ? [typstStaticHighlighting] : []),
        EditorView.editable.of(!props.readonly),
        EditorState.readOnly.of(props.readonly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applying) {
            emit("update:modelValue", update.state.doc.toString());
          }
        }),
        editorTheme,
      ],
    }),
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!view || view.state.doc.toString() === value) return;

    applying = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    applying = false;
  },
);

/** Scrolls a 1-based line into view and puts the cursor there. */
function revealLine(line: number): void {
  if (!view) return;

  const clamped = Math.max(1, Math.min(line, view.state.doc.lines));
  const info = view.state.doc.line(clamped);
  view.dispatch({
    selection: { anchor: info.from },
    effects: EditorView.scrollIntoView(info.from, { y: "center" }),
  });
  view.focus();
}

defineExpose({ revealLine });

onBeforeUnmount(() => {
  view?.destroy();
  view = undefined;
});
</script>

<template>
  <div ref="host" class="studio-editor" />
</template>

<style>
.studio-editor {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.studio-editor .cm-editor {
  height: 100%;
}

.studio-editor .cm-scroller {
  overflow: auto;
}
</style>
