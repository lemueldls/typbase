<script setup lang="ts">
import type { TypstRequest } from "@typbase/wasm";
import type { FileId, TypstState } from "@typbase/wasm";

import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { history, redo as cmRedo, undo as cmUndo } from "@codemirror/commands";
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

import type { EditCommand } from "~/lib/editorCommands";

import { typstEditorTheme } from "~/lib/cmTheme";

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
  /** Fired when a Typbase link inside a rendered widget is clicked. */
  onNavigate?: (pageId: string) => void;
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

// typbase.page-link renders as <a href="typbase://page/<id>"> inside the
// widget SVG; the widget no longer claims anchor clicks, so route them here.
function onWidgetClick(event: MouseEvent) {
  const anchor = (event.target as Element | null)?.closest?.(
    'a[href^="typbase://page/"]',
  ) as HTMLAnchorElement | null;
  if (!anchor) return;
  event.preventDefault();
  const pageId = anchor.getAttribute("href")?.slice("typbase://page/".length);
  if (pageId) props.onNavigate?.(pageId);
}

onMounted(() => {
  createView();
  container.value?.addEventListener("click", onWidgetClick);
});

onBeforeUnmount(() => {
  container.value?.removeEventListener("click", onWidgetClick);
  view.value?.destroy();
});

// Write vs source mode need different extension sets; rebuild on switch.
watch(
  () => props.wysiwyg,
  () => {
    view.value?.destroy();
    createView();
  },
);

function createStateConfig(): EditorStateConfig {
  const extensions: Extension[] = [];

  // Injected after CM's runtime base theme, so token-based colors win over
  // the defaults (cursor, tooltip, selection, gutters).
  extensions.push(typstEditorTheme());

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
        {
          onRequests: props.onRequests,
          revision: props.revision,
          onPanic: props.onPanic,
        },
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
    placeholder("Start typing..."),
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

/** Inline wrappers map to one change: `*sel*`, `#strike[sel]`, `` `sel` ``. */
function wrapSelection(before: string, after: string) {
  const editor = view.value;
  if (!editor) return;

  const { state } = editor;
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);

  const editorChange = { from, to, insert: `${before}${text}${after}` };
  const fromAfter = from + before.length;
  const selection = { anchor: fromAfter, head: fromAfter + text.length };

  editor.dispatch({ changes: [editorChange], selection });
}

/** Tag-based wrappers take the content inside a function call. */
function wrapFunction(name: string, after = "") {
  wrapSelection(`#${name}[`, `]${after}`);
}

/** Prefixes every selected line (headings, list items). */
function prefixLines(prefix: string) {
  const editor = view.value;
  if (!editor) return;

  const { state } = editor;
  const { from, to } = state.selection.main;
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);

  const changes: { from: number; to: number; insert: string }[] = [];
  let total = 0;
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
    const line = state.doc.line(lineNumber);
    changes.push({ from: line.from, to: line.from, insert: prefix });
    total += prefix.length;
  }

  editor.dispatch({
    changes,
    // The first line's shift applies to the anchor when it sits past the
    // prefix; the last line's shift applies to the head.
    selection: { anchor: from + prefix.length, head: to + total },
  });
}

/** Link insertion gets the URL placeholder selected for immediate typing. */
function insertLink() {
  const editor = view.value;
  if (!editor) return;

  const { state } = editor;
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);
  const url = "https://";
  const insert = `#link("${url}")[${text}]`;
  const urlFrom = from + '#link("'.length;
  const urlTo = urlFrom + url.length;

  editor.dispatch({
    changes: { from, to, insert },
    selection: { anchor: urlFrom, head: urlTo },
  });
}

function applyCommand(command: EditCommand) {
  const editor = view.value;
  if (!editor) return;

  switch (command) {
    case "undo":
      cmUndo({ state: editor.state, dispatch: (tr) => editor.dispatch(tr) });
      break;
    case "redo":
      cmRedo({ state: editor.state, dispatch: (tr) => editor.dispatch(tr) });
      break;
    case "bold":
      wrapSelection("*", "*");
      break;
    case "italic":
      wrapSelection("_", "_");
      break;
    case "underline":
      wrapFunction("underline");
      break;
    case "strike":
      wrapFunction("strike");
      break;
    case "code":
      wrapSelection("`", "`");
      break;
    case "math":
      wrapSelection("$", "$");
      break;
    case "link":
      insertLink();
      break;
    case "heading1":
      prefixLines("= ");
      break;
    case "heading2":
      prefixLines("== ");
      break;
    case "heading3":
      prefixLines("=== ");
      break;
    case "bulletList":
      prefixLines("- ");
      break;
    case "orderedList":
      prefixLines("+ ");
      break;
  }
  editor.focus();
}

defineExpose({ view, recompile, revealRange, insertAt, applyCommand });
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
