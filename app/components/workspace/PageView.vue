<script setup lang="ts">
import type { PageMeta } from "@typbase/typing";
import type { FileId, TypstState } from "@typbase/wasm";

import { EditorView, ViewUpdate } from "@codemirror/view";
import { typstRecompileEffect } from "@typbase/codemirror";
import { nextTick } from "vue";

import { applyWorkspaceStyleToTypst, renderRevision, useTypst } from "~/composables/typst";
import { useWorkspace } from "~/composables/workspace";
import { presenceCursors, refreshPresence, type PresencePeer } from "~/lib/presenceCursor";
import { revealRequests } from "~/lib/reveal";
import { recreateTypstState } from "~/lib/typstRecovery";
import { createTypstRequestService, type TypstRequestService } from "~/lib/typstRequests";

import AIMenu from "./AIMenu.vue";
import EditablePane from "./EditablePane.vue";
import PagedPreview from "./PagedPreview.vue";

export type ViewMode = "write" | "split" | "source" | "read";

const props = defineProps<{
  pageId: string;
  modelValue: ViewMode;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", mode: ViewMode): void;
  (e: "openPage", id: string): void;
}>();

const { workspaceId, dataRevision, ensure, presence, atproto } = useWorkspace();

const typstState = shallowRef<TypstState>();
const fileId = shallowRef<FileId>();

const boundState = computed(() => typstState.value as TypstState);
const boundFileId = computed(() => fileId.value as FileId);

const text = ref("");
const prelude = ref("");
const meta = shallowRef<PageMeta>();
const pageError = ref<string>();
const ready = ref(false);

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
    await applyWorkspaceStyleToTypst(workspaceId, store);

    const page = store.getPage(props.pageId);
    if (page) {
      fileId.value = fresh.createSourceId(page.path, workspaceId);
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

let store: Awaited<ReturnType<typeof ensure>>;
let requestService: TypstRequestService | undefined;
let unsubscribeSave: (() => void) | undefined;
let unsubscribePage: (() => void) | undefined;
let unsubscribeStructure: (() => void) | undefined;
let detachScrollSync: (() => void) | undefined;
let pageDisposed = false;

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

  store = await ensure();

  const page = store.getPage(props.pageId);
  if (!page) {
    pageError.value = `No page named ${props.pageId}`;
    return;
  }

  meta.value = page;
  personaCache.value = (await atproto.value?.ensurePersona()) ?? personaCache.value;

  text.value = await store.loadPageText(props.pageId);

  if (!typstState.value) {
    typstState.value = await useTypst();
    requestService = createTypstRequestService(typstState.value, store);
    await applyWorkspaceStyleToTypst(workspaceId, store);

    // Query JSON goes stale when pages/categories/settings change. Re-apply
    // fonts first (settings may have changed), purge the inserted files, then
    // recompile. Preview panes re-render off dataRevision on their own.
    unsubscribeStructure = store.onStructureChange(() => {
      void (async () => {
        await applyWorkspaceStyleToTypst(workspaceId, store);
        requestService?.purge();
        editorPane.value?.recompile();
        cleanupScrollSync();
        meta.value = store.getPage(props.pageId);
      })();
    });
  }

  requestService!.setCurrentPage(props.pageId);

  fileId.value = typstState.value.createSourceId(page.path, workspaceId);
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

function onRequests(requests: unknown[], spaceId: string) {
  return requestService!.handler(requests as never, spaceId);
}

const editorRevision = () => `${dataRevision.value}:${renderRevision.value}`;

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

const modes: Array<{ id: ViewMode; label: string }> = [
  { id: "write", label: "Write" },
  { id: "split", label: "Split" },
  { id: "source", label: "Source" },
  { id: "read", label: "Read" },
];
</script>

<template>
  <div class="page-view">
    <div class="page-view__toolbar">
      <span class="page-view__title">{{ meta?.title ?? pageId }}</span>

      <div class="page-view__toolbar-actions">
        <AIMenu
          v-if="store"
          :page-id="pageId"
          :store="store"
          :get-selection="getSelection"
          :insert-below-selection="insertBelowSelection"
          @open-page="emit('openPage', $event)"
        />
        <PublishButton v-if="store" :page-id="pageId" :store="store" />
        <div class="page-view__modes" role="tablist" aria-label="View mode">
          <button
            v-for="mode in modes"
            :key="mode.id"
            type="button"
            role="tab"
            :aria-selected="modelValue === mode.id"
            class="page-view__mode"
            :class="{ 'page-view__mode--active': modelValue === mode.id }"
            :disabled="!ready"
            @click="emit('update:modelValue', mode.id)"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>
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
        :data-revision="dataRevision"
        :render-revision="renderRevision"
        :on-requests="onRequests"
        :on-panic="handlePanic"
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
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.page-view__title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-view__toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}

.page-view__modes {
  display: flex;
  gap: 0.25rem;
  padding: 0.15rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}

.page-view__mode {
  padding: 0.25rem 0.7rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 0.35rem;
  cursor: pointer;
}

.page-view__mode:hover {
  color: var(--text);
}

.page-view__mode--active {
  color: var(--text);
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.page-view__error {
  padding: 1rem;
  color: var(--danger);
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
  box-shadow: -1px 0 0 var(--border);
}

.page-view__body--read :deep(.paged-preview) {
  padding: 0 1.5rem;
  background: var(--surface-2);
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
  background: var(--border);
  opacity: 0;
  transition: opacity 0.15s;
}

.page-view__handle:hover::after,
.page-view__handle:active::after {
  opacity: 1;
}
</style>
