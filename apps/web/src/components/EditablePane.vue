<script setup lang="ts">
import type { NotebookOptions } from "@typbase/codemirror";
import type { TypstRequest } from "@typbase/engine";
import type { FileId, TypstState } from "@typbase/engine";
import type { PageTextChange, PageTextDelta } from "@typbase/storage";
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
import {
  Annotation,
  Compartment,
  EditorState,
  type EditorStateConfig,
  type Extension,
  Transaction,
} from "@codemirror/state";
import {
  EditorView,
  Decoration,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  placeholder,
  rectangularSelection,
  tooltips,
  type DecorationSet,
} from "@codemirror/view";
import { Vim, getCM, vim } from "@replit/codemirror-vim";
import {
  type TextRef,
  autocomplete,
  typstEditingExtensions,
  typstHoverTooltip,
  typstKeymap,
  typstLanguageData,
  typstLinter,
  typstPlugin,
  typstRecompileEffect,
  typstStaticHighlighting,
  typstSyntaxHighlighting,
  typstSourceSync,
  typstTheme,
  vimKeymapFacet,
} from "@typbase/codemirror";

import type { FindRect } from "~/lib/pageFind";

import { typstEditorTheme } from "~/lib/cmTheme";
import { editorDisplayCompartment, editorDisplayExtension } from "~/lib/editorDisplay";
import { requestSave } from "~/lib/saveRequest";
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
  /**
   * Render the frames, or show plain source. Write mode renders inline previews
   * and source mode does not, for a document and for a notebook alike.
   */
  wysiwyg: boolean;
  /**
   * Notebook cell rendering. Set for a notebook page in every editable mode, so
   * it is not a mode switch on its own: `wysiwyg` still decides whether the
   * frames are drawn.
   */
  notebook?: NotebookOptions;
  /**
   * Engine failed: install only engine-free extensions so the user keeps
   * editing (and saving) while previews, diagnostics, hover, and completions
   * are gone.
   */
  degraded?: boolean;
  /** Spellcheck provider, reconfigured in place when it changes. */
  spellcheck?: SpellcheckMode;
  /** Line numbers and scroll-past-end, reconfigured in place when they change. */
  editor?: EditorSettings;
  /** Read-only for a workspace shared without write access. */
  readOnly?: boolean;
  /** Harper's user dictionary. The native checker keeps its own. */
  spellcheckWords?: string[];
  /**
   * Opaque workspace ids that appear inside `typbase` calls. Harper treats
   * them as spelling mistakes unless its lints on these exact spans are
   * dropped.
   */
  spellcheckIgnoreIds?: string[];
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
  /** Fired when the plugin's compile trapped. The parent rebuilds the wasm state. */
  onPanic?: () => void;
  /** Fired after a compile succeeds, so the parent resets engine health. */
  onCompile?: () => void;
  /** Fired after a paged compile, so page search can refresh its text index. */
  onPagedCompile?: () => void;
  /** Raw source ranges for the current page-find results. */
  findSourceRanges?: Array<{ from: number; to: number; active: boolean }>;
  /** Exact page-find rectangles for rendered frames, in frame points. */
  findFrameMarks?: Array<{
    frameIndex: number;
    range: { from: number; to: number };
    rects: FindRect[];
    active: boolean;
  }>;
  /** Fired when a Typbase link inside a rendered widget is clicked. */
  onNavigate?: (pageId: string) => void;
  /** Fired when a plugin link inside a rendered widget is clicked. */
  onNavigatePlugin?: (instanceId: string) => void;
  /** Dropped media: an OS file to store, or a known blob from another pane. */
  onAssetDrop?: (
    payload: { file?: File; hash?: string; mime?: string },
    position: number,
  ) => void | Promise<void>;
  /**
   * Local document changes, in the coordinates of the document before the
   * transaction. The parent writes them to the page doc as text splices.
   */
  onTextChange?: (changes: PageTextChange[]) => void;
}>();

/** Marks a transaction that mirrors a peer's edit, not a local one. */
const remoteTextChange = Annotation.define<boolean>();
const remoteTextAnnotations = [remoteTextChange.of(true), Transaction.addToHistory.of(false)];

