<script setup lang="ts">
import type { NotebookOptions } from "@typbase/codemirror";
import type { TypstRequest } from "@typbase/engine";
import type { FileId, TypstState } from "@typbase/engine";
import type { EditorSettings, IgnoredSpellcheckLint, SpellcheckMode } from "@typbase/typing";

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
  autocomplete,
  typstHoverTooltip,
  typstKeymap,
  typstLanguageData,
  typstLinter,
  typstPlugin,
  typstRecompileEffect,
  typstStaticHighlighting,
  typstSyntaxHighlighting,
} from "@typbase/codemirror";

import { typstEditorTheme } from "~/lib/cmTheme";
import { editorDisplayCompartment, editorDisplayExtension } from "~/lib/editorDisplay";
import { openExternal } from "~/lib/openExternal";
import {
  spellcheckCompartment,
  spellcheckExtension,
  type SpellcheckOptions,
} from "~/lib/spellcheck";
import { testApi } from "~/lib/testApi";

const props = defineProps<{
  fileId: FileId;
  spaceId: string;
  path: string;
  text: TextRef;
  prelude: TextRef;
  /** WYSIWYG (inline previews) vs plain source editing. */
  wysiwyg: boolean;
  /** Notebook cell rendering; undefined outside notebook mode. */
  notebook?: NotebookOptions;
  /**
   * Engine failed: install only engine-free extensions so the user keeps
   * editing (and saving) while previews, diagnostics, hover, and completions
   * are gone.
   */
  degraded?: boolean;
  /** Spellcheck provider; reconfigured in place when it changes. */
  spellcheck?: SpellcheckMode;
  /** Line numbers and scroll-past-end; reconfigured in place when they change. */
  editor?: EditorSettings;
  /** Harper's user dictionary; the native checker keeps its own. */
  spellcheckWords?: string[];
  /** Lints silenced with "Ignore". */
  spellcheckIgnoredLints?: IgnoredSpellcheckLint[];
  /** Adds a word to the workspace dictionary (the lint tooltip action). */
  onAddSpellcheckWord?: (word: string) => void;
  /** Silences one lint in the workspace (the lint tooltip action). */
  onIgnoreSpellcheckLint?: (lint: IgnoredSpellcheckLint) => void;
  typstState: TypstState;
  onRequests?: (requests: TypstRequest[], spaceId: string) => Promise<boolean> | boolean;
  revision?: () => string | number | undefined;
  /** Extra CodeMirror extensions (presence cursors, AI menus, search scroll). */
  extensions?: Extension[];
  /** Fired when the plugin's compile trapped; the parent rebuilds the wasm state. */
  onPanic?: () => void;
  /** Fired after a compile succeeds; the parent resets engine health. */
  onCompile?: () => void;
  /** Fired when a Typbase link inside a rendered widget is clicked. */
  onNavigate?: (pageId: string) => void;
  /** Fired when a plugin link inside a rendered widget is clicked. */
  onNavigatePlugin?: (instanceId: string) => void;
  /** Dropped media: an OS file to store, or a known blob from another pane. */
  onAssetDrop?: (
    payload: { file?: File; hash?: string; mime?: string },
    position: number,
  ) => void | Promise<void>;
}>();

const ASSET_MIME = "application/x-typbase-asset";

const container = useTemplateRef("container");
const view = shallowRef<EditorView>();
const dragActive = ref(false);
const dropTop = ref(0);

function isAssetDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;

  return types.includes("Files") || types.includes(ASSET_MIME);
}

