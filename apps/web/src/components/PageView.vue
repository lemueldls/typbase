<script setup lang="ts">
import type { FileId, TypstState } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type { IgnoredSpellcheckLint, PageMeta } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { EditorView, ViewUpdate } from "@codemirror/view";
import {
  deleteCellAt,
  focusCell,
  insertCell,
  insertCellAt,
  moveCellAt,
  runAllCells,
  runCell,
  setCellType,
  type NotebookLabels,
} from "@typbase/codemirror";
import { blobReference, sniffMime } from "@typbase/storage";

import {
  beginRecovery,
  canAutoRebuild,
  failEngine,
  noteCompileSuccess,
  noteTrap,
  requestEngineRetry,
  setEngineRetryHandler,
  useEngineHealth,
  type EngineFailure,
} from "~/lib/engineHealth";
import { fontFamiliesInSource } from "~/lib/fonts";
import {
  createNotebookController,
  createNotebookSession,
  type NotebookController,
} from "~/lib/notebook";
import { pluginsRevision } from "~/lib/plugins/registry";
import { presenceCursors, refreshPresence, type PresencePeer } from "~/lib/presenceCursor";
import { mirrorPageProject } from "~/lib/projectMirror";
import { revealRequests } from "~/lib/reveal";
import { setSaveHandler } from "~/lib/saveRequest";
import { addDictionaryWord, addIgnoredLint } from "~/lib/spellcheckSettings";
import { testApi } from "~/lib/testApi";
import { recreateTypstState, takeEngineFailure } from "~/lib/typstRecovery";
import { createTypstRequestService, type TypstRequestService } from "~/lib/typstRequests";
import { VIEW_MODES, type ViewModeId } from "~/lib/view";

const props = defineProps<{
  pageId: string;
  modelValue: ViewModeId;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", mode: ViewModeId): void;
  (e: "openPage", id: string): void;
  (e: "openPlugin", instanceId: string): void;
}>();

const { workspaceId, dataRevision, ensure, presence, atproto } = useWorkspace();
const { show: showSearch } = useSearchPalette();
const { t } = useI18n();

const typstState = shallowRef<TypstState>();
const fileId = shallowRef<FileId>();

const engineHealth = useEngineHealth();
const degraded = computed(() => engineHealth.value.status === "failed");

/** Evict comemo caches once the wasm heap passes this. */
const HEAP_WATERMARK = 1_000_000_000;
/** Age out per-keystroke cache entries this often. */
const EVICT_AGED_EVERY = 50;
/** Idle sweep interval for the heap watchdog. */
const HEAP_IDLE_MS = 30_000;

let compilesSinceEvict = 0;
/** Wasm memory never shrinks, so the watermark can only fire once. */
let heapEvicted = false;

const boundState = computed(() => typstState.value as TypstState);
const boundFileId = computed(() => fileId.value as FileId);

const text = ref("");
const prelude = ref("");
const meta = shallowRef<PageMeta>();
const pageError = ref<string>();
const ready = ref(false);

const formatOpen = useLocalStorage("typbase:formatToolbar", true);
const packagesOpen = ref(false);
const assetsOpen = ref(false);
const exportOpen = ref(false);

// The toolbar drops its action buttons into the overflow menu when the pane is
// narrow. Observed on the pane, not a viewport media query: expanding the
// sidebar narrows the pane without changing the window.
const pageView = useTemplateRef("pageView");
const paneWidth = ref(typeof window === "undefined" ? 1024 : window.innerWidth);
useResizeObserver(pageView, (entries) => {
  const entry = entries[0];
  if (entry) paneWidth.value = entry.contentRect.width;
});
const compact = computed(() => paneWidth.value > 0 && paneWidth.value <= 768);

// ---- Notebook mode -------------------------------------------------------

const notebookSession = createNotebookSession();
const notebookController = shallowRef<NotebookController>();
/** Cell selected in command mode (editor blurred); null while editing. */
const notebookSelected = ref<number | null>(null);
let pendingNotebookDelete = false;
let pendingDeleteTimer: ReturnType<typeof setTimeout> | undefined;

const notebookLabels = computed<NotebookLabels>(() => ({
  run: t("notebook.run"),
  code: t("notebook.code"),
  markup: t("notebook.markup"),
  moveUp: t("notebook.moveUp"),
  moveDown: t("notebook.moveDown"),
  duplicate: t("notebook.duplicate"),
  remove: t("notebook.remove"),
  clearOutput: t("notebook.clearOutput"),
  toggleSource: t("notebook.toggleSource"),
  noOutput: t("notebook.noOutput"),
  error: t("notebook.error"),
}));