const ASSET_MIME = "application/x-typbase-asset";

// Vim's `:w` uses the app-level save handler, the same one Mod-S dispatches, so
// it flushes the page and the snapshot. Defined once for every editor instance.
Vim.defineEx("write", "w", () => void requestSave());

const container = useTemplateRef("container");
const view = shallowRef<EditorView>();
const openExternalLink = useExternalLink();
const dragActive = ref(false);
const dropTop = ref(0);

/** Vim's mode line, mirrored from the plugin's facade. `null` when vim is off. */
const vimMode = ref<string | null>(null);
const vimKeys = ref("");
const cursorLine = ref(1);
const cursorColumn = ref(1);

interface VimFacade {
  state: { vim?: { mode?: string; status?: string } };
  on(type: string, handler: () => void): void;
  off(type: string, handler: () => void): void;
}

let vimFacade: VimFacade | undefined;
let vimEvents: { mode: () => void; command: () => void; key: () => void } | undefined;

function detachVim(): void {
  if (vimFacade && vimEvents) {
    vimFacade.off("vim-mode-change", vimEvents.mode);
    vimFacade.off("vim-command-done", vimEvents.command);
    vimFacade.off("vim-keypress", vimEvents.key);
  }

  vimFacade = undefined;
  vimEvents = undefined;
}

/**
 * Mirrors the vim mode and pending keys into the status bar. Reattached after
 * a reconfigure or a view rebuild because the facade belongs to one view.
 */
function attachVim(): void {
  detachVim();
  vimKeys.value = "";

  if (!props.editor?.vim) {
    vimMode.value = null;

    return;
  }

  const editor = view.value;
  const cm = editor ? (getCM(editor) as VimFacade | null) : null;
  if (!cm) {
    vimMode.value = null;

    return;
  }

  vimFacade = cm;
  const mode = () => {
    vimMode.value = cm.state.vim?.mode ?? "normal";
    vimKeys.value = "";
  };
  const command = () => {
    vimKeys.value = "";
  };
  const key = () => {
    vimKeys.value = cm.state.vim?.status ?? "";
  };
  vimEvents = { mode, command, key };
  cm.on("vim-mode-change", mode);
  cm.on("vim-command-done", command);
  cm.on("vim-keypress", key);

  vimMode.value = cm.state.vim?.mode ?? "normal";
}

function updateCursorPosition(state: EditorState): void {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  cursorLine.value = line.number;
  cursorColumn.value = head - line.from + 1;
}

function isAssetDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;

  return types.includes("Files") || types.includes(ASSET_MIME);
}

// The indicator follows the line under the pointer, and drops insert there.
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
  const previous = view.value;
  const config = createStateConfig();
  config.doc = props.text.value;

  if (previous) {
    // A mode or engine-health rebuild keeps the text. Keep the cursor with it
    // instead of dropping to the start of the note.
    const length = props.text.value.length;
    config.selection = {
      anchor: Math.min(previous.state.selection.main.anchor, length),
      head: Math.min(previous.state.selection.main.head, length),
    };
  }

  view.value = new EditorView({
    parent: container.value!,
    state: EditorState.create(config),
  });

  testApi.view = view.value;
  testApi.fileId = props.fileId;
  updateCursorPosition(view.value.state);
  attachVim();
};

// typbase.page-link and plugin embeds render as typbase:// anchors inside
// the widget SVG. The widget does not claim anchor clicks, so route them.
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
  scheduleFrameMarks();
  const element = container.value;
  element?.addEventListener("click", onWidgetClick);
  element?.addEventListener("dragover", onDragOver, true);
  element?.addEventListener("dragleave", onDragLeave, true);
  element?.addEventListener("drop", onDrop, true);
});

onBeforeUnmount(() => {
  if (frameMarkHandle !== undefined) cancelAnimationFrame(frameMarkHandle);
  const element = container.value;
  element?.removeEventListener("click", onWidgetClick);
  element?.removeEventListener("dragover", onDragOver, true);
  element?.removeEventListener("dragleave", onDragLeave, true);
  element?.removeEventListener("drop", onDrop, true);
  detachVim();
  view.value?.destroy();
  testApi.view = null;
  testApi.fileId = null;
});