// The indicator follows the line under the pointer; drops insert there.
function onDragOver(event: DragEvent) {
  if (!props.onAssetDrop || !isAssetDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";

  const editor = view.value;
  const element = container.value;
  if (!editor || !element) return;

  const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return;
  const rect = element.getBoundingClientRect();
  const coords = editor.coordsAtPos(pos);
  dropTop.value = (coords?.top ?? rect.top) - rect.top;
  dragActive.value = true;
}

function onDragLeave(event: DragEvent) {
  const rect = container.value?.getBoundingClientRect();
  if (!rect) return;
  if (
    event.clientX <= rect.left ||
    event.clientX >= rect.right ||
    event.clientY <= rect.top ||
    event.clientY >= rect.bottom
  ) {
    dragActive.value = false;
  }
}

function onDrop(event: DragEvent) {
  if (!props.onAssetDrop || !isAssetDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  dragActive.value = false;

  const editor = view.value;
  if (!editor) return;

  const position =
    editor.posAtCoords({ x: event.clientX, y: event.clientY }) ?? editor.state.selection.main.head;
  const asset = event.dataTransfer?.getData(ASSET_MIME);
  if (asset) {
    try {
      void props.onAssetDrop(JSON.parse(asset) as { hash: string; mime: string }, position);
    } catch {
      // Ignore foreign payloads under our MIME.
    }
    return;
  }

  const file = event.dataTransfer?.files?.[0];
  if (file) void props.onAssetDrop({ file }, position);
}

const createView = () => {
  const config = createStateConfig();
  config.doc = props.text.value;

  view.value = new EditorView({
    parent: container.value!,
    state: EditorState.create(config),
  });

  testApi.view = view.value;
  testApi.fileId = props.fileId;
};

// typbase.page-link and plugin embeds render as typbase:// anchors inside
// the widget SVG; the widget no longer claims anchor clicks, so route them.
function onWidgetClick(event: MouseEvent) {
  const target = event.target as Element | null;
  const anchor = target?.closest?.('a[href^="typbase://"]') as HTMLAnchorElement | null;
  if (!anchor) return;

  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("typbase://page/")) {
    event.preventDefault();
    const pageId = href.slice("typbase://page/".length);
    if (pageId) props.onNavigate?.(pageId);
    return;
  }
  if (href.startsWith("typbase://plugin/")) {
    event.preventDefault();
    const instanceId = href.slice("typbase://plugin/".length);
    if (instanceId) props.onNavigatePlugin?.(instanceId);
  }
}

onMounted(() => {
  createView();
  const element = container.value;
  element?.addEventListener("click", onWidgetClick);
  element?.addEventListener("dragover", onDragOver, true);
  element?.addEventListener("dragleave", onDragLeave, true);
  element?.addEventListener("drop", onDrop, true);
});

onBeforeUnmount(() => {
  const element = container.value;
  element?.removeEventListener("click", onWidgetClick);
  element?.removeEventListener("dragover", onDragOver, true);
  element?.removeEventListener("dragleave", onDragLeave, true);
  element?.removeEventListener("drop", onDrop, true);
  view.value?.destroy();
  testApi.view = null;
  testApi.fileId = null;
});

// Write, notebook, and source mode need different extension sets; rebuild on
// switch. The notebook prop's identity is stable per page, so only the mode
// flag matters. Degraded drops the engine-backed set entirely.
watch(
  () => `${props.wysiwyg}:${Boolean(props.notebook)}:${Boolean(props.degraded)}`,
  () => {
    view.value?.destroy();
    createView();
  },
);

// External writers replace the page text under an open editor: a plugin's
// `app.page-append`, a source-mirror import, an atproto pull. Adopt the new
// text when it differs from the doc; the editor's own edits echo back equal,
// so this never fires mid-typing. PageView only updates `text` when the
// editor is idle, so a pending keystroke cannot be clobbered here.
watch(
  () => props.text.value,
  (value) => {
    const editor = view.value;
    if (!editor || editor.state.doc.toString() === value) return;

    const anchor = Math.min(editor.state.selection.main.anchor, value.length);
    const head = Math.min(editor.state.selection.main.head, value.length);
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      selection: { anchor, head },
    });
  },
);