function notebookView(): EditorView | undefined {
  return editorPane.value?.view;
}

function syncNotebookController(): void {
  const state = typstState.value;
  if (!state || !store) return;

  notebookController.value = createNotebookController({
    store,
    typstState: state,
    session: notebookSession,
    labels: notebookLabels.value,
    onCommandMode: () => {
      notebookSelected.value = notebookSession.active;
      notebookView()?.contentDOM.blur();
    },
  });
}

function runNotebookCell(): void {
  const view = notebookView();
  const index = notebookSelected.value ?? notebookSession.active;
  if (view && index !== null && index >= 0) runCell(view, index);
}

function runAllNotebook(): void {
  const view = notebookView();
  if (view) runAllCells(view);
}

function restartNotebook(): void {
  notebookController.value?.restart(notebookView());
}

function clearNotebookOutput(): void {
  const view = notebookView();
  const index = notebookSelected.value ?? notebookSession.active;
  if (view && index !== null && index >= 0) notebookController.value?.clearOutput(view, index);
}

function addNotebookCell(): void {
  const view = notebookView();
  if (view) insertCell(view, "end");
}

function selectNotebookCell(index: number | null): void {
  const count = notebookSession.cells.length;
  if (index === null || count === 0) {
    notebookSelected.value = null;

    return;
  }

  notebookSelected.value = Math.min(Math.max(index, 0), count - 1);
}

/** Command-mode keys, Jupyter style (A/B/DD/M/Y/L), while the editor is blurred. */
function onNotebookCommandKey(event: KeyboardEvent): void {
  if (notebookSelected.value === null) return;

  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true']"))
  ) {
    return;
  }

  const view = notebookView();
  const index = notebookSelected.value;
  if (!view) return;

  const consume = () => {
    event.preventDefault();
    event.stopPropagation();
  };

  const resetDelete = () => {
    pendingNotebookDelete = false;
    clearTimeout(pendingDeleteTimer);
  };

  if (event.key === "Enter") {
    consume();
    if (event.shiftKey) {
      runCell(view, index);

      return;
    }

    focusCell(view, index);
    notebookSelected.value = null;

    return;
  }

  if (event.key === "Escape") {
    consume();
    resetDelete();
    notebookSelected.value = null;

    return;
  }

  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    consume();

    const delta = event.key === "ArrowUp" ? -1 : 1;
    if (event.altKey) {
      moveCellAt(view, index, delta);
      selectNotebookCell(index + delta);

      return;
    }

    resetDelete();
    selectNotebookCell(index + delta);

    return;
  }

  switch (event.key.toLowerCase()) {
    case "a":
      consume();
      insertCellAt(view, index, "above");
      return;
    case "b":
      consume();
      insertCellAt(view, index, "below");
      selectNotebookCell(index + 1);
      return;
    case "d":
      consume();
      if (pendingNotebookDelete) {
        resetDelete();
        deleteCellAt(view, index);
        selectNotebookCell(Math.min(index, notebookSession.cells.length - 1));
      } else {
        pendingNotebookDelete = true;
        pendingDeleteTimer = setTimeout(resetDelete, 800);
      }
      return;
    case "m":
      consume();
      setCellType(view, index, "markup");
      return;
    case "y":
      consume();
      setCellType(view, index, "code");
      return;
    case "l":
      consume();
      notebookController.value?.toggleCollapse(view, index);
      return;
    default:
      break;
  }
}

useEventListener(window, "keydown", onNotebookCommandKey);

// Bumped when a wasm panic forces a brand-new TypstState. Children keyed on
// this remount, so the editor plugin and preview bind to the fresh instance.
const stateGeneration = ref(0);
let recovering = false;

/**
 * One automatic rebuild per failure burst, and only for an out-of-memory
 * abort: the OOM trace lands in the memoized call body where comemo holds no
 * lock, so the same module instance is safe to rebuild. Anything else goes
 * straight to `failed`, because a lock held at abort time would hang the next
 * wasm call and JS cannot time out a synchronous call. Manual retries bypass
 * the breaker.
 */
