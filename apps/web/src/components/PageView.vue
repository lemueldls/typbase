<script setup lang="ts">
import type { FileId, FrameText, TypstState } from "@typbase/engine";
import type { PageTextChange, WorkspaceStore } from "@typbase/storage";
import type { IgnoredSpellcheckLint, PageMeta, SplitScrollMode } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

import { EditorSelection } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import {
  currentCell,
  deleteCell,
  duplicateCell,
  focusCell,
  insertCell,
  knownFrameHashes,
  mergeCell,
  moveCell,
  setCellType,
  splitCell,
  type NotebookLabels,
} from "@typbase/codemirror";
import { blobReference, sniffMime } from "@typbase/storage";

import {
  beginRecovery,
  canAutoRebuild,
  failEngine,
  HEAP_WATERMARK,
  noteCompileSuccess,
  noteTrap,
  requestEngineRetry,
  setEngineRetryHandler,
  useEngineHealth,
  type EngineFailure,
} from "~/lib/engineHealth";
import { SCRIPT_LABEL_KEYS } from "~/lib/fontPacks";
import { fontFamiliesInSource } from "~/lib/fonts";
import { matchesShortcut, shortcutLabel } from "~/lib/keybindings";
import {
  createNotebookController,
  createNotebookSession,
  type NotebookController,
} from "~/lib/notebook";
import { pageContextBinding } from "~/lib/pageContext";
import {
  DEFAULT_FIND_OPTIONS,
  findInPage,
  findInSource,
  isValidPattern,
  mergeFindHits,
  prepareFrameText,
  prepareSourceText,
  replacementFor,
  sourceHash,
  type FindHit,
  type FindOptions,
  type FindRect,
  type PreparedPage,
} from "~/lib/pageFind";
import { pluginsRevision } from "~/lib/plugins/registry";
import { presenceCursors, refreshPresence, type PresencePeer } from "~/lib/presenceCursor";
import { revealRequests } from "~/lib/reveal";
import { setSaveHandler } from "~/lib/saveRequest";
import { addDictionaryWord, addIgnoredLint } from "~/lib/spellcheckSettings";
import { testApi } from "~/lib/testApi";
import { applyCompletionData } from "~/lib/typstCompletions";
import { setTypstInputs } from "~/lib/typstInputs";
import { recreateTypstState, takeEngineFailure } from "~/lib/typstRecovery";
import { createTypstRequestService, type TypstRequestService } from "~/lib/typstRequests";
import { VIEW_MODES, type ViewModeId } from "~/lib/view";

const props = defineProps<{
  pageId: string;
  modelValue: ViewModeId;
  linksOpen: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", mode: ViewModeId): void;
  (e: "update:linksOpen", open: boolean): void;
  (e: "openPage", id: string): void;
  (e: "openPlugin", instanceId: string): void;
  (e: "openGraph"): void;
}>();

const { workspace, workspaceId, dataRevision, ensure, presence, atproto, atprotoStatus } =
  useWorkspace();
const { t } = useI18n();

const typstState = shallowRef<TypstState>();
const fileId = shallowRef<FileId>();

const engineHealth = useEngineHealth();
const degraded = computed(() => engineHealth.value.status === "failed");

/** Age out per-keystroke cache entries this often. */
const EVICT_AGED_EVERY = 50;
/** Idle sweep interval for the heap watchdog. */
const HEAP_IDLE_MS = 30_000;

let compilesSinceEvict = 0;
/** Wasm memory never shrinks, so the watermark can only fire once. */
let heapEvicted = false;

const boundState = computed(() => typstState.value as TypstState);
const boundFileId = computed(() => fileId.value as FileId);

/**
 * The open page's text. It mirrors the page doc: local editor transactions
 * become Loro text splices, remote deltas are applied to the view and land
 * here, and no path writes this ref back as a whole document.
 */
const text = ref("");
const prelude = ref("");
const meta = shallowRef<PageMeta>();
const pageError = ref<string>();
const ready = ref(false);

/** Scripts the installed faces cannot draw, from the last coverage scan. */
const missingScripts = ref<string[]>([]);
const fontPackDialogOpen = ref(false);
const fontNoticeDismissed = ref(false);
const missingScriptLabel = computed(() =>
  missingScripts.value
    .map((code) => {
      const key = SCRIPT_LABEL_KEYS[code];

      return key ? t(key) : code;
    })
    .join(", "),
);

const formatOpen = useLocalStorage("typbase:formatToolbar", true);
const linksOpen = computed({
  get: () => props.linksOpen,
  set: (open: boolean) => emit("update:linksOpen", open),
});
const assetsOpen = ref(false);
const exportOpen = ref(false);
const publishOpen = ref(false);

// The toolbar drops its action buttons into the overflow menu when the pane is
// narrow. Observed on the pane, not a viewport media query: expanding the
// sidebar narrows the pane without changing the window.
const pageView = useTemplateRef("pageView");
const paneWidth = ref(typeof window === "undefined" ? 1024 : window.innerWidth);
useResizeObserver(pageView, (entries) => {
  const entry = entries[0];
  if (entry) paneWidth.value = entry.contentRect.width;
});
/**
 * Matches the page-view container query (56rem), so the buttons that move
 * into the page menu disappear in the same step as the mode tabs.
 */
const compact = computed(() => paneWidth.value > 0 && paneWidth.value <= 896);
const coarsePointer = useMediaQuery("(hover: none) and (pointer: coarse)");

function onKeydown(event: KeyboardEvent): void {
  if (!matchesShortcut(event, "export")) return;

  event.preventDefault();
  if (event.repeat) return;

  exportOpen.value = true;
}

useEventListener("keydown", onKeydown, { capture: true });

function onFindKeydown(event: KeyboardEvent): void {
  if (!matchesShortcut(event, "pageFind")) return;

  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  openFind();
}

useEventListener("keydown", onFindKeydown, { capture: true });

const notebookSession = createNotebookSession();
const notebookController = shallowRef<NotebookController>();

const notebookLabels = computed<NotebookLabels>(() => ({
  code: t("notebook.code"),
  prose: t("notebook.prose"),
  log: t("notebook.log"),
  hidden: t("notebook.hidden"),
  cellType: t("notebook.cellType"),
  menu: t("notebook.menu"),
  split: t("notebook.split"),
  merge: t("notebook.merge"),
  moveUp: t("notebook.moveUp"),
  moveDown: t("notebook.moveDown"),
  duplicate: t("notebook.duplicate"),
  remove: t("notebook.remove"),
  copy: t("notebook.copy"),
  hold: t("notebook.hold"),
  release: t("notebook.release"),
  clearOutput: t("notebook.clearOutput"),
  toggleSource: t("notebook.toggleSource"),
  noOutput: t("notebook.noOutput"),
  held: t("notebook.held"),
}));

function notebookView(): EditorView | undefined {
  return editorPane.value?.view;
}