/** The options a reconfigure captures; props are read at call time. */
function spellcheckOptions(): SpellcheckOptions {
  return {
    words: props.spellcheckWords,
    ignoredLints: props.spellcheckIgnoredLints,
    onAddWord: props.onAddSpellcheckWord,
    onIgnoreLint: props.onIgnoreSpellcheckLint,
  };
}

// The spellcheck provider and its dictionary are swapped in place; the Harper
// source only loads its worker once something selects it. `getSettings()`
// hands out fresh arrays, so compare a signature instead of identities.
const spellcheckSignature = computed(() =>
  JSON.stringify([
    props.spellcheck ?? "off",
    props.spellcheckWords ?? [],
    (props.spellcheckIgnoredLints ?? []).map((entry) => entry.hash),
  ]),
);

watch(spellcheckSignature, () => {
  view.value?.dispatch({
    effects: spellcheckCompartment.reconfigure(
      spellcheckExtension(props.spellcheck, spellcheckOptions()),
    ),
  });
});

// Display flags are swapped in place too; the mode watcher above rebuilds the
// view and picks the current props up from `createStateConfig`.
const editorDisplaySignature = computed(() =>
  JSON.stringify([
    props.editor?.softWrap !== false,
    Boolean(props.editor?.lineNumbers),
    Boolean(props.editor?.scrollPastEnd),
  ]),
);

watch(editorDisplaySignature, () => {
  view.value?.dispatch({
    effects: editorDisplayCompartment.reconfigure(editorDisplayExtension(props.editor)),
  });
});

function createStateConfig(): EditorStateConfig {
  const extensions: Extension[] = [];

  // Injected after CM's runtime base theme, so token-based colors win over
  // the defaults (cursor, tooltip, selection, gutters).
  extensions.push(typstEditorTheme);

  if (props.degraded) {
    // Engine-free editing: keep text sync, keymap, language data, and
    // spellcheck; drop everything that calls into the wasm state. The static
    // highlighter keeps the source readable while previews are gone.
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) props.text.value = update.state.doc.toString();
      }),
      typstStaticHighlighting,
      typstKeymap,
      typstLanguageData,
      autocompletion(),
    );
  } else if (props.wysiwyg || props.notebook) {
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
          onCompile: props.onCompile,
          onExternalLink: openExternal,
          notebook: props.notebook,
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
      // The WYSIWYG plugin installs the same source; Split and Source mode
      // need it too or the editor has no completions at all.
      autocompletion({
        override: [(context) => autocomplete(context, props.fileId, props.typstState)],
      }),
    );
  }

  extensions.push(
    // Diagnostics in every engine-backed mode: the linter source combines with
    // the spellcheck source instead of replacing it, and split/source have no
    // WYSIWYG plugin to compile for them.
    ...(props.degraded
      ? []
      : [
          typstLinter(props.fileId, props.spaceId, props.path, props.prelude, props.typstState, {
            onRequests: props.onRequests,
            onPanic: props.onPanic,
            onCompile: props.onCompile,
          }),
        ]),
    spellcheckCompartment.of(spellcheckExtension(props.spellcheck, spellcheckOptions())),
    editorDisplayCompartment.of(editorDisplayExtension(props.editor)),
    EditorView.exceptionSink.of((error) => {
      console.error(error);
    }),
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
  // The document text size can have changed with the same doc text; measure
  // before recompiling so widget heights and line boxes match the new font.
  view.value?.requestMeasure();
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
  <section ref="container" class="editable-pane" :class="{ 'editable-pane--dragging': dragActive }">
    <div v-if="dragActive" class="editable-pane__drop" aria-hidden="true">
      <span class="editable-pane__drop-line" :style="{ top: `${dropTop}px` }">
        <span class="editable-pane__drop-label">
          <MsIcon name="add_photo_alternate" :size="15" />
          {{ $t("pageView.dropMedia") }}
        </span>
      </span>
    </div>
  </section>
</template>

<style>
.editable-pane {
  position: relative;
  height: 100%;
  min-height: 0;
}

.editable-pane .cm-editor {
  height: 100%;
}

.editable-pane--dragging .cm-editor {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-accent) 50%, transparent);
}

