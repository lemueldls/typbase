<script setup lang="ts">
import type { SpellcheckMode } from "@typbase/typing";
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
  typstLinter,
  typstPlugin,
  typstRecompileEffect,
  typstSyntaxHighlighting,
} from "@typbase/codemirror";

import { typstEditorTheme } from "~/lib/cmTheme";
import { spellcheckCompartment, spellcheckExtension } from "~/lib/spellcheck";

const props = defineProps<{
  fileId: FileId;
  spaceId: string;
  path: string;
  text: TextRef;
  prelude: TextRef;
  /** WYSIWYG (inline previews) vs plain source editing. */
  wysiwyg: boolean;
  /** Spellcheck provider; reconfigured in place when it changes. */
  spellcheck?: SpellcheckMode;
  typstState: TypstState;
  onRequests?: (requests: TypstRequest[], spaceId: string) => Promise<boolean> | boolean;
  revision?: () => string | number | undefined;
  /** Extra CodeMirror extensions (presence cursors, AI menus, search scroll). */
  extensions?: Extension[];
  /** Fired when the plugin's compile trapped; the parent rebuilds the wasm state. */
  onPanic?: () => void;
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
});

// Write vs source mode need different extension sets; rebuild on switch.
watch(
  () => props.wysiwyg,
  () => {
    view.value?.destroy();
    createView();
  },
);

// The spellcheck provider is swapped in place; the Harper source only loads
// its worker once something selects it.
watch(
  () => props.spellcheck,
  (mode) => {
    view.value?.dispatch({
      effects: spellcheckCompartment.reconfigure(spellcheckExtension(mode)),
    });
  },
);

function createStateConfig(): EditorStateConfig {
  const extensions: Extension[] = [];

  // Injected after CM's runtime base theme, so token-based colors win over
  // the defaults (cursor, tooltip, selection, gutters).
  extensions.push(typstEditorTheme);

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
    // Diagnostics in every mode: the linter source combines with the
    // spellcheck source instead of replacing it, and split/source have no
    // WYSIWYG plugin to compile for them.
    typstLinter(props.fileId, props.spaceId, props.path, props.prelude, props.typstState, {
      onRequests: props.onRequests,
      onPanic: props.onPanic,
    }),
    spellcheckCompartment.of(spellcheckExtension(props.spellcheck)),
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

<style scoped>
.editable-pane {
  position: relative;
  height: 100%;
  min-height: 0;
}

.editable-pane :deep(.cm-editor) {
  height: 100%;
}

.editable-pane--dragging :deep(.cm-editor) {
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
</style>