// Write, notebook, and source mode need different extension sets. Rebuild on
// switch. The notebook prop's identity is stable per page, so only the mode
// flag matters. Degraded drops the engine-backed set entirely.
watch(
  () => `${props.wysiwyg}:${Boolean(props.notebook)}:${Boolean(props.degraded)}`,
  () => {
    view.value?.destroy();
    createView();
  },
);

// Full-text catch-up for a writer that replaces the whole document, or for a
// delta that could not be applied. Remote edits arrive as deltas and are
// applied by `applyTextDelta`; this only runs when the buffer still differs.
// The replacement stays out of the undo history so local undo never reverts a
// peer's edit.
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
      annotations: remoteTextAnnotations,
    });
  },
);

/** The options a reconfigure captures. Props are read at call time. */
function spellcheckOptions(): SpellcheckOptions {
  return {
    words: props.spellcheckWords,
    ignoredLints: props.spellcheckIgnoredLints,
    ignoreIds: props.spellcheckIgnoreIds,
    onAddWord: props.onAddSpellcheckWord,
    onIgnoreLint: props.onIgnoreSpellcheckLint,
  };
}

// The spellcheck provider and its dictionary are swapped in place. The Harper
// source only loads its worker once something selects it. `getSettings()`
// hands out fresh arrays, so compare a signature instead of identities.
const spellcheckSignature = computed(() =>
  JSON.stringify([
    props.spellcheck ?? "off",
    props.spellcheckWords ?? [],
    props.spellcheckIgnoreIds ?? [],
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

// Display flags are swapped in place too. The mode watcher above rebuilds the
// view and picks the current props up from `createStateConfig`.
/** Vim is a preference, so it swaps in place without dropping the doc. */
function vimExtension(): Extension {
  return props.editor?.vim ? [vim(), vimKeymapFacet.of(true)] : [];
}

const vimCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

const readOnlyExtensions = (readOnly: boolean | undefined) => [
  EditorView.editable.of(!readOnly),
  EditorState.readOnly.of(!!readOnly),
];
/**
 * Last vim setting applied, so a display-only change does not recreate the
 * vim plugin and reset its mode.
 */
let vimEnabled = Boolean(props.editor?.vim);

/**
 * A capped, centered writing column instead of the full pane. The class
 * sets the CSS. The engine reads the resulting width from the scroller.
 */
const measureColumn = computed(() => props.editor?.contentWidth !== "full");

const editorDisplaySignature = computed(() =>
  JSON.stringify([
    props.editor?.softWrap !== false,
    Boolean(props.editor?.lineNumbers),
    Boolean(props.editor?.scrollPastEnd),
    Boolean(props.editor?.vim),
  ]),
);

watch(editorDisplaySignature, () => {
  const effects = [editorDisplayCompartment.reconfigure(editorDisplayExtension(props.editor))];
  const enabled = Boolean(props.editor?.vim);
  if (enabled !== vimEnabled) {
    vimEnabled = enabled;
    effects.push(vimCompartment.reconfigure(vimExtension()));
  }

  view.value?.dispatch({ effects });
  attachVim();
});

/** Page-find marks in the source. Reconfigured without touching the document. */
const findCompartment = new Compartment();

function findDecorations(): DecorationSet {
  const ranges = (props.findSourceRanges ?? [])
    .filter((range) => range.to > range.from)
    .map((range) =>
      Decoration.mark({
        class: range.active ? "cm-searchMatch cm-searchMatch-selected" : "cm-searchMatch",
      }).range(range.from, range.to),
    );

  return Decoration.set(ranges, true);
}

watch(
  () => props.findSourceRanges,
  () => {
    view.value?.dispatch({
      effects: findCompartment.reconfigure(EditorView.decorations.of(findDecorations())),
    });
  },
  { deep: true },
);

const FIND_MARKS_CLASS = "typst-find-marks";
let frameMarkHandle: number | undefined;
let frameMarksAttached = false;

/**
 * Draws exact page-find rectangles over mounted rendered frames. Frame widgets
 * are recreated on compile, so the layers are reconciled from the props again
 * after every relevant update.
 */
function applyFrameMarks(): void {
  const editor = view.value;
  if (!editor) return;

  const marks = props.findFrameMarks ?? [];
  if (marks.length === 0 && !frameMarksAttached) return;

  frameMarksAttached = marks.length > 0;

  const byRange = new Map<string, Array<{ rects: FindRect[]; active: boolean }>>();

  for (const mark of marks) {
    const key = `${mark.range.from}:${mark.range.to}`;
    const list = byRange.get(key) ?? [];
    list.push({ rects: mark.rects, active: mark.active });
    byRange.set(key, list);
  }

  for (const frameEl of editor.dom.querySelectorAll<HTMLElement>(".typst-render")) {
    const from = Number(frameEl.dataset.frameFrom);
    const to = Number(frameEl.dataset.frameTo);
    const frameMarks =
      Number.isFinite(from) && Number.isFinite(to) ? byRange.get(`${from}:${to}`) : undefined;

    const existing = Array.from(frameEl.children).find((child) =>
      child.classList.contains(FIND_MARKS_CLASS),
    );
    existing?.remove();

    if (!frameMarks?.length) continue;

    const layer = document.createElement("div");
    layer.className = FIND_MARKS_CLASS;

    for (const mark of frameMarks) {
      for (const rect of mark.rects) {
        const element = document.createElement("span");
        element.className = mark.active
          ? "typst-find-mark typst-find-mark--active"
          : "typst-find-mark";
        element.style.left = `${rect.x}px`;
        element.style.top = `${rect.y}px`;
        element.style.width = `${Math.max(0, rect.width)}px`;
        element.style.height = `${Math.max(0, rect.height)}px`;
        layer.append(element);
      }
    }

    if (layer.childElementCount > 0) frameEl.append(layer);
  }
}

function scheduleFrameMarks(): void {
  if (!props.findFrameMarks?.length && !frameMarksAttached) return;
  if (frameMarkHandle !== undefined) return;

  frameMarkHandle = requestAnimationFrame(() => {
    frameMarkHandle = undefined;
    applyFrameMarks();
  });
}

watch(() => props.findFrameMarks, scheduleFrameMarks, { deep: true });
watch(
  () => props.readOnly,
  (readOnly) => {
    view.value?.dispatch({
      effects: readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly)),
    });
  },
);

function createStateConfig(): EditorStateConfig {
  const extensions: Extension[] = [];

  // Injected after CM's runtime base theme, so token-based colors win over
  // the defaults (cursor, tooltip, selection, gutters). The app theme comes
  // last for its own overrides.
  extensions.push(typstTheme, typstEditorTheme);

  if (props.degraded) {
    // Engine-free editing: keep text sync, keymap, language data, and
    // spellcheck. Drop everything that calls into the wasm state. The static
    // highlighter keeps the source readable while previews are gone.
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) props.text.value = update.state.doc.toString();
      }),
      typstStaticHighlighting,
      typstKeymap,
      typstLanguageData,
      typstEditingExtensions,
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
          onCompile: () => {
            props.onCompile?.();
            props.onPagedCompile?.();
          },
          onExternalLink: openExternalLink,
          notebook: props.notebook,
          renderFrames: props.wysiwyg,
        },
      ),
    );
  } else {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) props.text.value = update.state.doc.toString();
      }),
      typstSyntaxHighlighting(props.fileId, props.typstState),
      typstHoverTooltip(props.fileId, props.typstState),
      typstSourceSync(props.fileId, props.prelude, props.typstState),
      typstKeymap,
      typstLanguageData,
      typstEditingExtensions,
      autocompletion({
        override: [(context) => autocomplete(context, props.fileId, props.typstState)],
      }),
    );
  }

  extensions.push(
    ...(props.degraded
      ? []
      : [
          typstLinter(props.fileId, props.spaceId, props.path, props.prelude, props.typstState, {
            onRequests: props.onRequests,
            onPanic: props.onPanic,
            onCompile: props.onCompile,
          }),
        ]),
    // Local edits go to the page doc as operations, not as a whole document
    // replace. Remote transactions are skipped: their delta already came from
    // the doc, and writing it back would duplicate it.
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || !props.onTextChange) return;

      for (const transaction of update.transactions) {
        if (transaction.annotation(remoteTextChange)) continue;

        const changes: PageTextChange[] = [];
        transaction.changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
          changes.push({ from, to, insert: inserted.toString() });
        });
        if (changes.length > 0) props.onTextChange(changes);
      }
    }),
    spellcheckCompartment.of(spellcheckExtension(props.spellcheck, spellcheckOptions())),
    editorDisplayCompartment.of(editorDisplayExtension(props.editor)),
    findCompartment.of(EditorView.decorations.of(findDecorations())),
    EditorView.exceptionSink.of((error) => {
      console.error(error);
    }),
    readOnlyCompartment.of(readOnlyExtensions(props.readOnly)),
    highlightSpecialChars(),
    lintGutter(),
    history(),
    vimCompartment.of(vimExtension()),
    drawSelection(),
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) updateCursorPosition(update.state);
      if (update.docChanged || update.focusChanged || update.viewportChanged) {
        scheduleFrameMarks();
      }
    }),
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
    tooltips({ parent: document.body }),
  );

  if (props.extensions) extensions.push(...props.extensions);

  return { extensions };
}

