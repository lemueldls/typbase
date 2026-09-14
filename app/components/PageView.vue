<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";
import type { FileId, TypstState } from "@typbase/wasm";

import { EditorView, ViewUpdate } from "@codemirror/view";
import { blobReference, sniffMime } from "@typbase/storage";

import { pluginsRevision } from "~/lib/plugins/registry";
import { presenceCursors, refreshPresence, type PresencePeer } from "~/lib/presenceCursor";
import { revealRequests } from "~/lib/reveal";
import { recreateTypstState } from "~/lib/typstRecovery";
import { createTypstRequestService, type TypstRequestService } from "~/lib/typstRequests";
import { VIEW_MODES, type ViewMode } from "~/lib/view";

const props = defineProps<{
  pageId: string;
  modelValue: ViewMode;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", mode: ViewMode): void;
  (e: "openPage", id: string): void;
  (e: "openPlugin", instanceId: string): void;
}>();

const { workspaceId, dataRevision, ensure, presence, atproto } = useWorkspace();
const { t } = useI18n();

const typstState = shallowRef<TypstState>();
const fileId = shallowRef<FileId>();

const boundState = computed(() => typstState.value as TypstState);
const boundFileId = computed(() => fileId.value as FileId);

const text = ref("");
const prelude = ref("");
const meta = shallowRef<PageMeta>();
const pageError = ref<string>();
const ready = ref(false);

const formatOpen = useLocalStorage("typbase:formatToolbar", true);

// Bumped when a wasm panic forces a brand-new TypstState. Children keyed on
// this remount, so the editor plugin and preview bind to the fresh instance.
const stateGeneration = ref(0);
let recovering = false;

async function handlePanic() {
  if (recovering) return;
  recovering = true;

  try {
    const message = (typstState.value?.takePanic() ?? "").trim();
    console.error(`[typst] renderer panicked, rebuilding state${message ? `: ${message}` : ""}`);

    const fresh = await recreateTypstState();
    typstState.value = fresh;
    stateGeneration.value += 1;

    // The old request service pointed at a dead instance.
    requestService = createTypstRequestService(fresh, store);
    requestService.setCurrentPage(props.pageId);
    await applyWorkspaceStyleToTypst(workspaceId.value, store);

    const page = store.getPage(props.pageId);
    if (page) {
      fileId.value = fresh.createSourceId(page.path, workspaceId.value);
      fresh.insertSource(fileId.value, text.value);
    }

    void nextTick(() => {
      editorPane.value?.recompile();
    });
  } finally {
    recovering = false;
  }
}

// Remote cursor rendering + reporting. Extra CM extensions ride the same
// list; the EditablePane remounts per page id so the closure stays honest.
const extraExtensions = computed(() => {
  if (!fileId.value) return [];

  return [
    presenceCursors(props.pageId, () => presence.value as Map<string, PresencePeer>),
    EditorView.updateListener.of((update) => {
      if (!update.selectionSet && !update.docChanged) return;

      reportCursor(update);
    }),
  ];
});

const personaCache = ref({ name: "Me", color: "#4f9ddb" });
const reportCursor = useThrottleFn((update: ViewUpdate) => {
  const service = atproto.value;
  if (!service || !update.view.hasFocus) return;

  const { from, to } = update.state.selection.main;
  service.setPresence(personaCache.value, { docId: props.pageId, from, to });
}, 300);

watch(
  presence,
  () => {
    const view = editorPane.value?.view;
    if (view) refreshPresence(view);
  },
  { deep: false },
);

let store: WorkspaceStore;
let requestService: TypstRequestService | undefined;
let unsubscribeSave: (() => void) | undefined;
let unsubscribePage: (() => void) | undefined;
let unsubscribeStructure: (() => void) | undefined;
let detachScrollSync: (() => void) | undefined;
let pageDisposed = false;

const aiEnabled = computed(() => store.getAiConfig().enabled);

const pushText = useThrottleFn((value: string) => {
  void store?.setPageText(props.pageId, value);
}, 800);

watch(
  () => props.pageId,
  () => void setupPage(),
  { immediate: true },
);

