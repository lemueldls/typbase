<script setup lang="ts">
import type { TypstRequest } from "@typbase/wasm";
import type { FileId, TypstState } from "@typbase/wasm";

import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { history } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { highlightSelectionMatches } from "@codemirror/search";
import { EditorState, type EditorStateConfig, type Extension } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  placeholder,
  rectangularSelection,
} from "@codemirror/view";
import {
  type TextRef,
  typstHoverTooltip,
  typstKeymap,
  typstLanguageData,
  typstPlugin,
  typstRecompileEffect,
  typstSyntaxHighlighting,
} from "@typbase/codemirror";

const props = defineProps<{
  fileId: FileId;
  spaceId: string;
  path: string;
  text: TextRef;
  prelude: TextRef;
  /** WYSIWYG (inline previews) vs plain source editing. */
  wysiwyg: boolean;
  typstState: TypstState;
  onRequests?: (requests: TypstRequest[], spaceId: string) => Promise<boolean> | boolean;
  revision?: () => string | number | undefined;
  /** Extra CodeMirror extensions (presence cursors, AI menus, search scroll). */
  extensions?: Extension[];
  /** Fired when the plugin's compile trapped; the parent rebuilds the wasm state. */
  onPanic?: () => void;
}>();

const container = useTemplateRef("container");
const view = shallowRef<EditorView>();

const createView = () => {
  const config = createStateConfig();
  config.doc = props.text.value;

  view.value = new EditorView({
    parent: container.value!,
    state: EditorState.create(config),
  });
};

onMounted(createView);

// Write vs source mode need different extension sets; rebuild on switch.
watch(
  () => props.wysiwyg,
  () => {
    view.value?.destroy();
    createView();
  },
);

onBeforeUnmount(() => {
  view.value?.destroy();
});

function createStateConfig(): EditorStateConfig {
  const extensions: Extension[] = [];

  if (props.wysiwyg) {
    extensions.push(
      typstPlugin(
        props.fileId,
        props.spaceId,
        props.path,
        props.text,
        props.prelude,
        false,
        props.typstState,
        { onRequests: props.onRequests, revision: props.revision, onPanic: props.onPanic },
      ),
    );
  } else {
    // Write mode syncs text through the typst plugin's update hook; the
    // split/source extension set has no plugin, so sync here or edits never
    // reach the store or the preview.
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) props.text.value = update.state.doc.toString();
      }),
      typstSyntaxHighlighting(props.fileId, props.typstState),
      typstHoverTooltip(props.fileId, props.typstState),
      typstKeymap,
      typstLanguageData,
      autocompletion(),
    );
  }

  extensions.push(
    EditorView.exceptionSink.of((error) => {
      console.error(error);
    }),
    EditorView.lineWrapping,
    EditorView.editable.of(true),
    EditorState.readOnly.of(false),
    highlightSpecialChars(),
    lintGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    placeholder("Start typing…"),
  );

  if (props.extensions) extensions.push(...props.extensions);

  return { extensions };
}

/** Forces a recompile even though the doc did not change (data/fonts did). */
function recompile() {
  view.value?.dispatch({ effects: typstRecompileEffect.of(null) });
}

/** Selects a source range (search hits, embedded references). */
function revealRange(from: number, to: number) {
  const editor = view.value;
  if (!editor) return;

  editor.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
  editor.focus();
}

/** Inserts generated Typst at the given position and returns the new cursor. */
function insertAt(position: number, text: string) {
  const editor = view.value;
  if (!editor) return -1;
  const doc = editor.state.doc;
  const pos = Math.max(0, Math.min(position, doc.length));
  const changes = { from: pos, insert: text };
  editor.dispatch({
    changes,
    selection: { anchor: pos + text.length },
    effects: EditorView.scrollIntoView(pos + text.length, { y: "center" }),
  });

  return pos + text.length;
}

defineExpose({ view, recompile, revealRange, insertAt });
</script>

<template>
  <section ref="container" class="editable-pane" />
</template>

<style scoped>
.editable-pane {
  height: 100%;
  min-height: 0;
}

.editable-pane :deep(.cm-editor) {
  height: 100%;
}
</style>