/** Forces a recompile even though the doc did not change (data/fonts did). */
function recompile() {
  // The document text size can have changed with the same doc text. Measure
  // before recompiling so widget heights and line boxes match the new font.
  view.value?.requestMeasure();
  view.value?.dispatch({ effects: typstRecompileEffect.of(null) });
}

/**
 * Selects a source range (search hits, embedded references). `focus` false
 * leaves the caret where it is, so the find bar keeps focus while the page
 * scrolls behind it.
 */
function revealRange(from: number, to: number, focus = true) {
  const editor = view.value;
  if (!editor) return;

  editor.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
  if (focus) editor.focus();
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

/**
 * Mirrors a Loro text delta into the editor. Each operation is its own
 * transaction outside the undo history, so undoing local typing cannot revert
 * a peer's edit. Positions are UTF-16, matching both Loro and CodeMirror.
 */
function applyTextDelta(delta: readonly PageTextDelta[]): void {
  const editor = view.value;
  if (!editor) return;

  let pos = 0;
  for (const op of delta) {
    if (typeof op.retain === "number") {
      pos += op.retain;
      continue;
    }
    if (typeof op.insert === "string") {
      if (op.insert) {
        editor.dispatch({
          changes: { from: pos, insert: op.insert },
          annotations: remoteTextAnnotations,
        });
      }
      // The next original character sits after the inserted text.
      pos += op.insert.length;
      continue;
    }
    if (typeof op.delete === "number" && op.delete > 0) {
      editor.dispatch({
        changes: { from: pos, to: pos + op.delete },
        annotations: remoteTextAnnotations,
      });
    }
  }
}

defineExpose({ view, recompile, revealRange, insertAt, applyTextDelta });
</script>

<template>
  <section
    ref="container"
    class="editable-pane"
    :class="{ 'editable-pane--dragging': dragActive, 'editable-pane--measure': measureColumn }"
  >
    <div v-if="dragActive" class="editable-pane__drop" aria-hidden="true">
      <span class="editable-pane__drop-line" :style="{ top: `${dropTop}px` }">
        <span class="editable-pane__drop-label">
          <MsIcon name="add_photo_alternate" :size="16" />
          {{ $t("pageView.dropMedia") }}
        </span>
      </span>
    </div>

    <div v-if="vimMode" class="editable-pane__status" role="status" aria-live="polite">
      <span class="editable-pane__vim-mode">{{ vimMode.toUpperCase() }}</span>
      <span v-if="vimKeys" class="editable-pane__vim-keys">{{ vimKeys }}</span>
      <span class="editable-pane__vim-position">
        {{ $t("pageView.lineColumn", { line: cursorLine, column: cursorColumn }) }}
      </span>
    </div>
  </section>
</template>

<style>
.editable-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.editable-pane .cm-editor {
  flex: 1;
  min-height: 0;
  height: auto;
  order: 0;
}

/* The scroller keeps the full pane, so the wheel scrolls anywhere in it, and
   insets its contents to one centered column. The gutter shares the inset, so
   line numbers stay attached to the text. The engine subtracts this padding
   when it reads the render width. */
.editable-pane--measure {
  --editor-measure-inset: max(0px, calc((100% - var(--doc-measure)) / 2));
}

.editable-pane--measure .cm-editor .cm-scroller {
  padding-inline: var(--editor-measure-inset);
}

/* Keep the drop hint on the column instead of running past it. */
.editable-pane--measure .editable-pane__drop-line {
  left: calc(var(--space-2-5) + var(--editor-measure-inset));
  right: calc(var(--space-2-5) + var(--editor-measure-inset));
}

/* The mode line is a sibling of CodeMirror, which is appended to this section.
   Ordering it after the editor keeps it at the bottom whatever the mount order. */
.editable-pane__status {
  flex: none;
  order: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-sm);
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border-top: 1px solid var(--color-border);
}