async function setupPage() {
  pageError.value = undefined;
  ready.value = false;

  const opened = await ensure();
  if (!opened) {
    pageError.value = t("pageView.noWorkspace");
    return;
  }
  store = opened;

  const page = store.getPage(props.pageId);
  if (!page) {
    pageError.value = t("pageView.noPage", { id: props.pageId });
    return;
  }

  meta.value = page;
  personaCache.value = (await atproto.value?.ensurePersona()) ?? personaCache.value;

  text.value = await store.loadPageText(props.pageId);
  // The generated prelude (theme/fonts) is implicit; this is the user's own
  // prelude, appended on every compile.
  prelude.value = store.getSettings().pagePrelude ?? "";

  if (!typstState.value) {
    typstState.value = await useTypst();
    requestService = createTypstRequestService(typstState.value, store);
    // The space context survives later createSourceId calls (see state.rs);
    // this one call is what gives pages their fonts/theme.
    await applyWorkspaceStyleToTypst(workspaceId.value, store);

    // Query JSON goes stale when pages/categories/settings change. Re-apply
    // fonts first (settings may have changed), purge the inserted files, then
    // recompile. Preview panes re-render off dataRevision on their own.
    unsubscribeStructure = store.onStructureChange(() => {
      void (async () => {
        await applyWorkspaceStyleToTypst(workspaceId.value, store);
        requestService?.purge();
        // A prelude edit must recompile with the new text.
        prelude.value = store.getSettings().pagePrelude ?? "";
        editorPane.value?.recompile();
        cleanupScrollSync();
        meta.value = store.getPage(props.pageId);
      })();
    });
  }

  requestService!.setCurrentPage(props.pageId);

  fileId.value = typstState.value.createSourceId(page.path, workspaceId.value);
  typstState.value.insertSource(fileId.value, text.value);

  unsubscribeSave?.();
  unsubscribeSave = watch(text, (value) => {
    if (value !== store.getPageText(props.pageId)) pushText(value);
  });

  unsubscribePage?.();
  void store
    .onPageDocChange(props.pageId, () => {
      // Our own saves echo back through this listener. Overwriting text.value
      // with the store's older content mid-typing reverted edits and could
      // clobber a later save. Only apply the echo when the editor is idle.
      if (editorPane.value?.view?.hasFocus) return;

      const current = store.getPageText(props.pageId);
      if (current !== text.value) text.value = current;
    })
    .then((stop) => {
      // The subscription promise can resolve after unmount (page switched);
      // release it instead of leaking a dead listener.
      if (pageDisposed) stop();
      else unsubscribePage = stop;
    });

  ready.value = true;
}

onBeforeUnmount(() => {
  pageDisposed = true;
  cleanupScrollSync();
  unsubscribeSave?.();
  unsubscribePage?.();
  unsubscribeStructure?.();
  void store?.flush();
});

function cleanupScrollSync() {
  detachScrollSync?.();
  detachScrollSync = undefined;
}

const editorPane = useTemplateRef("editorPane");
const previewPane = useTemplateRef("previewPane");

// Search palette / generated-content reveal requests for this page.
watch(
  revealRequests,
  (requests) => {
    const mine = requests.find((request) => request.pageId === props.pageId && !request.consumed);
    if (!mine) return;

    mine.consumed = true;
    void nextTick(() => {
      editorPane.value?.revealRange(mine.from, mine.to);
    });
  },
  { deep: false },
);

function getSelection(): { from: number; to: number; text: string } | null {
  const view = editorPane.value?.view;
  if (!view) return null;

  const { from, to } = view.state.selection.main;
  if (from === to) return null;

  return { from, to, text: view.state.sliceDoc(from, to) };
}

function insertBelowSelection(from: number, to: number, output: string): void {
  const at = Math.max(from, to);
  editorPane.value?.insertAt(at, `\n\n${output}\n`);
}

/**
 * Media dropped on the editor: store the bytes as a blob, then insert the
 * Typst reference at the drop position. Known blobs (asset drags) skip the
 * upload.
 */