async function handlePanic(options: { manual?: boolean } = {}) {
  if (recovering) return;
  recovering = true;

  // The flags come from module-level bindings: after a trap in a `&mut self`
  // method the state object itself is unusable, and a method call here would
  // throw instead of reporting why the engine died.
  const { oom: isOom, message } = takeEngineFailure();
  const reason: EngineFailure = isOom ? "oom" : "trap";

  try {
    if (!options.manual && !canAutoRebuild(isOom)) {
      console.error(`[typst] engine failed (${reason})${message ? `: ${message}` : ""}`);
      failEngine(reason, message);
      return;
    }

    noteTrap(reason, message);
    console.error(
      `[typst] renderer panicked (${reason})${message ? `: ${message}` : ""}, rebuilding state`,
    );
    beginRecovery(reason);

    const fresh = await recreateTypstState();
    typstState.value = fresh;
    // The old request service pointed at a dead instance.
    requestService = createTypstRequestService(fresh, store);
    await applyWorkspaceStyleToTypst(workspaceId.value, store, fontFamiliesInSource(text.value));
    if (pageDisposed) return;

    notebookController.value?.cancelRun();
    if (meta.value) bindPage(props.pageId, meta.value, setupToken);
    // Bump last: the remount has to see the fresh state and the new file id
    // together, or the editor binds one to the other.
    stateGeneration.value += 1;
  } catch (cause) {
    console.error("[typst] engine rebuild failed:", cause);
    failEngine("rebuild-failed", cause instanceof Error ? cause.message : String(cause));
  } finally {
    recovering = false;
  }
}

/**
 * Every successful compile lands here: it clears the failure breaker and, past
 * the heap watermark, trims the memoization caches that grow while typing.
 */
function onEngineCompile() {
  noteCompileSuccess();

  compilesSinceEvict += 1;
  const state = typstState.value;
  if (!state) return;

  if (!heapEvicted && state.memoryBytes() > HEAP_WATERMARK) {
    // Latch it: the linear memory cannot shrink, so an unlatched check would
    // evict everything on every later compile. The aged eviction below keeps
    // the cache bounded from here on.
    heapEvicted = true;
    console.warn("[typst] wasm heap over watermark, evicting caches");
    state.evictCaches();
    compilesSinceEvict = 0;

    return;
  }

  if (compilesSinceEvict >= EVICT_AGED_EVERY) {
    compilesSinceEvict = 0;
    state.evictCachesAged(1);
  }
}

/** Mode to restore once a failed engine recovers. */
let modeBeforeFailure: ViewModeId | undefined;

watch(
  () => engineHealth.value.status,
  (status) => {
    if (status === "failed") {
      if (props.modelValue !== "source") {
        modeBeforeFailure = props.modelValue;
        emit("update:modelValue", "source");
      }

      return;
    }

    if (status === "ok" && modeBeforeFailure) {
      const restore = modeBeforeFailure;
      modeBeforeFailure = undefined;
      if (props.modelValue === "source") emit("update:modelValue", restore);
    }
  },
);

function reloadApp() {
  window.location.reload();
}