.editable-pane__vim-mode {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--color-accent);
  letter-spacing: 0.04em;
}

.editable-pane__vim-keys {
  font-family: var(--font-mono);
  color: var(--color-warning);
}

.editable-pane__vim-position {
  margin-left: auto;
  font-family: var(--font-mono);
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
  animation: editable-pane-drop-in var(--motion-fast);
}

/* Insertion line: rides the pointer's line and shows the hint chip, so the
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
  box-shadow: var(--shadow-2);
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

/* Vim chrome. The editor itself is themed by @typbase/codemirror; these
   classes come from @replit/codemirror-vim, which the app adds itself. */

.cm-editor .cm-fat-cursor {
  color: var(--color-on-accent) !important;
  background: var(--color-accent);
}

body .cm-editor:not(.cm-focused) .cm-fat-cursor {
  background: none;
  outline: 1px solid var(--color-accent);
}

/* The mode line Under the editor while vim bindings are on. */
.cm-editor .cm-vim-panel {
  display: flex;
  align-items: center;
  min-height: var(--control-sm);
  padding: 0 var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border-top: 1px solid var(--color-border);
}

.cm-editor .cm-vim-panel span:first-child {
  color: var(--color-accent);
  font-weight: 600;
}

.cm-editor .cm-vim-panel input {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  color: var(--color-text);
}