async function handleAssetDrop(
  payload: { file?: File; hash?: string; mime?: string },
  position: number,
): Promise<void> {
  try {
    let hash = payload.hash;
    let mime = payload.mime;

    if (payload.file) {
      const bytes = new Uint8Array(await payload.file.arrayBuffer());
      const entry = await store.putBlob(bytes);
      hash = entry.hash;
      mime = payload.file.type || sniffMime(bytes);
    }
    if (!hash) return;

    mime ||= "application/octet-stream";
    const reference = blobReference(hash, mime);
    const insert = mime.startsWith("image/")
      ? `#image("${reference}")`
      : `#link("${reference}")[${payload.file?.name ?? hash.slice(0, 8)}]`;

    editorPane.value?.insertAt(position, insert);
  } catch (cause) {
    console.error("[assets] drop failed:", cause);
  }
}

function onRequests(requests: unknown[], spaceId: string) {
  return requestService!.handler(requests as never, spaceId);
}

const editorRevision = () =>
  `${dataRevision.value}:${renderRevision.value}:${pluginsRevision.value}`;

// Plugin sources and plugin data are request-channel files; when they change
// the injected copies must go so the next compile re-requests them.
watch(pluginsRevision, () => {
  requestService?.purge();
  editorPane.value?.recompile();
});

// Template bindings unwrap refs (":text=\"text\"" passes the string). The
// editor/preview need the ref objects themselves; v-bind spread keeps them.
const sharedState = computed(() => ({ text, prelude }));

// System fonts were installed; the typeface set changed under the docs.
watch(renderRevision, () => {
  editorPane.value?.recompile();
});

watch([() => props.modelValue, () => props.pageId, fileId], async () => {
  cleanupScrollSync();
  if (props.modelValue !== "split") return;

  await nextTick();

  const view = editorPane.value?.view;
  const scroller = previewPane.value?.scroller;
  if (!view || !scroller) return;

  const onEditor = () => syncFromEditor(view, scroller);
  const onPreview = () => syncFromPreview(view, scroller);

  view.scrollDOM.addEventListener("scroll", onEditor, { passive: true });
  scroller.addEventListener("scroll", onPreview, { passive: true });
  detachScrollSync = () => {
    view.scrollDOM.removeEventListener("scroll", onEditor);
    scroller.removeEventListener("scroll", onPreview);
  };
});

let syncLockUntil = 0;

function syncFromEditor(view: EditorView, scroller: HTMLElement) {
  if (Date.now() < syncLockUntil) return;

  const layout = previewPane.value?.getFrameLayout();
  if (!layout || !layout.tops.length) return;

  const y = view.scrollDOM.scrollTop;
  const block = view.lineBlockAtHeight(Math.min(y, view.contentHeight - 1));
  const pos = block ? block.from : 0;

  const index = layout.ranges.findIndex(
    (range) => pos >= range.start && pos <= Math.max(range.start, range.end - 1),
  );
  const top = layout.tops[index];
  if (top === undefined || Math.abs(scroller.scrollTop - top) < 4) return;

  syncLockUntil = Date.now() + 200;
  scroller.scrollTop = top;
}

function syncFromPreview(view: EditorView, scroller: HTMLElement) {
  if (Date.now() < syncLockUntil) return;

  const layout = previewPane.value?.getFrameLayout();
  if (!layout || !layout.tops.length) return;

  let index = -1;
  for (let i = 0; i < layout.tops.length; i++) {
    const top = layout.tops[i];
    if (top !== undefined && top <= scroller.scrollTop + 2) index = i;
    else break;
  }
  if (index === -1) return;

  const range = layout.ranges[index];
  if (!range) return;

  const line = view.state.doc.lineAt(range.start);

  syncLockUntil = Date.now() + 200;
  view.dispatch({
    effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 0 }),
  });
}

const splitLeft = ref(50);

function startSplitDrag(event: PointerEvent) {
  event.preventDefault();

  const container = (event.currentTarget as HTMLElement).parentElement;
  if (!container) return;

  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);

  const onMove = (move: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    const percent = ((move.clientX - rect.left) / rect.width) * 100;
    splitLeft.value = Math.min(80, Math.max(20, percent));
  };

  const onUp = () => {
    target.releasePointerCapture(event.pointerId);
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
  };

  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
}