/** The cell's body text, for a copy action. */
function cellText(index: number): string {
  const view = notebookView();
  const cell = notebookSession.cells[index];
  if (!view || !cell) return "";

  return view.state.doc.sliceString(cell.content_start, cell.content_end);
}

/**
 * One handler for every cell command, because the rail's menu, the toolbar and
 * the keyboard all dispatch the same names. A command that is a text edit goes
 * through the package's own dispatch, so it lands on the undo stack. The rest
 * change session state and ask for a re-decoration.
 */
function runNotebookCommand(command: string, index: number): void {
  const view = notebookView();
  const session = notebookSession;

  switch (command) {
    case "toggleSource":
      session.collapsed[index] = !(session.collapsed[index] ?? false);
      break;
    case "split":
      if (view) splitCell(view, index);
      break;
    case "merge":
      if (view) mergeCell(view, index);
      break;
    case "moveUp":
      if (view) moveCell(view, -1, index);
      break;
    case "moveDown":
      if (view) moveCell(view, 1, index);
      break;
    case "hold":
      session.held[index] = true;
      break;
    case "release":
      delete session.held[index];
      delete session.frozen[index];
      break;
    case "clearOutput":
      delete session.frozen[index];
      break;
    case "duplicate":
      if (view) duplicateCell(view, index);
      break;
    case "copy":
      void navigator.clipboard?.writeText(cellText(index));
      break;
    case "remove":
      if (view) deleteCell(view, index);
      break;
    default:
      return;
  }

  notebookController.value?.refresh(view);
}

function syncNotebookController(): void {
  const state = typstState.value;
  if (!state || !store) return;

  notebookController.value = createNotebookController({
    typstState: state,
    fileId: () => boundFileId.value,
    session: notebookSession,
    labels: notebookLabels.value,
    readOnly: () => props.modelValue === "read",
    onCommand: runNotebookCommand,
    onSetType: (index, type) => {
      const view = notebookView();
      if (view) setCellType(view, index, type);
    },
  });
}

function addNotebookCell(): void {
  const view = notebookView();
  if (view) insertCell(view, "prose");
}

function releaseAllNotebook(): void {
  notebookController.value?.releaseAll(notebookView());
}

// Bumped when a wasm panic forces a brand-new TypstState. Children keyed on
// this remount, so the editor plugin and preview bind to the fresh instance.
const stateGeneration = ref(0);

/**
 * Whether to show the loading placeholder. Held back for a moment because a
 * page switch against an already-warm engine binds in well under a frame or
 * two, and a placeholder that appears and vanishes that fast reads as a flicker
 * rather than as progress.
 */
const showEditorLoading = ref(false);
let editorLoadingTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Whether the editor fades in when it replaces the placeholder. Armed only
 * while the placeholder is up, so the first bind animates and a later page
 * switch, which never shows a placeholder, does not.
 */
const animateEditor = ref(false);

watch(showEditorLoading, (showing) => {
  if (showing) animateEditor.value = true;
});

watch(
  boundFileId,
  (id) => {
    clearTimeout(editorLoadingTimer);
    if (id) {
      showEditorLoading.value = false;

      return;
    }

    editorLoadingTimer = setTimeout(() => {
      showEditorLoading.value = true;
    }, 200);
  },
  { immediate: true },
);

onBeforeUnmount(() => clearTimeout(editorLoadingTimer));
let recovering = false;

/**
 * One automatic rebuild per failure burst, and only for an out-of-memory
 * abort: the OOM trace lands in the memoized call body where comemo has no
 * lock, so the same module instance is safe to rebuild. Anything else goes
 * straight to `failed`, because a lock left behind at abort time would hang the next
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
    // The current request service still points at the dead instance.
    requestService = createTypstRequestService(fresh, store);
    await applyWorkspaceStyleToTypst(
      workspaceId.value,
      store,
      fontFamiliesInSource(`${text.value}\n${prelude.value}`),
    );
    if (pageDisposed) return;

    // Every held cell shows the last output, which still belongs to the dead
    // instance's render. Release them so the fresh state repaints.
    notebookSession.held = {};
    notebookSession.frozen = {};
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
// list. The EditablePane remounts per page id so the closure stays honest.
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
let boundPageId: string | undefined;
let requestService: TypstRequestService | undefined;
let unsubscribePageText: (() => void) | undefined;
let unsubscribeStructure: (() => void) | undefined;
let unsubscribeFontScan: (() => void) | undefined;
let detachScrollSync: (() => void) | undefined;
let pageDisposed = false;

/** Editor spellcheck follows the workspace setting. */
const spellcheckMode = useWorkspaceValue(
  workspace,
  ["settings"],
  (value) => value.getSettings().spellcheck ?? "off",
  "off",
);

/** Harper's dictionary and silenced lints. */
const spellcheckWords = useWorkspaceValue(
  workspace,
  ["settings"],
  (value) => value.getSettings().spellcheckWords ?? [],
  [],
);

const spellcheckIgnoredLints = useWorkspaceValue(
  workspace,
  ["settings"],
  (value) => value.getSettings().spellcheckIgnoredLints ?? [],
  [],
);

/**
 * Opaque workspace ids are source values, not prose. Harper marks them as
 * spelling mistakes inside `#typbase` calls unless its lints on these exact
 * spans are dropped.
 */
const spellcheckIgnoreIds = useWorkspaceValue(
  workspace,
  ["pages", "categories", "instances"],
  (value) => [
    ...value.listPages().map((page) => page.id),
    ...value.listCategories().map((category) => category.id),
    ...value.listPluginInstances().map((instance) => instance.id),
  ],
  [],
);

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

/** Editor display options follow the workspace setting. */
const editorDisplay = useWorkspaceValue(
  workspace,
  ["settings"],
  (value) => value.getSettings().editor,
  undefined,
);

const aiEnabled = useWorkspaceValue(
  workspace,
  ["settings"],
  (value) => value.getAiSettings().enabled,
  false,
);

const chat = useChat();
const { confirm } = useConfirm();

/** Opens the chat pane seeded with this page (or the selection). */
async function askAi(): Promise<void> {
  if (!aiEnabled.value) {
    const enable = await confirm({
      title: t("chat.enableTitle"),
      description: t("chat.enableConfirm"),
      confirmLabel: t("common.enable"),
      danger: false,
    });
    if (!enable) return;

    store.updateSettings({ ai: { ...store.getAiSettings(), enabled: true } });
  }

  const selection = getSelection();
  await chat.seedChat({
    pageId: props.pageId,
    selection: selection?.text ?? null,
  });
}

/** Invalidates a setupPage run when the page changes mid-flight. */
let setupToken = 0;

/**
 * Flushes the store snapshot. Editor changes are already in the page doc as
 * Loro text operations, so there is no pending string to push first.
 */