// Remote cursor rendering + reporting. Extra CM extensions ride the same
// list; the EditablePane remounts per page id so the closure stays honest.
const extraExtensions = computed(() => {
  if (!fileId.value) return [];

  return [
    presenceCursors(props.pageId, () => presence.value as Map<string, PresencePeer>),
    EditorView.updateListener.of((update) => {
      // Focusing the editor leaves command mode; the cursor cell becomes the
      // active one again.
      if (update.focusChanged && update.view.hasFocus) notebookSelected.value = null;
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
let unsubscribeFontScan: (() => void) | undefined;
let detachScrollSync: (() => void) | undefined;
let pageDisposed = false;

/** Editor spellcheck follows the workspace setting; dataRevision re-reads it. */
const spellcheckMode = computed(() => {
  void dataRevision.value;

  return store?.getSettings().spellcheck ?? "off";
});

/** Harper's dictionary and silenced lints; dataRevision re-reads both. */
const spellcheckWords = computed(() => {
  void dataRevision.value;

  return store?.getSettings().spellcheckWords ?? [];
});

const spellcheckIgnoredLints = computed(() => {
  void dataRevision.value;

  return store?.getSettings().spellcheckIgnoredLints ?? [];
});

/** The lint tooltip's "Add to dictionary" action writes through here. */
function addSpellcheckWord(word: string): void {
  const next = addDictionaryWord(store.getSettings().spellcheckWords, word);
  store.updateSettings({ spellcheckWords: next });
}

/** The lint tooltip's "Ignore" action writes through here. */
function ignoreSpellcheckLint(lint: IgnoredSpellcheckLint): void {
  const current = store.getSettings().spellcheckIgnoredLints;
  const next = addIgnoredLint(current, lint);
  if (next === current) return;

  store.updateSettings({ spellcheckIgnoredLints: next });
}

const aiEnabled = computed(() => {
  void dataRevision.value;

  return store.getAiSettings().enabled;
});

const chat = useChat();

/** Opens the chat pane seeded with this page (or the selection). */
async function askAi(): Promise<void> {
  if (!aiEnabled.value) {
    if (!window.confirm(t("chat.enableConfirm"))) return;

    store.updateSettings({ ai: { ...store.getAiSettings(), enabled: true } });
  }

  const selection = getSelection();
  await chat.seedChat({
    pageId: props.pageId,
    selection: selection?.text ?? null,
  });
}

const TEXT_PUSH_MS = 300;
let pendingText: { pageId: string; text: string } | undefined;
let textPushTimer: ReturnType<typeof setTimeout> | undefined;
/** Invalidates a setupPage run when the page changes mid-flight. */
let setupToken = 0;

function queueTextPush(pageId: string, value: string): void {
  pendingText = { pageId, text: value };
  if (textPushTimer) return;

  textPushTimer = setTimeout(() => void pushPendingText(), TEXT_PUSH_MS);
}

/** Writes pending editor text, resolving false when the store write failed. */
async function pushPendingText(): Promise<boolean> {
  if (textPushTimer) {
    clearTimeout(textPushTimer);
    textPushTimer = undefined;
  }

  const pending = pendingText;
  pendingText = undefined;
  if (!pending || !store) return true;

  try {
    await store.setPageText(pending.pageId, pending.text);

    return true;
  } catch (reason) {
    console.warn("[page] text save failed:", reason);

    return false;
  }
}

/** Flushes pending text and the store snapshot. False when either failed;
 *  pagehide and page-switch callers ignore it and let the next flush retry. */
async function flushText(): Promise<boolean> {
  let ok = await pushPendingText();
  if (store) {
    try {
      await store.flush();
    } catch (reason) {
      console.warn("[storage] flush failed:", reason);
      ok = false;
    }
  }

  return ok;
}

watch(
  () => props.pageId,
  async () => {
    await flushText();
    await setupPage();
  },
  { immediate: true },
);

async function setupPage() {
  const token = ++setupToken;
  const pageId = props.pageId;
  pageError.value = undefined;
  ready.value = false;

  const opened = await ensure();
  if (pageDisposed || token !== setupToken) return;

  if (!opened) {
    pageError.value = t("pageView.noWorkspace");
    return;
  }
  store = opened;

  const page = store.getPage(pageId);
  if (!page) {
    pageError.value = t("pageView.noPage", { id: pageId });
    return;
  }

  meta.value = page;
  personaCache.value = (await atproto.value?.ensurePersona()) ?? personaCache.value;
  if (pageDisposed || token !== setupToken) return;

  text.value = await store.loadPageText(pageId);
  if (pageDisposed || token !== setupToken) return;
  // The generated prelude (theme/fonts) is implicit; this is the user's own
  // prelude, appended on every compile.
  prelude.value = store.getSettings().pagePrelude ?? "";

  if (engineHealth.value.status === "failed") {
    // No wasm calls while failed. The text is loaded and the watchers from the
    // previous page go away so they cannot write this page's text into that
    // one; `handlePanic` rebinds the open page when the user retries.
    unsubscribeSave?.();
    unsubscribeSave = undefined;
    unsubscribeFontScan?.();
    unsubscribeFontScan = undefined;
    fileId.value = undefined;
    ready.value = false;

    return;
  }

  if (!typstState.value) {
    typstState.value = await useTypst();
    if (pageDisposed || token !== setupToken) return;
    requestService = createTypstRequestService(typstState.value, store);
    // The space context survives later createSourceId calls (see state.rs);
    // this one call is what gives pages their fonts/theme.
    await applyWorkspaceStyleToTypst(workspaceId.value, store, fontFamiliesInSource(text.value));
    if (pageDisposed || token !== setupToken) return;

    // Query JSON goes stale when pages/categories/settings change. Re-apply
    // fonts first (settings may have changed), purge the inserted files, then
    // recompile. Preview panes re-render off dataRevision on their own.
    unsubscribeStructure?.();
    unsubscribeStructure = store.onStructureChange(() => {
      void (async () => {
        if (engineHealth.value.status !== "ok") return;

        await applyWorkspaceStyleToTypst(
          workspaceId.value,
          store,
          fontFamiliesInSource(text.value),
        );
        requestService?.purge();
        // A prelude edit must recompile with the new text.
        prelude.value = store.getSettings().pagePrelude ?? "";
        editorPane.value?.recompile();
        cleanupScrollSync();
        meta.value = store.getPage(props.pageId);
      })();
    });
  }

  bindPage(pageId, page, token);
}

/** Binds the open page to the current wasm state: request service page, file
 *  id and source, save watchers, and readiness. `meta` and `text` must already
 *  describe `pageId`. Recovery calls this again after swapping in a fresh
 *  state, so a page opened while the engine was down gets its watchers too. */
function bindPage(pageId: string, page: PageMeta, token: number): void {
  const state = typstState.value;
  if (!store || !state) return;

  requestService?.setCurrentPage(pageId);
  syncNotebookController();

  fileId.value = state.createSourceId(page.path, workspaceId.value);
  state.insertSource(fileId.value, text.value);

  // Mirror a compilable entry for external tools (typst CLI, Tinymist):
  // `typst compile --root <sources> typbase/entries/<path>`.
  void mirrorPageProject(store, pageId, state).catch((cause) => {
    console.warn("[page] project mirror failed:", cause);
  });

  unsubscribeSave?.();
  unsubscribeSave = watch(text, (value) => {
    if (value !== store.getPageText(pageId)) queueTextPush(pageId, value);
  });

  unsubscribeFontScan?.();
  unsubscribeFontScan = watch(text, scanSourceFonts);

  unsubscribePage?.();
  void store
    .onPageDocChange(pageId, () => {
      // Our own saves echo back through this listener. Overwriting text.value
      // with the store's older content mid-typing reverted edits and could
      // clobber a later save. Only apply the echo when the editor is idle.
      if (editorPane.value?.view?.hasFocus) return;

      const current = store.getPageText(pageId);
      if (current !== text.value) text.value = current;
    })
    .then((stop) => {
      // The subscription promise can resolve after the page changed; release
      // it instead of leaking a dead listener.
      if (pageDisposed || token !== setupToken) stop();
      else unsubscribePage = stop;
    });

  ready.value = true;
  ensureSourceFonts();
}

/** Fonts named in the source load on demand, debounced while typing. */
const scannedFamilies = new Set<string>();
async function ensureSourceFonts(): Promise<void> {
  const state = typstState.value;
  // `recovering` is allowed: the fresh state is already in place by then.
  if (!state || engineHealth.value.status === "failed") return;

  const families = fontFamiliesInSource(text.value).filter(
    (family) => !scannedFamilies.has(family),
  );
  if (families.length === 0) return;

  for (const family of families) scannedFamilies.add(family);
  await ensureFontsInstalled(state, families).catch((cause) => {
    console.warn("[page] font install failed:", cause);
  });
}

const scanSourceFonts = useDebounceFn(() => void ensureSourceFonts(), 1200);

let heapTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  setEngineRetryHandler(() => handlePanic({ manual: true }));
  setSaveHandler(() => flushText());
  testApi.mode = () => props.modelValue;
  testApi.engineStatus = () => engineHealth.value.status;
  testApi.engineMemory = () => {
    try {
      return typstState.value?.memoryBytes() ?? 0;
    } catch {
      // A dead instance traps; the watchdog cannot read it either.
      return -1;
    }
  };
  testApi.crashEngine = () => {
    // `debugPanic` exists in debug wasm only; the cast keeps this compiling
    // against release typings too.
    const state = typstState.value as unknown as { debugPanic?: () => void } | undefined;
    state?.debugPanic?.();
  };

  // Backstop for idle tabs and for stretches with no compiles at all; the
  // per-compile check in `onEngineCompile` handles the busy case.
  heapTimer = setInterval(() => {
    const state = typstState.value;
    if (!state || engineHealth.value.status !== "ok") return;

    if (!heapEvicted && state.memoryBytes() > HEAP_WATERMARK) {
      heapEvicted = true;
      console.warn("[typst] wasm heap over watermark, evicting caches");
      state.evictCaches();
      compilesSinceEvict = 0;
    }
  }, HEAP_IDLE_MS);
});

onBeforeUnmount(() => {
  pageDisposed = true;
  setupToken += 1;
  setEngineRetryHandler(undefined);
  setSaveHandler(undefined);
  testApi.mode = null;
  testApi.engineStatus = null;
  testApi.engineMemory = null;
  testApi.crashEngine = null;
  if (heapTimer) clearInterval(heapTimer);
  cleanupScrollSync();
  unsubscribeSave?.();
  unsubscribePage?.();
  unsubscribeStructure?.();
  unsubscribeFontScan?.();
  scanSourceFonts.cancel();
  void flushText();
});

// Tab close or app switch: push the latest keystrokes and the snapshot now
// instead of waiting out the throttle and the store debounce.
useEventListener("pagehide", () => void flushText());
useEventListener(document, "visibilitychange", () => {
  if (document.hidden) void flushText();
});

function cleanupScrollSync() {
  detachScrollSync?.();
  detachScrollSync = undefined;
}

const editorPane = useTemplateRef("editorPane");
const previewPane = useTemplateRef("previewPane");

// Clicking a rendered item maps back to its source position. From read mode
// there is no visible editor, so switch to split first and reveal there.
function onPreviewJump(range: { from: number; to: number }) {
  if (props.modelValue === "read") {
    emit("update:modelValue", "split");
    void nextTick(() => editorPane.value?.revealRange(range.from, range.to));
    return;
  }

  editorPane.value?.revealRange(range.from, range.to);
}

// Search palette / generated-content reveal requests for this page. The
// palette can navigate here, so a request may arrive before the page is bound;
// wait for `ready` and check once on mount for requests that got here first.
watch(
  [revealRequests, ready],
  () => {
    if (!ready.value) return;

    const mine = revealRequests.value.find(
      (request) => request.pageId === props.pageId && !request.consumed,
    );
    if (!mine) return;

    mine.consumed = true;
    void nextTick(() => {
      editorPane.value?.revealRange(mine.from, mine.to);
    });
  },
  { immediate: true },
);

function getSelection(): { from: number; to: number; text: string } | null {
  const view = editorPane.value?.view;
  if (!view) return null;

  const { from, to } = view.state.selection.main;
  if (from === to) return null;

  return { from, to, text: view.state.sliceDoc(from, to) };
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

/** Picked blobs land at the cursor: images inline, everything else as a link. */
function insertAsset(asset: { hash: string; mime: string; reference: string }): void {
  const view = editorPane.value?.view;
  const position = view?.state.selection.main.head ?? 0;
  const extension = asset.reference.split(".").pop() ?? "asset";
  const insert = asset.mime.startsWith("image/")
    ? `#image("${asset.reference}")`
    : `#link("${asset.reference}")[${extension.toUpperCase()}]`;

  editorPane.value?.insertAt(position, insert);
  // The dialog restores focus to its trigger as it closes; take it back.
  void nextTick(() => view?.focus());
}

function onRequests(requests: unknown[], spaceId: string) {
  return requestService!.handler(requests as never, spaceId);
}

const editorRevision = () =>
  `${dataRevision.value}:${renderRevision.value}:${pluginsRevision.value}`;

// Plugin sources and plugin data are request-channel files; when they change
// the injected copies must go so the next compile re-requests them.
watch(pluginsRevision, () => {
  if (engineHealth.value.status !== "ok") return;

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

  // The top of the viewport can sit in a blank-line gap between frames; fall
  // back to the next frame, or the last one when past the end.
  let index = layout.ranges.findIndex(
    (range) => pos >= range.start && pos <= Math.max(range.start, range.end - 1),
  );
  if (index === -1) {
    index = layout.ranges.findIndex((range) => range.start >= pos);
    if (index === -1) index = layout.ranges.length - 1;
  }

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

const modes = computed<Array<{ id: ViewModeId; icon: MaterialSymbol; key: string }>>(() =>
  // Notebook mode belongs to notebook pages; `meta` refreshes on dataRevision,
  // so converting the open page updates the tabs in place.
  VIEW_MODES.filter((mode) => mode.id !== "notebook" || meta.value?.kind === "notebook").map(
    (mode) => ({
      id: mode.id,
      icon: mode.icon,
      key: `pageView.${mode.id}`,
    }),
  ),
);

const activeMode = computed(
  () => modes.value.find((mode) => mode.id === props.modelValue) ?? modes.value[0]!,
);

// Arrow keys move between view modes, per the tabs pattern.
function onModeKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const list = modes.value;
  const index = list.findIndex((mode) => mode.id === props.modelValue);
  const delta = event.key === "ArrowRight" ? 1 : -1;
  const next = list[(index + delta + list.length) % list.length];
  if (next) emit("update:modelValue", next.id);
}

/** The open page's kind flip; index.vue syncs the view mode to it. */
function convertPageKind(): void {
  const kind = meta.value?.kind === "notebook" ? "document" : "notebook";
  void store.updatePageKind(props.pageId, kind);
}
</script>

<template>
  <div class="page-view" ref="pageView">
    <div class="page-view__toolbar" data-tauri-drag-region="deep">
      <div class="page-view__toolbar-main">
        <div class="page-view__toolbar-main-left">
          <slot name="nav-toggle" />
          <UiTruncatedText class="page-view__title" :text="meta?.title ?? pageId" />
        </div>

        <AssetPicker
          v-if="!compact && modelValue !== 'read' && store"
          v-model:open="assetsOpen"
          :store="store"
          @select="insertAsset"
        >
          <UiIconButton
            icon="add_photo_alternate"
            :label="$t('assets.title')"
            :disabled="!ready"
            class="page-view__asset-toggle"
          />
        </AssetPicker>

        <UiIconButton
          v-if="!compact && modelValue !== 'read'"
          icon="text_format"
          :label="$t('formatting.title')"
          :pressed="formatOpen"
          class="page-view__format-toggle"
          @click="formatOpen = !formatOpen"
        />

        <UiIconButton
          v-if="store && aiEnabled"
          icon="forum"
          :label="$t('chat.ask')"
          :disabled="!ready"
          class="page-view__ai-toggle"
          @click="askAi"
        />

        <PublishButton v-if="store" :page-id="pageId" :store="store" />

        <ExportDialog
          v-if="store"
          v-model:open="exportOpen"
          :page-id="pageId"
          :store="store"
          :typst-state="typstState"
          :before-export="
            async () => {
              await flushText();
            }
          "
        />

        <PackageBrowser v-if="store" v-model:open="packagesOpen" :store="store" />

        <AssetPicker
          v-if="compact && modelValue !== 'read' && store"
          v-model:open="assetsOpen"
          :store="store"
          @select="insertAsset"
        />

        <div
          class="page-view__modes"
          role="tablist"
          :aria-label="$t('pageView.viewMode')"
          aria-orientation="horizontal"
          @keydown="onModeKeydown"
        >
          <UiTooltip
            v-for="mode in modes"
            :key="mode.id"
            :text="modelValue === mode.id ? '' : $t(mode.key)"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="modelValue === mode.id"
              :tabindex="modelValue === mode.id ? 0 : -1"
              :aria-label="$t(mode.key)"
              class="page-view__mode"
              :class="{ 'page-view__mode--active': modelValue === mode.id }"
              :disabled="!ready"
              @click="emit('update:modelValue', mode.id)"
            >
              <MsIcon :name="mode.icon" :size="18" />
              <span v-if="modelValue === mode.id" class="page-view__mode-label">
                {{ $t(mode.key) }}
              </span>
            </button>
          </UiTooltip>
        </div>

        <span class="page-view__modes-menu">
          <UiMenu align="end">
            <template #trigger>
              <UiIconButton
                :icon="activeMode.icon"
                :label="`${$t('pageView.viewMode')}: ${$t(activeMode.key)}`"
                :disabled="!ready"
              />
            </template>

            <DropdownMenuRadioGroup
              :model-value="modelValue"
              @update:model-value="(value) => emit('update:modelValue', value as ViewModeId)"
            >
              <DropdownMenuRadioItem
                v-for="mode in modes"
                :key="mode.id"
                :value="mode.id"
                class="menu__item page-view__mode-option"
              >
                <MsIcon :name="mode.icon" :size="18" />
                {{ $t(mode.key) }}
                <MsIcon
                  v-if="modelValue === mode.id"
                  name="check"
                  :size="16"
                  class="page-view__mode-check"
                />
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </UiMenu>
        </span>

        <UiMenu align="end">
          <template #trigger>
            <UiIconButton icon="more_vert" :label="$t('pageView.moreActions')" :disabled="!ready" />
          </template>

          <UiMenuItem icon="search" @select="showSearch">{{ $t("palette.title") }}</UiMenuItem>

          <UiMenuItem
            v-if="compact && modelValue !== 'read'"
            icon="text_format"
            @select="formatOpen = !formatOpen"
          >
            {{ $t("formatting.title") }}
            <MsIcon v-if="formatOpen" name="check" :size="16" class="page-view__menu-check" />
          </UiMenuItem>

          <UiMenuItem
            v-if="compact && modelValue !== 'read'"
            icon="add_photo_alternate"
            @select="assetsOpen = true"
          >
            {{ $t("assets.title") }}
          </UiMenuItem>

          <UiMenuItem
            :icon="meta?.kind === 'notebook' ? 'description' : 'view_agenda'"
            :disabled="!ready"
            @select="convertPageKind"
          >
            {{
              meta?.kind === "notebook"
                ? $t("common.convertToDocument")
                : $t("common.convertToNotebook")
            }}
          </UiMenuItem>

          <UiMenuItem icon="package_2" :disabled="degraded" @select="packagesOpen = true">
            {{ $t("packages.title") }}
          </UiMenuItem>

          <UiMenuItem icon="download" @select="exportOpen = true">
            {{ $t("exportPage.title") }}
          </UiMenuItem>
        </UiMenu>
      </div>
    </div>

    <NotebookToolbar
      v-if="modelValue === 'notebook' && store"
      :session="notebookSession"
      :selected="notebookSelected"
      :disabled="!ready || degraded"
      @run-cell="runNotebookCell"
      @run-all="runAllNotebook"
      @restart="restartNotebook"
      @clear-output="clearNotebookOutput"
      @add-cell="addNotebookCell"
    />

    <div v-if="modelValue !== 'read' && formatOpen" class="page-view__format">
      <EditToolbar :disabled="!ready" :view="editorPane?.view" />
      <UiIconButton
        icon="keyboard_arrow_up"
        :label="$t('formatting.collapse')"
        variant="ghost"
        class="page-view__format-collapse"
        @click="formatOpen = false"
      />
    </div>

    <div v-if="degraded" class="page-view__engine" role="status">
      <span class="page-view__engine-text">{{ $t("engine.failedBody") }}</span>
      <UiButton size="small" variant="ghost" @click="requestEngineRetry">
        {{ $t("engine.retry") }}
      </UiButton>
      <UiButton size="small" variant="ghost" @click="reloadApp">
        {{ $t("engine.reload") }}
      </UiButton>
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
        :notebook="modelValue === 'notebook' ? notebookController?.options : undefined"
        :degraded="degraded"
        :spellcheck="spellcheckMode"
        :spellcheck-words="spellcheckWords"
        :spellcheck-ignored-lints="spellcheckIgnoredLints"
        :on-add-spellcheck-word="addSpellcheckWord"
        :on-ignore-spellcheck-lint="ignoreSpellcheckLint"
        :typst-state="boundState"
        :on-requests="onRequests"
        :revision="editorRevision"
        :extensions="extraExtensions"
        :on-panic="() => handlePanic()"
        :on-compile="onEngineCompile"
        :on-navigate="(pageId) => emit('openPage', pageId)"
        :on-navigate-plugin="(instanceId) => emit('openPlugin', instanceId)"
        :on-asset-drop="handleAssetDrop"
      />

      <div v-if="modelValue === 'split'" class="page-view__handle" @pointerdown="startSplitDrag" />

      <PagedPreview
        v-if="boundFileId && !degraded"
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
        :on-panic="() => handlePanic()"
        :on-compile="onEngineCompile"
        @navigate="emit('openPage', $event)"
        @navigate-plugin="emit('openPlugin', $event)"
        @jump="onPreviewJump"
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
  /* Toolbar layout queries the pane, not the viewport, so expanding the
     sidebar collapses the toolbar the way a narrow window would. */
  container-type: inline-size;
  container-name: page-view;
}

.page-view__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.page-view__toolbar-main {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  flex: 1 1 auto;
}

.page-view__toolbar-main-left {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  flex: 1 1 0;
}

.page-view__title {
  min-width: 0;
  font-size: var(--text-2xl);
  font-weight: 600;
  margin-left: var(--space-2);
}

.page-view__modes-menu {
  display: none;
  flex: none;
}

/* Chevron pinned to the strip's right edge; matches the edit button size. */
.page-view__format :deep(.page-view__format-collapse) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-sm);
  height: var(--control-sm);
  flex: none;
  padding: 0;
  margin-left: auto;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.page-view__format :deep(.page-view__format-collapse:hover) {
  color: var(--color-text);
  background: var(--color-surface-2);
}

/* Full-width strip: the buttons ride inside it, left-aligned, scrolling
   sideways when they do not fit. */
.page-view__format {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1);
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

@container page-view (max-width: 48rem) {
  .page-view__toolbar-main {
    width: 100%;
  }

  .page-view__toolbar-main .page-view__modes {
    display: none;
  }

  .page-view__toolbar-main .page-view__modes-menu {
    display: inline-flex;
  }
}

.page-view__modes {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: var(--control-md);
  padding: var(--space-0-5);
  flex: none;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.page-view__mode {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: calc(2.1rem * var(--ui-size));
  height: 100%;
  padding: 0 var(--space-2);
  font-size: var(--text-md);
  line-height: var(--leading-none);
  font-family: inherit;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.page-view__mode .ms-icon {
  flex: none;
}

.page-view__mode:hover {
  color: var(--color-text);
}

.page-view__mode:disabled {
  opacity: 0.55;
  cursor: default;
}

.page-view__mode--active {
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.page-view__mode-label {
  /* Fixed slot: the strip keeps one width across modes, so switching view
     modes never shifts the action buttons to its left. */
  flex: none;
  min-width: calc(4.75rem * var(--ui-size));
  white-space: nowrap;
}

/* Mobile mode menu: the checked row gets the accent check mark. */
.page-view__mode-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.page-view__mode-check,
.page-view__menu-check {
  margin-left: auto;
  color: var(--color-accent);
}

.page-view__error {
  padding: var(--space-4);
  color: var(--color-danger);
}

.page-view__engine {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  color: var(--color-text);
  background: var(--color-danger-soft);
  border-bottom: 1px solid var(--color-border);
}

.page-view__engine-text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
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
  padding: 0 var(--space-6);
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
    padding: 0 var(--space-2);
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