const modes: Array<{ id: ViewMode; key: string }> = VIEW_MODES.map((id) => ({
  id,
  key: `pageView.${id}`,
}));

// Arrow keys move between view modes, per the tabs pattern.
function onModeKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const index = modes.findIndex((mode) => mode.id === props.modelValue);
  const delta = event.key === "ArrowRight" ? 1 : -1;
  const next = modes[(index + delta + modes.length) % modes.length];
  if (next) emit("update:modelValue", next.id);
}
</script>

<template>
  <div class="page-view">
    <div class="page-view__toolbar">
      <div class="page-view__toolbar-main">
        <!-- Mobile nav toggle, provided by the shell; flows inline so it never
             covers the title. -->
        <slot name="nav-toggle" />
        <span class="page-view__title">{{ meta?.title ?? pageId }}</span>
        <div
          class="page-view__modes"
          role="tablist"
          aria-label="View mode"
          aria-orientation="horizontal"
          @keydown="onModeKeydown"
        >
          <button
            v-for="mode in modes"
            :key="mode.id"
            type="button"
            role="tab"
            :aria-selected="modelValue === mode.id"
            :tabindex="modelValue === mode.id ? 0 : -1"
            class="page-view__mode"
            :class="{ 'page-view__mode--active': modelValue === mode.id }"
            :disabled="!ready"
            @click="emit('update:modelValue', mode.id)"
          >
            {{ $t(mode.key) }}
          </button>
        </div>
      </div>

      <div class="page-view__toolbar-actions">
        <!-- Collapsed bar: the reopen toggle lives here, where it never adds a
             second row while the bar is open. -->
        <button
          v-if="modelValue !== 'read' && !formatOpen"
          type="button"
          class="button button--icon page-view__format-toggle"
          :aria-pressed="false"
          :aria-label="$t('formatting.title')"
          @click="formatOpen = true"
        >
          <MsIcon name="text_format" :size="20" />
        </button>
        <AIMenu
          v-if="store && aiEnabled"
          :page-id="pageId"
          :store="store"
          :get-selection="getSelection"
          :insert-below-selection="insertBelowSelection"
          @open-page="emit('openPage', $event)"
        />
        <PublishButton v-if="store" :page-id="pageId" :store="store" />
      </div>
    </div>

    <!-- Formatting bar: its own full-width row so it never fights the
         title/modes or the AI/publish actions for space. Scrolls sideways
         when narrow; the chevron at its right edge collapses it entirely. -->
    <div v-if="modelValue !== 'read' && formatOpen" class="page-view__format">
      <EditToolbar :disabled="!ready" :view="editorPane?.view" />
      <button
        type="button"
        class="page-view__format-collapse"
        :aria-label="$t('formatting.collapse')"
        @click="formatOpen = false"
      >
        <MsIcon name="keyboard_arrow_up" :size="20" />
      </button>
    </div>

    <div v-if="pageError" class="page-view__error">{{ pageError }}</div>

    <div
      v-else
      class="page-view__body"
      :class="modelValue === 'split' ? 'page-view__body--split' : 'page-view__body--single'"
      :style="{ '--split-left': `${splitLeft}%` }"
    >
      <EditablePane
        v-if="boundFileId"
        :key="`${pageId}:${stateGeneration}`"
        v-show="modelValue !== 'read'"
        v-bind="sharedState"
        ref="editorPane"
        :file-id="boundFileId"
        :space-id="workspaceId"
        :path="meta?.path ?? ''"
        :wysiwyg="modelValue === 'write'"
        :typst-state="boundState"
        :on-requests="onRequests"
        :revision="editorRevision"
        :extensions="extraExtensions"
        :on-panic="handlePanic"
        :on-navigate="(pageId) => emit('openPage', pageId)"
        :on-navigate-plugin="(instanceId) => emit('openPlugin', instanceId)"
        :on-asset-drop="handleAssetDrop"
      />

      <div v-if="modelValue === 'split'" class="page-view__handle" @pointerdown="startSplitDrag" />

      <PagedPreview
        v-if="boundFileId"
        :key="`${pageId}:preview:${stateGeneration}`"
        v-show="modelValue === 'split' || modelValue === 'read'"
        v-bind="sharedState"
        ref="previewPane"
        :file-id="boundFileId"
        :space-id="workspaceId"
        :typst-state="boundState"
        :data-revision="dataRevision + pluginsRevision"
        :render-revision="renderRevision"
        :on-requests="onRequests"
        :on-panic="handlePanic"
        @navigate="emit('openPage', $event)"
        @navigate-plugin="emit('openPlugin', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.page-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.page-view__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  min-height: 3.5rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.page-view__toolbar-main {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1 1 auto;
}