async function flushText(): Promise<boolean> {
  if (!store) return true;

  try {
    await store.flush();

    return true;
  } catch (reason) {
    console.warn("[storage] flush failed:", reason);

    return false;
  }
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
  boundPageId = undefined;

  // The previous page's listener must not write its text into this one while
  // the new page loads.
  unsubscribePageText?.();
  unsubscribePageText = undefined;

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
  // The generated prelude (theme/fonts) is implicit. This is the page's
  // `note` binding plus the user's own prelude, appended on every
  // compile.
  prelude.value = [pageContextBinding(store, pageId), store.getSettings().pagePrelude ?? ""]
    .filter(Boolean)
    .join("\n");

  if (engineHealth.value.status === "failed") {
    unsubscribeFontScan?.();
    unsubscribeFontScan = undefined;
    bindSourceOnlyPage(pageId, token);

    return;
  }

  if (!typstState.value) {
    typstState.value = await useTypst();
    if (pageDisposed || token !== setupToken) return;
    requestService = createTypstRequestService(typstState.value, store);
    // The space context survives later createSourceId calls (see state.rs).
    // this one call is what gives pages their fonts/theme.
    await applyWorkspaceStyleToTypst(
      workspaceId.value,
      store,
      fontFamiliesInSource(`${text.value}\n${prelude.value}`),
    );
    if (pageDisposed || token !== setupToken) return;

    // Query JSON goes stale when pages/categories/settings change. Re-apply
    // fonts first (settings may have changed), purge the inserted files, then
    // recompile. Preview panes re-render off dataRevision on their own.
    unsubscribeStructure?.();
    unsubscribeStructure = store.onStructureChange(() => {
      void (async () => {
        if (engineHealth.value.status !== "ok") return;

        const state = typstState.value;
        if (state) applyCompletionData(state, store);

        // A prelude edit must recompile with the new text. The page context
        // moved with it, so the daily neighbors stay current.
        const nextPrelude = [
          pageContextBinding(store, props.pageId),
          store.getSettings().pagePrelude ?? "",
        ]
          .filter(Boolean)
          .join("\n");
        prelude.value = nextPrelude;
        await applyWorkspaceStyleToTypst(
          workspaceId.value,
          store,
          fontFamiliesInSource(`${text.value}\n${nextPrelude}`),
        );
        requestService?.purge();
        void ensureSourceFonts();
        editorPane.value?.recompile();
        meta.value = store.getPage(props.pageId);
      })();
    });
  }

  bindPage(pageId, page, token);
}

/**
 * Binds an open page without a wasm state. The source editor, save path, and
 * remote text listener still work; previews, diagnostics, and completions stay
 * off until Retry rebuilds the engine.
 */
function bindSourceOnlyPage(pageId: string, token: number): void {
  boundPageId = pageId;
  fontNoticeDismissed.value = false;
  fileId.value = undefined;
  notebookController.value = undefined;
  missingScripts.value = [];
  unsubscribeFontScan?.();
  unsubscribeFontScan = undefined;
  subscribePageText(pageId, token);
  ready.value = true;
}

/** Mirrors page-doc changes into the open editor. Works with or without wasm. */
function subscribePageText(pageId: string, token: number): void {
  const currentStore = store;
  if (!currentStore) return;

  unsubscribePageText?.();
  void currentStore
    .onPageTextChange(pageId, (event) => {
      // The editor's own splices are already in its buffer and its update
      // listener already refreshed `text`. Skip the full-document read.
      if (event.origin === "editor") return;

      const nextText = currentStore.getPageText(pageId);
      // A full-text fallback write can echo back text the editor already has.
      // Applying its delta again would duplicate the edit.
      if (nextText === text.value) return;

      // Every other change, including a peer's edit and a local writer like a
      // plugin or the source mirror, arrived as a delta from the doc and is
      // applied to the open view. The doc is the source of truth: never
      // replace it from the buffer, or an unseen remote edit gets deleted on
      // the next save.
      try {
        editorPane.value?.applyTextDelta(event.delta);
      } catch (reason) {
        // A failed delta leaves the buffer stale. The text ref below makes
        // the full-text catch-up replace it.
        console.warn("[page] text delta failed:", reason);
      }

      if (nextText !== text.value) text.value = nextText;
    })
    .then((stop) => {
      // The subscription promise can resolve after the page changed. Release
      // it instead of leaking a dead listener.
      if (pageDisposed || token !== setupToken) {
        stop();

        return;
      }

      unsubscribePageText = stop;
      // Catch a change that landed between the text read and this listener.
      const nextText = currentStore.getPageText(pageId);
      if (nextText !== text.value) text.value = nextText;
    });
}

/**
 * Binds the open page to the current wasm state: request service page, file
 * id and source, text listener, and readiness. `meta` and `text` must already
 * describe `pageId`. Recovery calls this again after swapping in a fresh
 * state, so a page opened while the engine was down gets its listener too.
 */
function bindPage(pageId: string, page: PageMeta, token: number): void {
  const state = typstState.value;
  if (!store || !state) return;

  applyCompletionData(state, store);
  boundPageId = pageId;
  requestService?.setCurrentPage(pageId);
  fontNoticeDismissed.value = false;
  setTypstInputs(state, {
    pageId,
    workspaceId: workspaceId.value,
    reason: "editor",
    target: "paged",
  });
  syncNotebookController();

  fileId.value = state.createSourceId(page.path, workspaceId.value);
  // Recovery can rebind a page whose text changed while the engine was down.
  const current = store.getPageText(pageId);
  if (current !== text.value) text.value = current;
  state.insertSource(fileId.value, text.value);

  unsubscribeFontScan?.();
  unsubscribeFontScan = watch(text, scanSourceFonts);

  subscribePageText(pageId, token);

  ready.value = true;
  ensureSourceFonts();
}

/**
 * Writes one editor transaction to the page doc as Loro text splices. Falling
 * back to a full-text write only happens when the doc is not open, which the
 * editor path guarantees is not the normal case.
 */
function applyLocalTextChanges(changes: PageTextChange[]): void {
  const pageId = boundPageId;
  if (!store || !pageId) return;
  if (store.applyPageTextChanges(pageId, changes)) return;

  const view = editorPane.value?.view;
  if (!view) return;
  console.warn("[page] page doc was not open; saving the full text instead");
  void store.setPageText(pageId, view.state.doc.toString());
}

/** Fonts named in the source load on demand, debounced while typing. */
const scannedFamilies = new Set<string>();
async function ensureSourceFonts(): Promise<void> {
  const state = typstState.value;
  // `recovering` is allowed: the fresh state is already in place by then.
  if (!state || engineHealth.value.status === "failed") return;

  const families = fontFamiliesInSource(`${text.value}\n${prelude.value}`).filter(
    (family) => !scannedFamilies.has(family),
  );
  if (families.length > 0) {
    for (const family of families) scannedFamilies.add(family);
    await ensureFontsInstalled(state, families).catch((cause) => {
      console.warn("[page] font install failed:", cause);
    });
  }

  refreshMissingScripts(state);
}