/* Page-find rectangles over rendered frames. The container is the package's
   `.typst-render`, so the layer tracks its pinned size. */
.typst-find-marks {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--render-w);
  height: var(--render-h);
  overflow: hidden;
  pointer-events: none;
}

.typst-find-mark {
  position: absolute;
  background: color-mix(in srgb, var(--color-accent) 24%, transparent);
  border-radius: 2px;
}

.typst-find-mark--active {
  background: color-mix(in srgb, var(--color-accent) 46%, transparent);
  box-shadow: 0 0 0 1px var(--color-accent);
}

.typbase-remote-cursor {
  background-color: color-mix(in srgb, var(--cursor-color) 25%, transparent);
  border-bottom: 2px solid var(--cursor-color);
}

.typbase-remote-cursor-anchor {
  display: inline-block;
  position: relative;
  width: 0;
  height: 1em;
  height: 1lh;
  vertical-align: baseline;
  pointer-events: none;
}

/* A peer inside a replaced frame has no source text to point at. The flag
   anchors at the frame start instead of the hidden source end. */
.typbase-remote-cursor-anchor--block {
  vertical-align: top;
}

.typbase-remote-cursor-anchor--block .typbase-remote-cursor-flag {
  bottom: auto;
  top: 0;
  z-index: 3;
}

.typbase-remote-cursor-flag {
  position: absolute;
  left: 0;
  bottom: 100%;
  transform: translateX(-2px);
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
</style>