/* Modes ride the right edge of the main row at every breakpoint: space
   between pushes them there while the title takes the flexible middle. */
.page-view__toolbar-main .page-view__title {
  flex: 1;
}

.page-view__title {
  font-size: 1.05rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.page-view__toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  max-width: 100%;
}

.page-view__format-toggle[aria-pressed="true"] {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* Chevron pinned to the strip's right edge; matches the edit button size. */
.page-view__format-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  flex: none;
  padding: 0;
  margin-left: auto;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: 0.35rem;
  cursor: pointer;
}

.page-view__format-collapse:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

/* Full-width strip: the buttons ride inside it, left-aligned, scrolling
   sideways when they do not fit. */
.page-view__format {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.25rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.page-view__format::-webkit-scrollbar {
  display: none;
}

.page-view__format > * {
  flex: none;
}

/* Mobile: the toolbar stacks. Title + modes on top, then the AI/publish
   actions as one horizontally scrollable row so nothing gets buried. */
@media (max-width: 768px) {
  .page-view__toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
    padding: 0.4rem 0.5rem;
    min-height: 0;
  }

  .page-view__toolbar-main {
    width: 100%;
    gap: 0.4rem;
  }

  .page-view__mode {
    padding: 0.35rem 0.65rem;
  }

  .page-view__toolbar-actions {
    width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .page-view__toolbar-actions > * {
    flex: none;
  }

  .page-view__toolbar-actions::-webkit-scrollbar {
    display: none;
  }

  .page-view__format {
    padding: 0.2rem 0.5rem;
  }
}

.page-view__modes {
  display: flex;
  gap: 0.25rem;
  padding: 0.15rem;
  flex: none;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
}

.page-view__mode {
  padding: 0.25rem 0.7rem;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: 0.35rem;
  cursor: pointer;
}

.page-view__mode:hover {
  color: var(--color-text);
}

.page-view__mode--active {
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.page-view__error {
  padding: 1rem;
  color: var(--color-danger);
}

.page-view__body {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.page-view__body--single {
  display: grid;
  grid-template-columns: 100%;
}

.page-view__body--split {
  display: grid;
  grid-template-columns: minmax(0, var(--split-left, 50%)) 6px minmax(0, 1fr);
}

.page-view__body > * {
  min-width: 0;
  min-height: 0;
}

.page-view__body--split :deep(.paged-preview) {
  box-shadow: -1px 0 0 var(--color-border);
}

.page-view__body--read :deep(.paged-preview) {
  padding: 0 1.5rem;
  background: var(--color-surface-2);
}

/* Split view stacks on phones: side-by-side panes would give each ~190px.
   The horizontal drag handle is hidden; editors/previews scroll on their own. */
@media (max-width: 768px) {
  .page-view__body--split {
    grid-template-columns: 100%;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }

  .page-view__handle {
    display: none;
  }

  .page-view__body--split :deep(.paged-preview) {
    box-shadow: 0 -1px 0 var(--color-border);
  }

  .page-view__body--read :deep(.paged-preview) {
    padding: 0 0.5rem;
  }
}

.page-view__handle {
  cursor: col-resize;
  position: relative;
  touch-action: none;
}

.page-view__handle::after {
  content: "";
  position: absolute;
  inset: 0 2px;
  background: var(--color-border);
  opacity: 0;
  transition: opacity 0.15s;
}

.page-view__handle:hover::after,
.page-view__handle:active::after {
  opacity: 1;
}
</style>