/** Rechecks coverage after a font or text change, without reading the docs. */
function refreshMissingScripts(state = typstState.value): void {
  if (!state || engineHealth.value.status === "failed") {
    missingScripts.value = [];

    return;
  }

  // The prelude carries the page context (title, category, tags), so a CJK
  // title needs the same font as a CJK body.
  const next = state.uncoveredScripts(`${text.value}\n${prelude.value}`);
  if (next.join("\u0000") === missingScripts.value.join("\u0000")) return;

  missingScripts.value = next;
  fontNoticeDismissed.value = false;
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
      // A dead instance traps. The watchdog cannot read it either.
      return -1;
    }
  };
  testApi.crashEngine = () => {
    // `debugPanic` exists in debug wasm only. The cast keeps this compiling
    // against release typings too.
    const state = typstState.value as unknown as { debugPanic?: () => void } | undefined;
    state?.debugPanic?.();
  };

  // Backstop for idle tabs and for stretches with no compiles at all. The
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
  boundPageId = undefined;
  setFindText(false);
  setEngineRetryHandler(undefined);
  setSaveHandler(undefined);
  testApi.mode = null;
  testApi.engineStatus = null;
  testApi.engineMemory = null;
  testApi.crashEngine = null;
  if (heapTimer) clearInterval(heapTimer);
  cleanupScrollSync();
  unsubscribePageText?.();
  unsubscribeStructure?.();
  unsubscribeFontScan?.();
  scanSourceFonts.cancel();
  // Query JSON and embedded sources live in the shared wasm world. Without
  // this purge the next workspace can compile the previous workspace's
  // `#typbase.query("pages")` file before the request channel sees it.
  requestService?.purge();
  requestService = undefined;
  void flushText();
});