.editable-pane__drop {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  background: color-mix(in srgb, var(--color-accent) 4%, transparent);
  animation: editable-pane-drop-in 0.12s ease-out;
}

/* Insertion line: rides the pointer's line and carries the hint chip, so the
   text marks where the media lands instead of floating at the pane top. */
.editable-pane__drop-line {
  position: absolute;
  left: var(--space-2-5);
  right: var(--space-2-5);
  height: 2px;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.editable-pane__drop-line::before,
.editable-pane__drop-line::after {
  content: "";
  position: absolute;
  top: 50%;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  transform: translateY(-50%);
}

.editable-pane__drop-line::before {
  left: calc(var(--space-1) * -1);
}

.editable-pane__drop-line::after {
  right: calc(var(--space-1) * -1);
}

.editable-pane__drop-label {
  position: absolute;
  bottom: var(--space-2);
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-1) var(--space-2-5);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--color-accent);
  background: var(--color-surface);
  border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
  border-radius: var(--radius-full);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.15);
  white-space: nowrap;
}

@keyframes editable-pane-drop-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

/* CodeMirror internals: scrollbar, syntax tags, rendered frames, remote
   cursors, and notebook cell widgets. The classes come from
   @typbase/codemirror and the wasm highlighter; this editor is the only place
   they render. */

.cm-scroller {
  scrollbar-color: auto;
}

.cm-scroller::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.cm-scroller::-webkit-scrollbar-track {
  background: transparent;
}

.cm-scroller::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  background-clip: content-box;
}

.cm-scroller::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-text-secondary);
  background-clip: content-box;
}

/* Keep the drawn selection over active-line and search backgrounds. */
.cm-selectionLayer {
  z-index: 0;
}

/* Typst syntax tags from the wasm highlighter, mapped to theme tokens. */
.typ-comment {
  color: var(--color-text-secondary);
}

.typ-punct,
.typ-escape {
  color: var(--color-text-secondary);
}

.typ-strong {
  font-weight: bold;
}

.typ-emph {
  font-style: italic;
}

.typ-link {
  color: var(--color-accent);
  text-decoration: underline;
}

.typ-raw {
  color: var(--color-warning);
}

.typ-label,
.typ-ref {
  color: color-mix(in srgb, var(--color-accent) 70%, var(--color-text));
}

.typ-heading {
  color: var(--color-text);
}

.typ-heading-level-1 {
  color: var(--color-accent);
  font-size: 2em;
  font-weight: 400;
}

.typ-heading-level-2 {
  color: var(--color-text);
  font-size: 1.75em;
  font-weight: 400;
}

.typ-heading-level-3 {
  color: var(--color-text-secondary);
  font-size: 1.5em;
  font-weight: 400;
}

.typ-heading-level-4 {
  color: var(--color-accent);
  font-size: 1.375em;
  font-weight: 400;
}

.typ-heading-level-5 {
  color: var(--color-text);
  font-size: 1em;
  font-weight: 500;
}

.typ-heading-level-6 {
  color: var(--color-text-secondary);
  font-size: 0.875em;
  font-weight: 500;
}

.typ-marker {
  color: var(--color-text-secondary);
  font-weight: bold;
}

.typ-term {
  font-weight: bold;
}

.typ-math-delim {
  color: var(--color-text-secondary);
}

.typ-math-op,
.typ-op {
  color: var(--color-danger);
}

.typ-key {
  color: var(--color-accent);
}

.typ-num,
.typ-str {
  color: var(--color-warning);
}

.typ-func {
  color: color-mix(in srgb, var(--color-accent) 70%, var(--color-text));
}