// Tab close or app switch: push the latest keystrokes and the snapshot now
// instead of waiting out the throttle and the store debounce.
useEventListener("pagehide", () => void flushText());
useEventListener(document, "visibilitychange", () => {
  if (document.hidden) void flushText();
});
// A font or image arrived from the space. The settings did not change, so
// nothing else would drop the cached fallback and recompile the page.
useAssetDownloads(() => {
  if (pageDisposed || !store || !typstState.value || engineHealth.value.status !== "ok") return;
  void applyWorkspaceStyleToTypst(workspaceId.value, store, fontFamiliesInSource(text.value))
    .then(() => {
      if (pageDisposed) return;
      requestService?.purge();
      editorPane.value?.recompile();
    })
    .catch(() => {
      // The editor's normal compile path reports the failure.
    });
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
// palette can navigate here, so a request may arrive before the page is bound.
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
      revealInPage(mine.from, mine.to);
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
  // The dialog restores focus to its trigger as it closes, so take it back.
  void nextTick(() => view?.focus());
}

function onRequests(requests: unknown[], spaceId: string) {
  return requestService!.handler(requests as never, spaceId);
}

const editorRevision = () =>
  `${dataRevision.value}:${renderRevision.value}:${pluginsRevision.value}`;

// Plugin sources and plugin data are request-channel files. When they change
// the injected copies must go so the next compile re-requests them.
watch(pluginsRevision, () => {
  if (engineHealth.value.status !== "ok") return;

  requestService?.purge();
  editorPane.value?.recompile();
});

// Template bindings unwrap refs (":text=\"text\"" passes the string). The
// editor/preview need the ref objects themselves, and v-bind spread keeps them.
const sharedState = computed(() => ({ text, prelude }));

const findOpen = ref(false);
const findQuery = ref("");
const findReplacement = ref("");
const findActive = ref(0);
const findOptions = ref<FindOptions>({ ...DEFAULT_FIND_OPTIONS });
const findFrames = shallowRef<FrameText | null>(null);
const findBar = useTemplateRef("findBar");
/** A read-mode reveal that arrived before the preview mounted. */
const pendingPageReveal = ref<{ from: number; to: number } | null>(null);
const pendingFindMark = shallowRef<{ frameIndex: number; rects: FindRect[] } | null>(null);
let findRenderPending = false;

const currentFindHash = computed(() => sourceHash(sharedState.value.text.value));
const preparedSource = computed(() => prepareSourceText(sharedState.value.text.value));

const preparedFind = computed<PreparedPage>(() =>
  findFrames.value?.source_hash === currentFindHash.value
    ? prepareFrameText(findFrames.value)
    : prepareFrameText(null),
);

const findMatches = computed<FindHit[]>(() => {
  const value = findQuery.value.trim();
  if (!value) return [];

  const sourceHits = findInSource(
    preparedFind.value,
    preparedSource.value,
    value,
    findOptions.value,
  );

  if (findFrames.value?.source_hash !== currentFindHash.value) return sourceHits;

  return mergeFindHits(sourceHits, findInPage(preparedFind.value, value, findOptions.value));
});

const findFrameMarks = computed(() =>
  findMatches.value.flatMap((hit, index) =>
    hit.marks.map((mark) => ({
      frameIndex: mark.frameIndex,
      range: mark.range,
      rects: mark.rects,
      active: index === findActive.value,
    })),
  ),
);

const findSourceRanges = computed(() =>
  findMatches.value.flatMap((hit, index) =>
    hit.source ? [{ ...hit.source, active: index === findActive.value }] : [],
  ),
);

const findReplaceCount = computed(
  () => findMatches.value.filter((hit) => hit.source !== null).length,
);
const findCanReplace = computed(() => Boolean(findMatches.value[findActive.value]?.source));
const findInvalid = computed(() => !isValidPattern(findQuery.value.trim(), findOptions.value));

function readFindFrames(): FrameText | null {
  if (!typstState.value || !fileId.value || degraded.value) return null;

  try {
    return typstState.value.frameText(boundFileId.value);
  } catch (error) {
    console.error("[typst] frame text failed:", error);

    return null;
  }
}

function adoptFindFrames(frames: FrameText | null): void {
  findFrames.value = frames;
}

/** True when the cached index matches the live source and the last layout. */
function findFramesMatchLayout(): boolean {
  const cached = findFrames.value;
  if (!cached || cached.source_hash !== currentFindHash.value) return false;

  if (!typstState.value || !fileId.value) return false;

  try {
    return typstState.value.frameTextHash(boundFileId.value) === cached.layout_hash;
  } catch (error) {
    console.error("[typst] frame text hash failed:", error);

    return false;
  }
}

/** Called after a paged compile, so the index matches the frames on screen. */
function onPagedCompile(): void {
  if (!findOpen.value || findFramesMatchLayout()) return;

  adoptFindFrames(readFindFrames());
}

/** Reuses the last paged index when it belongs to the live source and layout. */
function syncFindFrames(): void {
  if (findFramesMatchLayout()) return;

  const frames = readFindFrames();
  adoptFindFrames(frames?.source_hash === currentFindHash.value ? frames : null);
}

function setFindText(enabled: boolean): void {
  if (!typstState.value || !fileId.value) return;

  try {
    typstState.value.setFindText(boundFileId.value, enabled);
  } catch (error) {
    console.error("[typst] find text toggle failed:", error);
  }
}

/** Makes the frame index current, rendering one when the mode has none. */
function activatePageFind(): void {
  if (degraded.value) {
    findFrames.value = null;
    return;
  }

  setFindText(true);
  syncFindFrames();
  if (!findFrames.value) void ensureFindFrames();
}

/**
 * Rendered search needs the layout's text index. Read, write, and split
 * compile paged frames and refresh it. Source mode has no paged preview, so a
 * find that wants rendered text renders one here.
 */
async function ensureFindFrames(): Promise<void> {
  if (findRenderPending || !typstState.value || !fileId.value || !ready.value || degraded.value) {
    return;
  }

  if (findFrames.value?.source_hash === currentFindHash.value) return;

  const state = typstState.value;
  const id = boundFileId.value;
  const source = sharedState.value.text.value;
  const documentPrelude = sharedState.value.prelude.value;

  findRenderPending = true;
  try {
    let result = state.compilePaged(
      id,
      source,
      documentPrelude,
      undefined,
      false,
      knownFrameHashes(),
    );

    if (result.requests.length > 0) {
      const updated = await onRequests(result.requests, workspaceId.value);
      if (updated && typstState.value === state) {
        result = state.compilePaged(
          id,
          source,
          documentPrelude,
          undefined,
          false,
          knownFrameHashes(),
        );
      }
    }

    adoptFindFrames(findOpen.value ? readFindFrames() : null);
  } catch (error) {
    console.error("[typst] find render failed:", error);
    adoptFindFrames(null);
    void handlePanic();
  } finally {
    findRenderPending = false;
  }
}

const refreshFindDebounced = useDebounceFn(() => {
  if (findOpen.value) void ensureFindFrames();
}, 250);

function openFind(): void {
  if (!findOpen.value) {
    findActive.value = 0;
    findOpen.value = true;
  }

  activatePageFind();
  void nextTick(() => findBar.value?.focus());
}

/** Toolbar and menu toggle; the chord only opens and refocuses. */
function toggleFind(): void {
  if (findOpen.value) closeFind();
  else openFind();
}

function closeFind(): void {
  findOpen.value = false;
  findQuery.value = "";
  findActive.value = 0;
  findFrames.value = null;
  pendingFindMark.value = null;
  setFindText(false);

  if (props.modelValue === "read") previewPane.value?.scroller?.focus();
  else editorPane.value?.view?.focus();
}

/**
 * Scrolls a pane to a source range. `focusEditor` false keeps the caret in the
 * find input while the selection moves behind it.
 */
function revealInPage(from: number, to: number, focusEditor = true): void {
  if (props.modelValue === "read") {
    if (!previewPane.value) {
      pendingPageReveal.value = { from, to };

      return;
    }

    previewPane.value.revealRange(from, to);

    return;
  }

  editorPane.value?.revealRange(from, to, focusEditor);
}

watch(previewPane, (pane) => {
  const pending = pendingPageReveal.value;
  if (!pane || !pending) return;

  pendingPageReveal.value = null;
  pane.revealRange(pending.from, pending.to);
});

watch(previewPane, (pane) => {
  const pending = pendingFindMark.value;
  if (!pane || !pending) return;

  pendingFindMark.value = null;
  pane.revealMark(pending.frameIndex, pending.rects);
});

function revealActiveMatch(): void {
  const hit = findMatches.value[findActive.value];
  if (!hit) return;

  const mark = hit.marks[0];

  if (props.modelValue === "read") {
    if (mark && previewPane.value) previewPane.value.revealMark(mark.frameIndex, mark.rects);
    else if (mark) pendingFindMark.value = { frameIndex: mark.frameIndex, rects: mark.rects };
    else if (hit.source) revealInPage(hit.source.from, hit.source.to, false);

    return;
  }

  const target = hit.source ?? mark?.range ?? null;
  if (target) editorPane.value?.revealRange(target.from, target.to, false);

  if (props.modelValue === "split" && mark) {
    previewPane.value?.revealMark(mark.frameIndex, mark.rects);
  }
}

function nextFindMatch(): void {
  const count = findMatches.value.length;
  if (!count) return;

  findActive.value = (findActive.value + 1) % count;
  revealActiveMatch();
}

function prevFindMatch(): void {
  const count = findMatches.value.length;
  if (!count) return;

  findActive.value = (findActive.value - 1 + count) % count;
  revealActiveMatch();
}

function replacementText(hit: FindHit, source: string): string {
  return replacementFor(
    source,
    hit,
    findQuery.value.trim(),
    findReplacement.value,
    findOptions.value,
  );
}

function replaceCurrent(): void {
  const hit = findMatches.value[findActive.value];
  const view = editorPane.value?.view;
  if (!hit?.source || !view) return;

  const source = sharedState.value.text.value;
  const index = findActive.value;
  view.dispatch({
    changes: {
      from: hit.source.from,
      to: hit.source.to,
      insert: replacementText(hit, source),
    },
  });

  void nextTick(() => {
    const count = findMatches.value.length;
    findActive.value = count ? Math.min(index, count - 1) : 0;
    revealActiveMatch();
  });
}

function replaceAllMatches(): void {
  const view = editorPane.value?.view;
  if (!view) return;

  const source = sharedState.value.text.value;
  const changes = findMatches.value
    .flatMap((hit) =>
      hit.source
        ? [
            {
              from: hit.source.from,
              to: hit.source.to,
              insert: replacementText(hit, source),
            },
          ]
        : [],
    )
    .sort((left, right) => right.from - left.from);

  if (changes.length === 0) return;

  view.dispatch({ changes });
  findActive.value = 0;
  void nextTick(() => revealActiveMatch());
}

function selectAllMatches(): void {
  const view = editorPane.value?.view;
  const ranges = findMatches.value.flatMap((hit) =>
    hit.source ? [EditorSelection.range(hit.source.from, hit.source.to)] : [],
  );

  if (!view || ranges.length === 0) return;

  view.dispatch({ selection: EditorSelection.create(ranges) });
  view.focus();
}

watch(findQuery, () => {
  findActive.value = 0;
});

watch(
  findOptions,
  () => {
    findActive.value = 0;
    if (findBar.value?.hasFocus()) revealActiveMatch();
  },
  { deep: true },
);

watch(degraded, (isDegraded) => {
  if (isDegraded) {
    findFrames.value = null;
    return;
  }

  if (findOpen.value) activatePageFind();
});

watch(findMatches, (matches) => {
  if (!matches.length) {
    findActive.value = 0;

    return;
  }

  if (findActive.value >= matches.length) findActive.value = 0;
  // Editing with the bar open must not pull the caret to a match, so only a
  // focused bar moves the selection as the list changes.
  if (findBar.value?.hasFocus()) revealActiveMatch();
});

watch(findOpen, (open) => {
  if (open) activatePageFind();
});

watch(
  () => sharedState.value.text.value,
  () => {
    if (findOpen.value) void refreshFindDebounced();
  },
);

// The bar survives a mode switch. Show the active match in whichever pane now
// owns the page.
watch(
  () => props.modelValue,
  () => {
    if (!findOpen.value) return;

    pendingFindMark.value = null;
    activatePageFind();
    revealActiveMatch();
  },
);

watch(
  () => props.pageId,
  () => {
    pendingPageReveal.value = null;
    pendingFindMark.value = null;
    if (findOpen.value) closeFind();
  },
);

watch(ready, (isReady) => {
  if (isReady && findOpen.value) activatePageFind();
});

// A rebuilt engine starts with the find index off. Turn it back on for the
// open bar.
watch(typstState, () => {
  if (findOpen.value) activatePageFind();
});

// System fonts or a language pack were installed, so the typeface set changed
// under the docs.
watch(renderRevision, () => {
  editorPane.value?.recompile();
  refreshMissingScripts();
});

/** Which pane follows the other in split view. */
function splitScrollMode(): SplitScrollMode {
  return editorDisplay.value?.splitScroll ?? "both";
}

const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

interface ScrollFollow {
  target: number;
  written: number;
  frame: number;
}

const scrollFollows = new WeakMap<HTMLElement, ScrollFollow>();
/** Fraction of the remaining distance covered per frame. */
const SCROLL_FOLLOW_EASE = 0.3;
/** Stop within half a pixel so every follow settles. */
const SCROLL_FOLLOW_SNAP = 0.5;

function stopScrollFollow(element: HTMLElement): void {
  const follow = scrollFollows.get(element);
  if (!follow) return;

  cancelAnimationFrame(follow.frame);
  scrollFollows.delete(element);
}

function stepScrollFollow(element: HTMLElement): void {
  const follow = scrollFollows.get(element);
  if (!follow) return;

  const current = element.scrollTop;
  // A position the animation did not write means the pointer took over.
  if (Math.abs(current - follow.written) > 1) {
    scrollFollows.delete(element);

    return;
  }

  const delta = follow.target - current;
  if (Math.abs(delta) <= SCROLL_FOLLOW_SNAP) {
    element.scrollTop = follow.target;
    follow.written = element.scrollTop;
    follow.frame = 0;

    return;
  }

  element.scrollTop = current + delta * SCROLL_FOLLOW_EASE;
  follow.written = element.scrollTop;
  follow.frame = requestAnimationFrame(() => stepScrollFollow(element));
}

/** Ease a pane to `top`. A new target retargets the run instead of restarting it. */
function followScroll(element: HTMLElement, top: number): void {
  const max = Math.max(0, element.scrollHeight - element.clientHeight);
  const target = Math.max(0, Math.min(top, max));

  if (reduceMotion.value) {
    stopScrollFollow(element);
    element.scrollTop = target;
    // The settled entry makes the scroll event from this write look ours.
    scrollFollows.set(element, { target, written: element.scrollTop, frame: 0 });

    return;
  }

  let follow = scrollFollows.get(element);

  if (!follow) {
    follow = { target, written: element.scrollTop, frame: 0 };
    scrollFollows.set(element, follow);
  } else {
    follow.target = target;
  }

  if (!follow.frame) follow.frame = requestAnimationFrame(() => stepScrollFollow(element));
}

function isFollowScroll(element: HTMLElement): boolean {
  const follow = scrollFollows.get(element);
  if (!follow) return false;
  if (Math.abs(element.scrollTop - follow.written) <= 1) return true;

  stopScrollFollow(element);

  return false;
}

watch(
  () => ({
    mode: props.modelValue,
    page: props.pageId,
    editor: editorPane.value?.view?.scrollDOM,
    preview: previewPane.value?.scroller,
  }),
  (current) => {
    cleanupScrollSync();
    if (current.mode !== "split") return;

    const view = editorPane.value?.view;
    const scroller = previewPane.value?.scroller;
    if (!view || !scroller) return;

    let previewExtent = `${scroller.scrollHeight}:${scroller.clientHeight}`;

    const onEditor = () => {
      if (isFollowScroll(view.scrollDOM)) return;

      const mode = splitScrollMode();
      if (mode === "both" || mode === "editor") syncFromEditor(view, scroller);
    };
    const onPreview = () => {
      if (isFollowScroll(scroller)) return;

      const extent = `${scroller.scrollHeight}:${scroller.clientHeight}`;
      if (extent !== previewExtent) {
        previewExtent = extent;

        return;
      }

      const mode = splitScrollMode();
      if (mode === "both" || mode === "preview") syncFromPreview(view, scroller);
    };

    view.scrollDOM.addEventListener("scroll", onEditor, { passive: true });
    scroller.addEventListener("scroll", onPreview, { passive: true });

    detachScrollSync = () => {
      view.scrollDOM.removeEventListener("scroll", onEditor);
      scroller.removeEventListener("scroll", onPreview);
      stopScrollFollow(view.scrollDOM);
      stopScrollFollow(scroller);
    };
  },
  { immediate: true, flush: "post" },
);

function syncFromEditor(view: EditorView, scroller: HTMLElement) {
  const layout = previewPane.value?.getFrameLayout();
  if (!layout || !layout.tops.length) return;

  const y = view.scrollDOM.scrollTop;
  const block = view.lineBlockAtHeight(Math.min(y, view.contentHeight - 1));
  const pos = block ? block.from : 0;

  // The top of the viewport can sit in a blank-line gap between frames. Fall
  // back to the next frame, or the last one when past the end.
  let index = layout.ranges.findIndex(
    (range) => pos >= range.start && pos <= Math.max(range.start, range.end - 1),
  );
  if (index === -1) {
    index = layout.ranges.findIndex((range) => range.start >= pos);
    if (index === -1) index = layout.ranges.length - 1;
  }

  const top = layout.tops[index];
  if (top === undefined) return;

  followScroll(scroller, top);
}

function syncFromPreview(view: EditorView, scroller: HTMLElement) {
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

  // The preview can lag a large edit, so its ranges may point past the live
  // document. Clamp before asking CodeMirror for the block.
  const pos = Math.min(range.start, view.state.doc.length);
  followScroll(view.scrollDOM, view.lineBlockAt(pos).top);
}

const splitLeft = ref(50);

const tocOpen = ref(false);

/**
 * The outline jumps to the heading's source line. Read mode switches to split
 * first, like a rendered-link jump.
 */
function jumpToHeading(heading: { from: number; to: number }): void {
  tocOpen.value = false;
  onPreviewJump(heading);
}

// Page-toolbar actions that are worth a chord. The app-level registry defines the
// key specs. The handlers live here because both panels are PageView state.
onCapturedKey(
  (event) => matchesShortcut(event, "links"),
  (event) => {
    event.preventDefault();
    linksOpen.value = !linksOpen.value;
  },
);
onCapturedKey(
  (event) => matchesShortcut(event, "outline"),
  (event) => {
    event.preventDefault();
    tocOpen.value = !tocOpen.value;
  },
);

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
  VIEW_MODES.map((mode) => ({
    id: mode.id,
    icon: mode.icon,
    key: `pageView.${mode.id}`,
  })),
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
</script>

<template>
  <div class="page-view" ref="pageView">
    <div class="page-view__toolbar" data-tauri-drag-region="deep">
      <div class="page-view__toolbar-main">
        <div class="page-view__toolbar-main-left">
          <slot name="nav-toggle" />
          <slot name="scope" />
          <UiTruncatedText class="page-view__title" :text="meta?.title ?? pageId" />
        </div>

        <AssetPicker
          v-if="!compact && modelValue !== 'read' && store"
          v-model:open="assetsOpen"
          :store="store"
          @select="insertAsset"
        >
          <UiIconButton
            icon="photo_library"
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
          class="page-view__toggle page-view__format-toggle"
          @click="formatOpen = !formatOpen"
        />

        <!-- <UiIconButton
          v-if="store"
          icon="link"
          :label="$t('links.title')"
          :pressed="linksOpen"
          :disabled="!ready"
          class="page-view__links-toggle"
          @click="linksOpen = !linksOpen"
        /> -->

        <!-- <UiPopover
          v-if="store && boundFileId"
          v-model:open="tocOpen"
          align="end"
          class="menu toc-popover"
        >
          <template #trigger>
            <UiIconButton icon="toc" :label="$t('toc.title')" :disabled="!ready" />
          </template>
          <TableOfContents
            :file-id="boundFileId"
            :text="sharedState.text"
            :typst-state="boundState"
            @jump="jumpToHeading"
          />
        </UiPopover> -->

        <UiIconButton
          class="page-view__toggle page-view__find-toggle"
          icon="manage_search"
          :label="$t('pageView.find')"
          :pressed="findOpen"
          :disabled="!ready"
          @click="toggleFind"
        />

        <PublishDialog v-if="store" v-model:open="publishOpen" :page-id="pageId" :store="store" />

        <FontPackDialog
          v-model:open="fontPackDialogOpen"
          :scripts="missingScripts"
          :store="store"
        />

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
              <MsIcon :name="mode.icon" :size="20" />
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
                variant="plain"
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
                <MsIcon :name="mode.icon" :size="20" />
                {{ $t(mode.key) }}
                <MsIcon
                  v-if="modelValue === mode.id"
                  name="check"
                  :size="20"
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

          <UiMenuItem v-if="store && aiEnabled" icon="forum" :disabled="!ready" @select="askAi">
            {{ $t("chat.ask") }}
          </UiMenuItem>

          <UiMenuItem
            v-if="compact && modelValue !== 'read'"
            icon="text_format"
            @select="formatOpen = !formatOpen"
          >
            {{ $t("formatting.title") }}
            <MsIcon v-if="formatOpen" name="check" :size="20" class="page-view__menu-check" />
          </UiMenuItem>

          <UiMenuItem
            v-if="compact && modelValue !== 'read'"
            icon="photo_library"
            @select="assetsOpen = true"
          >
            {{ $t("assets.title") }}
          </UiMenuItem>

          <UiMenuSeparator />

          <UiMenuItem icon="link" @select="linksOpen = true">
            <span class="page-view__menu-label">
              {{ $t("links.title") }}
            </span>
            <UiKbd class="page-view__menu-key">{{ shortcutLabel("links") }}</UiKbd>
          </UiMenuItem>

          <UiMenuSeparator />

          <UiMenuItem
            v-if="store && atprotoStatus.signedIn"
            :disabled="atprotoStatus.readOnly"
            :icon="meta?.publishedAt ? 'cloud_done' : 'cloud_upload'"
            @select="publishOpen = true"
          >
            <span class="page-view__menu-label">
              {{ meta?.publishedAt ? $t("pageView.republish") : $t("pageView.publish") }}
            </span>
          </UiMenuItem>

          <UiMenuItem icon="download" @select="exportOpen = true">
            <span class="page-view__menu-label">
              {{ $t("exportPage.title") }}
            </span>
            <UiKbd class="page-view__menu-key">{{ shortcutLabel("export") }}</UiKbd>
          </UiMenuItem>
        </UiMenu>
      </div>
    </div>

    <PageFindBar
      v-if="findOpen"
      ref="findBar"
      :query="findQuery"
      :count="findMatches.length"
      :active="findActive"
      :replacement="findReplacement"
      :options="findOptions"
      :editable="modelValue !== 'read' && !store?.readOnly && !atprotoStatus.readOnly"
      :replace-count="findReplaceCount"
      :can-replace="findCanReplace"
      :invalid="findInvalid"
      :source-only="degraded"
      @update:query="findQuery = $event"
      @update:replacement="findReplacement = $event"
      @update:options="findOptions = $event"
      @next="nextFindMatch"
      @prev="prevFindMatch"
      @all="selectAllMatches"
      @replace="replaceCurrent"
      @replace-all="replaceAllMatches"
      @close="closeFind"
    />

    <div
      v-if="missingScripts.length && !fontNoticeDismissed && !degraded"
      class="page-view__engine page-view__fonts"
      role="status"
    >
      <span class="page-view__engine-text">
        {{ $t("fontPacks.missing", { scripts: missingScriptLabel }) }}
      </span>
      <UiButton variant="primary" @click="fontPackDialogOpen = true">
        {{ $t("fontPacks.add") }}
      </UiButton>
      <UiIconButton
        icon="close"
        variant="ghost"
        :label="$t('common.close')"
        @click="fontNoticeDismissed = true"
      />
    </div>

    <NotebookToolbar
      v-if="store && meta?.kind === 'notebook' && modelValue !== 'read'"
      :session="notebookSession"
      :disabled="!ready || degraded || store.readOnly || atprotoStatus.readOnly"
      :compact="coarsePointer"
      @add-cell="addNotebookCell"
      @release-all="releaseAllNotebook"
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
      <Transition :css="animateEditor" name="editor-fade" @after-enter="animateEditor = false">
        <EditablePane
          v-if="boundFileId || degraded"
          :key="`${pageId}:${stateGeneration}`"
          v-show="modelValue !== 'read'"
          v-bind="sharedState"
          ref="editorPane"
          :file-id="boundFileId"
          :space-id="workspaceId"
          :path="meta?.path ?? ''"
          :wysiwyg="modelValue === 'write'"
          :notebook="meta?.kind === 'notebook' ? notebookController?.options : undefined"
          :degraded="degraded"
          :read-only="store?.readOnly || atprotoStatus.readOnly"
          :spellcheck="spellcheckMode"
          :spellcheck-words="spellcheckWords"
          :spellcheck-ignore-ids="spellcheckIgnoreIds"
          :spellcheck-ignored-lints="spellcheckIgnoredLints"
          :editor="editorDisplay"
          :on-add-spellcheck-word="addSpellcheckWord"
          :on-ignore-spellcheck-lint="ignoreSpellcheckLint"
          :typst-state="boundState"
          :on-requests="onRequests"
          :revision="editorRevision"
          :extensions="extraExtensions"
          :on-panic="() => handlePanic()"
          :on-compile="onEngineCompile"
          :on-paged-compile="onPagedCompile"
          :find-source-ranges="findSourceRanges"
          :find-frame-marks="findFrameMarks"
          :on-navigate="(pageId) => emit('openPage', pageId)"
          :on-navigate-plugin="(instanceId) => emit('openPlugin', instanceId)"
          :on-asset-drop="handleAssetDrop"
          :on-text-change="applyLocalTextChanges"
        />

        <div
          v-else-if="showEditorLoading && !degraded"
          class="page-view__loading"
          role="status"
          aria-live="polite"
        >
          <div class="page-view__loading-bar" aria-hidden="true"><span /></div>
          <p class="page-view__loading-text">{{ $t("pageView.loadingEditor") }}</p>
        </div>
      </Transition>

      <div v-if="modelValue === 'split'" class="page-view__handle" @pointerdown="startSplitDrag" />

      <PagedPreview
        v-if="boundFileId && !degraded && (modelValue === 'split' || modelValue === 'read')"
        :key="`${pageId}:preview:${stateGeneration}`"
        v-bind="sharedState"
        ref="previewPane"
        :file-id="boundFileId"
        :space-id="workspaceId"
        :typst-state="boundState"
        :data-revision="dataRevision + pluginsRevision"
        :render-revision="renderRevision"
        :content-width="editorDisplay?.contentWidth ?? 'measure'"
        :on-requests="onRequests"
        :on-panic="() => handlePanic()"
        :on-compile="onEngineCompile"
        :on-paged-compile="onPagedCompile"
        :find-marks="findFrameMarks"
        @navigate="emit('openPage', $event)"
        @navigate-plugin="emit('openPlugin', $event)"
        @jump="onPreviewJump"
      />
    </div>
  </div>
</template>

<style>
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
  gap: var(--space-2);
  min-height: var(--pane-header-height);
  padding: var(--pane-header-pad-x);
  background: var(--color-surface-2);
}