.typ-pol {
  color: var(--color-text);
}

.typ-error {
  color: var(--color-danger);
}

.typst-render {
  display: inline-block;
  max-width: 100%;
  overflow: visible;
  vertical-align: top;
  user-select: none;
  -webkit-user-drag: none;
}

/* A block-level SVG anchors at the container's top. Inline, it sits on the
   container's text baseline, so a frame shorter than the editor's 22.4px line
   box is pushed down and overflows the bottom. */
.typst-render svg {
  display: block;
  width: var(--render-w) !important;
  height: var(--render-h) !important;
}

.cm-content[contenteditable="true"] .typst-render {
  border-radius: var(--radius-xs);
  transition: background-color 0.15s;
}

.cm-content[contenteditable="true"] .typst-render:hover {
  background-color: color-mix(in srgb, var(--color-accent) 8%, transparent);
}

.cm-content[contenteditable="true"] .typst-render svg {
  cursor: text;
}

.typst-popup-render {
  padding: var(--space-4);
  max-height: min(70vh, 32rem);
  overflow: auto;
  overscroll-behavior: contain;
}

.typst-popup-render div {
  position: relative;
}

.typst-popup-render svg {
  width: 100% !important;
  height: 100% !important;
}

.typst-hints {
  color: var(--color-text-secondary);
  font-size: var(--text-md);
}

.typbase-remote-cursor {
  background-color: color-mix(in srgb, var(--cursor-color) 25%, transparent);
  border-bottom: 2px solid var(--cursor-color);
}

.typbase-remote-cursor-flag {
  position: absolute;
  transform: translate(-2px, -100%);
  padding: 0 var(--space-1);
  font-size: var(--text-2xs);
  font-family: var(--font-mono);
  line-height: var(--leading-tight);
  color: #fff;
  background: var(--cursor-color);
  border-radius: var(--radius-xs) var(--radius-xs) var(--radius-xs) 0;
  pointer-events: none;
  white-space: nowrap;
}

.tb-cell-header {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-right: var(--space-2);
  vertical-align: middle;
  font-size: var(--text-xs);
  line-height: 1;
  user-select: none;
}

.tb-cell-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  font-family: inherit;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.tb-cell-btn:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.tb-cell-btn--run {
  color: var(--color-accent);
}

.tb-cell-btn--type {
  width: auto;
  gap: var(--space-1);
  height: 1.4rem;
  padding: 0 var(--space-1-5);
  border: 1px solid var(--color-border);
}

.tb-cell-counter {
  display: inline-flex;
  align-items: center;
  flex: none;
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
}

.tb-cell-spacer {
  flex: 1;
}

.tb-cell-actions {
  display: inline-flex;
  align-items: center;
  gap: 0;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.tb-cell-header:hover .tb-cell-actions,
.tb-cell-header:focus-within .tb-cell-actions {
  opacity: 1;
}

@media (hover: none) {
  .tb-cell-actions {
    opacity: 1;
  }
}

/* Marker lines read as cell separators, not source. */
.tb-cell-marker {
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  font-size: var(--text-xs);
}

.tb-cell-marker.cm-line {
  padding-left: var(--space-1);
}

.tb-cell-output {
  margin: var(--space-1) 0 var(--space-3);
  padding-left: var(--space-3);
  border-left: 2px solid var(--color-border);
}

.tb-cell-output--cleared,
.tb-cell-output--empty {
  display: none;
}

.tb-cell-output-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.tb-cell-frame {
  overflow: hidden;
}

.tb-cell-frame .typst-render {
  cursor: text;
}

.tb-cell-empty {
  font-size: var(--text-xs);
  font-style: italic;
  color: var(--color-text-secondary);
}

.tb-cell-diagnostic {
  padding: var(--space-1-5) var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
}

.tb-cell-diagnostic ul {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-4);
  color: var(--color-text-secondary);
}
</style>