/* The outline popover has no surface of its own, like the other menu-shaped
   popovers. */
.menu.toc-popover {
  width: min(20rem, calc(100vw - var(--space-4)));
  padding: 0;
  overflow: hidden;
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
  gap: var(--space-2);
  min-width: 0;
  flex: 1 1 0;
}

.page-view__title {
  min-width: 0;
  font-size: var(--text-xl);
  font-weight: 600;
}

/* With no crumb or toggle before it, keep the title's original inset. */
.page-view__toolbar-main-left .page-view__title:first-child {
  margin-left: var(--space-2);
}

.page-view__toolbar .page-view__toggle[aria-pressed="true"] {
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface-2));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 34%, transparent);
}

.page-view__modes-menu {
  display: none;
  flex: none;
}

/* Chevron pinned to the strip's right edge. Matches the edit button size. */
.page-view__format .page-view__format-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-sm);
  height: var(--control-sm);
  flex: none;
  padding: 0;
  margin-left: auto;
  color: var(--color-text-secondary);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

/* Full-width strip: the buttons ride inside it, left-aligned, scrolling
   sideways when they do not fit. */
.page-view__format {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 0 var(--space-1) var(--space-1);
  background: var(--color-surface-2);
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

@container page-view (max-width: 56rem) {
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
  border-radius: max(0px, calc(var(--radius-md) - 1px - var(--space-0-5)));
  cursor: pointer;
}

.page-view__mode .ms-icon {
  flex: none;
}

.page-view__mode:not(.page-view__mode--active):hover {
  color: var(--color-text);
  background: var(--color-surface-3);
}

.page-view__mode:disabled {
  opacity: 0.55;
  cursor: default;
}

.page-view__mode--active {
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: var(--shadow-1);
}

.page-view__mode-label {
  flex: none;
  min-width: calc(4.25rem * var(--ui-size));
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

.page-view__menu-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-view__menu-key {
  margin-left: var(--space-2);
}

.page-view__error {
  padding: var(--space-4);
  color: var(--color-danger);
}

.page-view__engine {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
  color: var(--color-text);
  background: var(--color-danger-soft);
  border-bottom: 1px solid var(--color-border);
}

.page-view__engine-text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
}

.page-view__fonts {
  background: var(--color-accent-soft);
}

.page-view__body {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

/* The same sliding bar the boot splash uses, so the two waits read as one
   system. The keyframes live in `pages/index.vue`'s global style block. */
.page-view__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  color: var(--color-text-secondary);
  user-select: none;
}

/* Both states sit in the editor's cell so the placeholder can fade out under
   the editor instead of pushing it into a second grid row. */
.page-view__body > .page-view__loading,
.page-view__body > .editable-pane {
  grid-area: 1 / 1;
}

.editor-fade-enter-active {
  transition: opacity var(--motion-base) var(--ease-out);
}

.editor-fade-leave-active {
  transition: opacity var(--motion-exit) var(--ease-in);
}

.editor-fade-enter-from,
.editor-fade-leave-to {
  opacity: 0;
}

.page-view__loading-bar {
  position: relative;
  width: 11rem;
  height: 0.25rem;
  overflow: hidden;
  background: var(--color-border);
  border-radius: var(--radius-full);
}

.page-view__loading-bar span {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background: var(--color-accent);
  border-radius: inherit;
  animation: app-splash-slide 1.1s ease-in-out infinite;
}

.page-view__loading-text {
  margin: 0;
  font-size: var(--text-sm);
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

.page-view__body--split .paged-preview {
  box-shadow: -1px 0 0 var(--color-border);
}

.page-view__body--read .paged-preview {
  padding: 0 var(--space-6);
  background: var(--color-surface-2);
}

/* Split view stacks on phones: side-by-side panes would give each ~190px.
   The horizontal drag handle is hidden. Editors and previews scroll on their own. */
@container page-view (max-width: 48rem) {
  .page-view__body--split {
    grid-template-columns: 100%;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }

  .page-view__handle {
    display: none;
  }

  .page-view__body--split .paged-preview {
    box-shadow: 0 -1px 0 var(--color-border);
  }

  .page-view__body--read .paged-preview {
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
  transition: opacity var(--motion-fast);
}

.page-view__handle:hover::after,
.page-view__handle:active::after {
  opacity: 1;
}
@media (hover: none) and (pointer: coarse) {
  .page-view__menu-key {
    display: none;
  }
}
</style>
