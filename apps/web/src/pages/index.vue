<script setup lang="ts">
import type { LocationQueryRaw } from "vue-router";

import type { NavQuery } from "~/lib/navStack";

import { setChatNavigation, useChat } from "~/composables/chat";
import { setProviderOverride } from "~/lib/ai/engine";
import { formatDocumentTitle } from "~/lib/documentTitle";
import { engineAvailable } from "~/lib/engineHealth";
import { sectionsOf } from "~/lib/engineSyntax";
import { todayISO } from "~/lib/format";
import { resolveOpenPageId } from "~/lib/openPage";
import { requestReveal } from "~/lib/reveal";
import { refreshSections, toSections } from "~/lib/sections";
import { testApi } from "~/lib/testApi";
import { VIEW_MODES, type ViewModeId } from "~/lib/view";

const {
  workspace,
  workspaces,
  error,
  ensure,
  resetEnsure,
  dataRevision,
  bootProgress,
  bootNote,
  workspaceGeneration,
  switching,
  storageSetup,
  atprotoStatus,
} = useWorkspace();

const loaded = ref(false);
const currentPageId = ref<string>("");
const currentPluginId = ref<string | null>(null);
const currentChatId = ref<string | null>(null);

const graphOpen = ref(false);
const filesOpen = ref(false);
const siteOpen = ref(false);
/** Whether the main pane is showing the selected page. The sidebar mutes the
 *  page highlight while a workspace view owns the pane. */
const pageActive = computed(
  () =>
    !graphOpen.value &&
    !filesOpen.value &&
    !siteOpen.value &&
    !currentChatId.value &&
    !currentPluginId.value,
);
const requestedMode = ref<ViewModeId | null>(null);
const mode = computed<ViewModeId>(() => requestedMode.value ?? "write");
const plugins = usePlugins();
const {
  open: paletteOpen,
  show: showPalette,
  hide: hidePalette,
  toggle: togglePalette,
} = useSearchPalette();
const { open: shortcutsOpen } = useShortcutsDialog();
const { open: settingsOpen } = useSettingsDialog();
const accountDialog = useAccountDialog();
/** Sidebar drawer state (mobile only). */
const navOpen = ref(false);
/** Desktop gets a resizable splitter, while mobile keeps the drawer. The query
 *  mirrors `--breakpoint-lg` in tokens.css (mobile <= 56rem, desktop above). */
const isDesktop = useMediaQuery("(min-width: 56.0625rem)");
const nav = useNavHistory();
const { visible: appBarVisible, toggle: toggleAppBar } = useAppBar();

const { t } = useI18n();

// Back closes the drawer and the palette before it navigates or leaves.
const navLayer = useBackLayer(navOpen);
useBackLayer(paletteOpen, hidePalette);

/** Name of the workspace being opened, for the switching pill. */
const switchingName = computed(
  () => workspaces.value.find((entry) => entry.id === switching.value)?.name ?? null,
);

const {
  auxWidth,
  sidebarCollapsed,
  sidebarSize,
  navResizing,
  splitterResizing,
  startNavResize,
  startAuxResize,
  resizeSidebarBy,
  resizeAuxBy,
  dockChatId,
  linksOpen,
  auxSide,
  auxActive,
  auxPanels,
  auxPanel,
  auxSnapshot,
  floatingAuxOpen,
  inlineAux,
  finishAuxClose,
  clearAuxContent,
  closeAuxPanel,
  closeActiveAux,
  moveAux,
  showWorkspaceCrumb,
  zen,
  setZen,
  toggleSidebar,
  leftAuxOpen,
  rightAuxOpen,
  leftAuxContent,
  rightAuxContent,
} = useShellLayout({
  isDesktop,
  currentPageId,
  currentChatId,
  closeDock: () => closeDock(),
  replaceRoute: () => syncRoute("replace"),
});

const { ensure: ensureSearch, search: searchManager, status: searchStatus } = useSearch();
const chat = useChat();
const appUpdates = useAppUpdates();

useAppShortcuts({
  togglePalette,
  nav,
  toggleAppBar,
  isDesktop,
  navOpen,
  toggleSidebar,
  zen,
  setZen,
  openFiles,
  openShortcuts: () => (shortcutsOpen.value = true),
  openSettings: () => (settingsOpen.value = true),
  openToday: () => void openToday(),
});

/** Titles the navigation labels read from, so a rename updates them. */
const pageTitles = useWorkspaceValue(
  workspace,
  ["pages"],
  (store) => new Map(store.listPages().map((entry) => [entry.id, entry.title])),
  new Map<string, string>(),
);

/** What the back or forward control is about to open. */
function destinationTitle(query: NavQuery | undefined): string | undefined {
  if (!query) return undefined;

  const pageId = typeof query.page === "string" ? query.page : "";
  const title = pageId ? pageTitles.value.get(pageId) : undefined;
  if (title) return title;

  const view = typeof query.view === "string" ? query.view : "";
  if (view === "graph") return t("graph.title");
  if (view === "site") return t("site.title");
  if (view.startsWith("chat:")) return t("chat.title");
  if (view.startsWith("plugin:")) return t("plugins.title");

  return undefined;
}

const backLabel = computed(() => {
  const title = destinationTitle(nav.previousQuery.value);

  return title ? t("nav.backTo", { title }) : t("nav.back");
});

const forwardLabel = computed(() => {
  const title = destinationTitle(nav.nextQuery.value);

  return title ? t("nav.forwardTo", { title }) : t("nav.forward");
});

// Search snapshots links: the palette needs the index started.
watch(
  paletteOpen,
  async (open) => {
    if (open && workspace.value) {
      const instance = await ensureSearch(workspace.value);
      void instance;
    }
  },
  { immediate: true },
);

/** Home page when it still exists, else the first page. Empty when the workspace
 *  has none, which is the empty pane's case. */
function fallbackPageId(): string {
  const store = workspace.value;
  if (!store) return "";

  return resolveOpenPageId(store.getSettings(), store.listPages()) ?? "";
}

// Switching workspaces swaps the store under the shell. The generation key
// remounts Sidebar/PageView, so the page id must be re-selected first. The
// watcher runs pre-render in the same tick as the bump.
watch(workspaceGeneration, () => {
  currentPageId.value = fallbackPageId();
  currentPluginId.value = null;
  currentChatId.value = null;
  // Another workspace is another set of pages, so the app's own history starts
  // over rather than pointing at ids the new workspace does not have.
  nav.reset(routeQuery());
  syncRoute("replace");
});

// Demo capture and e2e tests reach the active store through this handle.
watch(
  workspace,
  (store) => {
    testApi.store = store ?? null;
  },
  { immediate: true },
);

// Section metadata should stay fresh even without the editor being open:
// the store's page changes trigger a re-extract on every page switch.
watch(currentPageId, async (id) => {
  setPluginCurrentPage(id || null);
  if (!id || !workspace.value) return;

  const store = workspace.value;
  const text = await store.loadPageText(id);
  const typstState = await useTypst().catch(() => null);
  if (!typstState) return;

  await refreshSections(store, id, text, (source) =>
    engineAvailable() ? toSections(sectionsOf(typstState, source), source) : null,
  );
});

const { locale, setLocale } = useI18n();

// Theme tokens and UI language follow the active workspace, not just the one
// loaded at boot: both composables watch the store, so creating or switching
// a workspace applies its settings without a reload.
useTheme(() => workspace.value);
useAppLocale(locale, setLocale, () => workspace.value);

const pageQuery = useRouteQuery<string>("page", "");
const modeQuery = useRouteQuery<string>("mode", "write");
const viewQuery = useRouteQuery<string>("view", "");
const asideQuery = useRouteQuery<string>("aside", "");
const router = useRouter();
const route = useRoute();

/** Query values can be string arrays or null. A page/mode id is a plain string. */
function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isViewMode(value: unknown): value is ViewModeId {
  return (
    typeof value === "string" && (VIEW_MODES.map((m) => m.id) as readonly string[]).includes(value)
  );
}

/**
 * Everything that runs once a workspace is open. `retryBoot` runs it again
 * after a failure, so the setup cannot live in `onMounted` alone.
 */
function afterBoot(): void {
  // Dev builds run against a release channel they cannot install over, but the
  // Settings row still needs to know which channel it is.
  void appUpdates.detect();
  if (!import.meta.dev) void appUpdates.check({ silent: true });

  const store = workspace.value;
  if (!store) return; // no workspaces, so the chooser handles it

  const linkedId = queryString(pageQuery.value);
  const linked = linkedId ? store.getPage(linkedId) : undefined;
  if (linked) currentPageId.value = linked.id;
  else currentPageId.value = fallbackPageId();

  // A link's `?mode=` is the user's choice for that link, so it is recorded as
  // one. A link without one follows the page's kind.
  if (isViewMode(modeQuery.value)) requestedMode.value = modeQuery.value;

  // A ?view=plugin:<instance>, ?view=chat:<thread>, ?view=graph, or ?view=files
  // link reopens that pane.
  const linkedView = queryString(viewQuery.value);
  if (linkedView === "graph") graphOpen.value = true;
  if (linkedView === "files") filesOpen.value = true;
  if (linkedView === "site") siteOpen.value = true;
  const instanceId = linkedView.startsWith("plugin:") ? linkedView.slice("plugin:".length) : "";
  if (instanceId && store.getPluginInstance(instanceId)) openPlugin(instanceId);
  const threadId = linkedView.startsWith("chat:") ? linkedView.slice("chat:".length) : "";
  if (threadId && store.getChat(threadId)) currentChatId.value = threadId;

  // A ?aside=chat:<thread> link reopens the dock, or the pane on narrow windows.
  const linkedAside = queryString(asideQuery.value);
  const dockId = linkedAside.startsWith("chat:") ? linkedAside.slice("chat:".length) : "";
  if (dockId && store.getChat(dockId)) {
    if (isDesktop.value) {
      currentChatId.value = null;
      dockChatId.value = dockId;
    } else {
      currentChatId.value = dockId;
    }
  }

  // Normalize the URL so the first entry stores the resolved state, and back
  // from a later page then restores this one instead of an empty query.
  syncRoute("replace");

  setPluginNavigation({ openPage, openPlugin });
  setChatNavigation({ openChat, openPage });

  // Dev-only handles for the e2e suite. Production builds drop them.
  bindPageTestApi({
    workspace,
    plugins,
    openPage,
    setMode: (value) => void setMode(value as ViewModeId),
    searchStatus: () => searchStatus.value,
    searchQuery: async (text) => {
      const manager =
        searchManager.value ?? (workspace.value ? await ensureSearch(workspace.value) : null);

      return (await manager?.query(text))?.items ?? [];
    },
    openGraph,
    openChat,
    newChat: async (pageId) => (await chat.startThread({ pageId: pageId ?? null })).id,
    sendChat: (id, text) => chat.send(id, text),
    chatMessages: (id) => chat.readMessages(id),
    setAiStub: setProviderOverride,
    openPlugin,
    openSite,
    siteDid: () => atprotoStatus.value.did,
    writeFile: async (path, text) => {
      await useWorkspace().backend.value?.write(path, new TextEncoder().encode(text));
    },
    typstState: () => useTypst(),
  });
}

async function boot(): Promise<void> {
  await ensure();
  loaded.value = true;
  afterBoot();
}

onMounted(() => {
  void boot();
});

const retryingBoot = ref(false);

/** The escape hatch when a retry cannot work either, e.g. a wedged storage handle. */
function reloadApp(): void {
  window.location.reload();
}

/** Retries a boot that failed. The splash shows the reason; this is the way out. */
async function retryBoot(): Promise<void> {
  retryingBoot.value = true;
  try {
    // `ensure()` memoizes its promise, so a failed boot has to be forgotten
    // before it can run again.
    resetEnsure();
    await boot();
  } catch {
    // The reason is already in the splash.
  } finally {
    retryingBoot.value = false;
  }
}

watch(currentPageId, (id) => {
  testApi.pageId = id || null;
});

// Back/forward or a pasted link changes the query under us.
watch(pageQuery, (raw) => {
  const id = queryString(raw);
  if (!loaded.value || !id || id === currentPageId.value) return;

  const store = workspace.value;
  if (store?.getPage(id)) {
    currentPageId.value = id;
    return;
  }

  // Stale id: same fallback as a missing page, and rewrite the URL so it stops
  // pointing at a page this workspace does not have.
  const fallback = fallbackPageId();
  currentPageId.value = fallback;
  if (queryString(pageQuery.value) !== fallback) pageQuery.value = fallback;
});

// Back/forward or a pasted link changes the query under us. An entry without a
// `?mode=` means "follow the page's kind", which is what a replace from a
// conversion writes.
watch(modeQuery, (value) => {
  if (!loaded.value) return;

  requestedMode.value = isViewMode(value) ? value : null;
});

/** One `?view=` value, so only one of the graph/chat/plugin/files panes is open. */
function paneViewValue(): string {
  if (currentChatId.value) return `chat:${currentChatId.value}`;
  if (currentPluginId.value) return `plugin:${currentPluginId.value}`;
  if (graphOpen.value) return "graph";
  if (filesOpen.value) return "files";
  if (siteOpen.value) return "site";

  return "";
}

/** The query the refs describe. Foreign params (OAuth, pasted extras) stay. */
function routeQuery(): LocationQueryRaw {
  const query: LocationQueryRaw = { ...route.query };
  delete query.page;
  delete query.mode;
  delete query.view;
  delete query.aside;

  if (currentPageId.value) query.page = currentPageId.value;
  // Written only when it differs from the default, so an explicit choice
  // round-trips through the URL and a default one leaves it out.
  if (mode.value !== "write") query.mode = mode.value;
  const view = paneViewValue();
  if (view) query.view = view;
  if (dockChatId.value) query.aside = `chat:${dockChatId.value}`;

  return query;
}

function sameQuery(next: LocationQueryRaw): boolean {
  const keys = new Set([...Object.keys(route.query), ...Object.keys(next)]);

  for (const key of keys) {
    if (String(route.query[key] ?? "") !== String(next[key] ?? "")) return false;
  }

  return true;
}

/**
 * True when the last navigation replaced an overlay's entry. That entry sits one
 * position past the app's own, so the mirror appends where a plain replace would
 * overwrite, and the step back to where the overlay was opened is not lost.
 */
let overlayEntryReplaced = false;
/** Route write queued while another one was in flight, and the strongest mode. */
let pendingRoute: { mode: "push" | "replace" } | null = null;

/**
 * Writes the refs to the URL. Opening something pushes a history step.
 * normalization and closes replace the current one. The read watchers apply
 * the result back, so this is the only writer. Every write tags the entry with
 * its place in the app's own history, which is what lets back and forward know
 * where they are.
 *
 * A `push` in the same tick as a `replace` wins, and only one navigation is
 * queued: one action can reach this from several watchers (a page conversion
 * bumps both the page kind and the store revision), and two queued navigations
 * from one click resolve in an order nobody chose.
 */
function syncRoute(historyMode: "push" | "replace"): void {
  if (!loaded.value) return;

  if (pendingRoute) {
    if (historyMode === "push") pendingRoute.mode = "push";

    return;
  }

  pendingRoute = { mode: historyMode };
  queueMicrotask(() => {
    const queued = pendingRoute;
    pendingRoute = null;
    if (queued) void writeRoute(queued.mode);
  });
}

function writeRoute(historyMode: "push" | "replace"): Promise<unknown> | void {
  const query = routeQuery();
  if (sameQuery(query)) {
    overlayEntryReplaced = false;

    return;
  }

  const index = nav.record(query, {
    append: historyMode === "push" || overlayEntryReplaced,
  });
  overlayEntryReplaced = false;

  return router[historyMode]({ query, state: { typbaseIndex: index } });
}

/**
 * A navigation from an open overlay replaces the overlay's history entry so
 * back lands before it instead of reopening it. The overlay closes in the
 * action that called this.
 */
function takeLayerHistory(): "push" | "replace" {
  if (!consumeTopBackLayer()) {
    overlayEntryReplaced = false;

    return "push";
  }

  overlayEntryReplaced = true;

  return "replace";
}

/**
 * Closes the drawer and consumes its history entry. A menu inside the drawer
 * sits on top of it, so `takeLayerHistory()` only consumes the menu. Without
 * this, the drawer's watcher calls `history.back()` after the new pane opens
 * and the browser closes it again.
 */
function closeNavLayer(): void {
  if (!navOpen.value) return;

  navLayer.consume();
  navOpen.value = false;
}

// Back/forward or a pasted link changes the open pane under us.
watch(viewQuery, (raw) => {
  if (!loaded.value) return;

  const value = queryString(raw);
  if (value === "graph") {
    currentChatId.value = null;
    currentPluginId.value = null;
    filesOpen.value = false;
    siteOpen.value = false;
    graphOpen.value = true;

    return;
  }

  if (value === "files") {
    currentChatId.value = null;
    currentPluginId.value = null;
    graphOpen.value = false;
    siteOpen.value = false;
    filesOpen.value = true;

    return;
  }

  if (value === "site") {
    currentChatId.value = null;
    currentPluginId.value = null;
    graphOpen.value = false;
    filesOpen.value = false;
    siteOpen.value = true;

    return;
  }

  if (value.startsWith("chat:")) {
    const id = value.slice("chat:".length);
    if (workspace.value?.getChat(id)) {
      currentChatId.value = id;
      currentPluginId.value = null;
      graphOpen.value = false;
      filesOpen.value = false;
      siteOpen.value = false;
    } else if (queryString(viewQuery.value) === value) {
      viewQuery.value = "";
    }

    return;
  }

  if (value.startsWith("plugin:")) {
    const id = value.slice("plugin:".length);
    currentChatId.value = null;
    graphOpen.value = false;
    filesOpen.value = false;
    siteOpen.value = false;
    if (workspace.value?.getPluginInstance(id)) {
      if (plugins.surfaceOf(id, "pane")) currentPluginId.value = id;
      else if (plugins.surfaceOf(id, "window")) plugins.openWindow(id);
    } else if (queryString(viewQuery.value) === value) {
      viewQuery.value = "";
    }
    return;
  }

  currentChatId.value = null;
  currentPluginId.value = null;
  graphOpen.value = false;
  filesOpen.value = false;
  siteOpen.value = false;
});

// Back/forward or a pasted link changes the dock under us.
watch(asideQuery, (raw) => {
  if (!loaded.value) return;

  const value = queryString(raw);
  const id = value.startsWith("chat:") ? value.slice("chat:".length) : "";
  if (id && workspace.value?.getChat(id)) {
    if (isDesktop.value) {
      currentChatId.value = null;
      dockChatId.value = id;
    } else {
      // Narrow windows have no dock, so the same link opens the full pane.
      currentChatId.value = id;
      dockChatId.value = null;
    }

    return;
  }

  dockChatId.value = null;
});

// A deleted page, instance, or thread must not leave the shell on an empty pane.
watch(dataRevision, () => {
  let changed = false;
  // The sidebar tells the shell when it deletes the open page, but a plugin, a
  // peer over sync, or anything else reaching the store does not, and a stale id
  // opened a page that no longer exists.
  if (currentPageId.value && !workspace.value?.getPage(currentPageId.value)) {
    currentPageId.value = fallbackPageId();
    changed = true;
  }
  if (currentPluginId.value && !workspace.value?.getPluginInstance(currentPluginId.value)) {
    currentPluginId.value = null;
    changed = true;
  }
  if (currentChatId.value && !workspace.value?.getChat(currentChatId.value)) {
    currentChatId.value = null;
    changed = true;
  }
  if (dockChatId.value && !workspace.value?.getChat(dockChatId.value)) {
    dockChatId.value = null;
    changed = true;
  }

  if (changed) syncRoute("replace");
});

function openPage(id: string) {
  const historyMode = takeLayerHistory();
  closeNavLayer(); // drawer interactions close after selection
  currentPluginId.value = null; // opening a page leaves the other panes
  currentChatId.value = null;
  graphOpen.value = false;
  filesOpen.value = false;
  siteOpen.value = false;
  // An empty id means the open page was deleted. Fall back to home/first.
  currentPageId.value = id || fallbackPageId();
  syncRoute(historyMode);
}

/** The daily note for today, creating it when it is missing. */
async function openToday(): Promise<void> {
  const store = workspace.value;
  if (!store) return;

  const page = await store.createDailyNote(todayISO());
  openPage(page.id);
}

/** The workspace menu opens search: close the menu and drawer before the palette. */
function openSearch(): void {
  consumeTopBackLayer();
  closeNavLayer();
  showPalette();
}

/**
 * A palette row was picked: open its page, then ask the page to scroll to the
 * hit. The request outlives the page switch. The new PageView consumes it once
 * it is bound.
 */
function openSearchResult(payload: { pageId: string; from?: number; to?: number }) {
  hidePalette();
  openPage(payload.pageId);
  if (payload.from !== undefined && payload.to !== undefined) {
    requestReveal(payload.pageId, payload.from, payload.to);
  }
}

/** Tab and window title for the open page: "Page · Workspace". */
const pageTitle = useWorkspaceValue(
  workspace,
  ["pages", "settings"],
  (store) => {
    const page = currentPageId.value ? store.getPage(currentPageId.value) : undefined;

    return formatDocumentTitle(page?.title, store.getSettings().name);
  },
  formatDocumentTitle(),
);

useSeoMeta({
  title: () => pageTitle.value,
  ogTitle: () => pageTitle.value,
  ogType: "website",
});

function openPlugin(instanceId: string) {
  closeNavLayer();
  if (!instanceId) return;

  // Window-only plugins (drawing) float. Pane plugins take the main pane. A
  // local plugin's manifest may not be in the catalog yet, so keep the id and
  // retry when it arrives instead of opening a blank pane.
  const kinds = plugins.surfacesOf(instanceId).map((surface) => surface.kind);
  if (!kinds.length) {
    if (workspace.value?.getPluginInstance(instanceId)) pendingPluginId.value = instanceId;
    return;
  }

  if (kinds.includes("pane")) {
    const historyMode = takeLayerHistory();
    setZen(false);
    currentChatId.value = null;
    graphOpen.value = false;
    filesOpen.value = false;
    siteOpen.value = false;
    currentPluginId.value = instanceId;
    syncRoute(historyMode);
  } else if (kinds.includes("window")) {
    plugins.openWindow(instanceId);
  }
}

/** A plugin link that arrived before its catalog entry did. */
const pendingPluginId = ref<string | null>(null);

watch(
  () => plugins.catalog.value,
  () => {
    const id = pendingPluginId.value;
    if (id && plugins.surfacesOf(id).length) {
      pendingPluginId.value = null;
      openPlugin(id);
    }
  },
);

/** A floating links rail must not sit over a full-pane view. */
function closeFloatingLinks(): void {
  if (!inlineAux.value) linksOpen.value = false;
}

function openGraph(rootAtPage = false) {
  const historyMode = takeLayerHistory();
  closeNavLayer();
  setZen(false);
  currentPluginId.value = null;
  currentChatId.value = null;
  filesOpen.value = false;
  siteOpen.value = false;
  graphOpen.value = true;

  // The entry point sets the scope. Links opens the page's local graph, while
  // the workspace menu opens the whole graph. The switch in the header is a
  // temporary override, not a sticky mode that surprises the next open.
  const store = workspace.value;
  const graph = store?.getSettings().graph;
  const local = Boolean(rootAtPage && currentPageId.value);
  if (store && graph && graph.local !== local) {
    store.updateSettings({ graph: { ...graph, local } });
  }

  // A floating links rail has a backdrop that would sit over the graph. Close
  // it for any graph; an inline rail can stay beside the graph.
  closeFloatingLinks();

  syncRoute(historyMode);
}

function closeGraph() {
  graphOpen.value = false;
  syncRoute("replace");
}

/** The storage browser takes the main pane, like the graph. */
function openFiles() {
  const historyMode = takeLayerHistory();
  closeNavLayer();
  setZen(false);
  closeFloatingLinks();
  currentPluginId.value = null;
  currentChatId.value = null;
  graphOpen.value = false;
  siteOpen.value = false;
  filesOpen.value = true;
  syncRoute(historyMode);
}

function closeFiles() {
  filesOpen.value = false;
  syncRoute("replace");
}

/** The website builder dashboard. */
function openSite() {
  const historyMode = takeLayerHistory();
  closeNavLayer();
  setZen(false);
  closeFloatingLinks();
  currentPluginId.value = null;
  currentChatId.value = null;
  graphOpen.value = false;
  filesOpen.value = false;
  siteOpen.value = true;
  syncRoute(historyMode);
}

function closeSite() {
  siteOpen.value = false;
  syncRoute("replace");
}

/** Opens the shared account dialog. */
function openAccount() {
  consumeTopBackLayer();
  closeNavLayer();
  accountDialog.show(atprotoStatus.value.signedIn ? "accounts" : "signin");
}

function closePlugin() {
  currentPluginId.value = null;
  syncRoute("replace");
}

/**
 * Opens a thread by id, the most recent one, or a fresh one. Desktop docks it
 * beside the main pane so the page stays visible. Narrow windows keep the full
 * pane.
 */
function openChat(threadId?: string | null) {
  const historyMode = takeLayerHistory();
  closeNavLayer();
  setZen(false);

  const open = (id: string) => {
    if (isDesktop.value) {
      currentChatId.value = null;
      dockChatId.value = id;
    } else {
      currentPluginId.value = null;
      graphOpen.value = false;
      filesOpen.value = false;
      siteOpen.value = false;
      currentChatId.value = id;
      dockChatId.value = null;
    }
    syncRoute(historyMode);
  };

  if (threadId) {
    open(threadId);
    return;
  }

  const latest = workspace.value?.listChats()[0];
  if (latest) {
    open(latest.id);
    return;
  }

  void chat
    .startThread({ pageId: currentPageId.value || null })
    .then((created) => open(created.id))
    .catch((cause) => {
      console.error("[chat] could not create a thread:", cause);
    });
}

function closeChat() {
  currentChatId.value = null;
  syncRoute("replace");
}

function closeDock() {
  dockChatId.value = null;
  syncRoute("replace");
}

function onLinksOpen(open: boolean) {
  linksOpen.value = open;
}

/** Moves the docked thread into the main pane. */
function expandDock() {
  const id = dockChatId.value;
  if (!id) return;

  dockChatId.value = null;
  currentPluginId.value = null;
  graphOpen.value = false;
  filesOpen.value = false;
  siteOpen.value = false;
  currentChatId.value = id;
  // The rail would otherwise paint the same thread while it slides shut.
  clearAuxContent();
  syncRoute("replace");
}

// Persist pending snapshot writes when the tab goes away.
useEventListener("pagehide", () => {
  void workspace.value?.flush();
});

async function setMode(value: ViewModeId) {
  requestedMode.value = value === "write" ? null : value;
  // A mode picked from the menu is one navigation: the menu's entry is
  // replaced, so its deferred `history.back()` cannot drop the new `?mode=`.
  syncRoute(takeLayerHistory());
}

definePageMeta({ ssr: false });
</script>

<template>
  <main class="app">
    <div v-if="loaded && switching" class="app__switching" role="status">
      <span class="app__switching-spinner" aria-hidden="true" />
      <span class="app__switching-label">
        {{ switchingName ? $t("boot.switchingTo", { name: switchingName }) : $t("boot.switching") }}
      </span>
    </div>

    <Transition name="splash">
      <div v-if="!loaded" class="app__splash" role="status" aria-live="polite">
        <h1 class="app__splash-title">{{ $t("boot.title") }}</h1>
        <div class="app__splash-bar" aria-hidden="true"><span /></div>

        <ol class="app__splash-steps">
          <li
            v-for="step in bootProgress"
            :key="step.id"
            class="app__splash-step"
            :class="`app__splash-step--${step.status}`"
          >
            <span
              class="app__splash-step-mark"
              :class="`app__splash-step-mark--${step.status}`"
              aria-hidden="true"
            >
              <svg v-if="step.status === 'done'" class="app__splash-step-check" viewBox="0 0 16 16">
                <path
                  d="M3.5 8.5l3 3 6-7"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span class="app__splash-step-label">{{ step.label }}</span>
            <!-- <span v-if="step.detail" class="app__splash-step-detail">{{ step.detail }}</span> -->
          </li>
        </ol>

        <p v-if="bootNote" class="app__splash-note">{{ bootNote }}</p>

        <template v-if="error">
          <p class="app__splash-error">{{ error }}</p>
          <div class="app__splash-actions">
            <UiButton variant="primary" :disabled="retryingBoot" @click="retryBoot">
              {{ retryingBoot ? $t("boot.retrying") : $t("boot.retry") }}
            </UiButton>
            <UiButton variant="ghost" @click="reloadApp">{{ $t("engine.reload") }}</UiButton>
          </div>
        </template>
      </div>
    </Transition>

    <StorageSetup v-if="loaded && storageSetup" :setup="storageSetup" />

    <template v-if="loaded && !storageSetup && workspace">
      <div
        :key="workspaceGeneration"
        class="app__content"
        :class="{ 'app__content--switching': switching, 'app__content--zen': zen }"
        :aria-busy="switching ? true : undefined"
        :inert="switching ? true : undefined"
      >
        <!-- Window-level chrome. Narrow windows keep the mobile layout whole,
             so the bar goes with them rather than eating the editor's height. -->
        <AppBar
          v-if="isDesktop && appBarVisible && !zen"
          :store="workspace"
          :back-label="backLabel"
          :forward-label="forwardLabel"
          :sidebar-visible="!sidebarCollapsed"
          :zen="zen"
          @open-page="openPage"
          @toggle-sidebar="toggleSidebar"
          @open-files="openFiles"
          @open-site="openSite"
          @open-graph="openGraph()"
          @toggle-zen="setZen(!zen)"
        />

        <div class="app__body">
          <div
            v-if="isDesktop"
            class="app__splitter"
            :class="{ 'app__splitter--resizing': splitterResizing }"
          >
            <aside
              class="app__nav-panel"
              :class="{ 'app__nav-panel--collapsed': sidebarCollapsed }"
              :style="{ width: `${sidebarSize}px` }"
              :aria-hidden="sidebarCollapsed ? 'true' : undefined"
              :inert="sidebarCollapsed"
            >
              <Sidebar
                :store="workspace"
                :current-page-id="currentPageId"
                :page-active="pageActive"
                :active-plugin-id="currentPluginId"
                @select="openPage"
                @open-plugin="openPlugin"
                @search="openSearch"
                @chat="openChat"
                @graph="openGraph"
                @open-site="openSite"
                @open-files="openFiles"
                @open-account="openAccount"
                @collapse-request="toggleSidebar"
              />
            </aside>

            <div
              v-show="!sidebarCollapsed || navResizing"
              class="app__resize-handle"
              role="separator"
              aria-orientation="vertical"
              :aria-label="$t('sidebar.resizeSidebar')"
              tabindex="0"
              @pointerdown="startNavResize"
              @keydown.left.prevent="resizeSidebarBy(-16)"
              @keydown.right.prevent="resizeSidebarBy(16)"
            />

            <aside
              class="app__aux-panel app__aux-panel--left"
              :class="{
                'app__aux-panel--workspace': !leftAuxContent?.panels.includes('links'),
                'app__aux-panel--idle': !leftAuxContent,
              }"
              :style="{ width: leftAuxOpen ? `${auxWidth}px` : '0px' }"
            >
              <div class="app__aux-panel-body">
                <AuxiliaryRail
                  v-if="leftAuxContent"
                  :side="leftAuxContent.side"
                  :panels="leftAuxContent.panels"
                  :active="leftAuxContent.active"
                  :chat-id="leftAuxContent.chatId"
                  :page-id="leftAuxContent.pageId"
                  :store="workspace"
                  :flat="!leftAuxContent.panels.includes('links')"
                  @update:active="auxActive = $event"
                  @close-panel="closeAuxPanel"
                  @close="closeActiveAux"
                  @expand-chat="expandDock"
                  @open-thread="openChat"
                  @open-page="openPage"
                  @open-graph="openGraph(true)"
                  @move="moveAux"
                />
              </div>
            </aside>

            <div
              v-show="leftAuxOpen"
              class="app__resize-handle"
              role="separator"
              aria-orientation="vertical"
              :aria-label="$t('aux.title')"
              tabindex="0"
              @pointerdown="startAuxResize($event, 'left')"
              @keydown.left.prevent="resizeAuxBy(-16, 'left')"
              @keydown.right.prevent="resizeAuxBy(16, 'left')"
            />

            <div class="app__main-panel">
              <div class="app__main">
                <MainPane
                  :page-id="currentPageId"
                  :plugin-instance-id="currentPluginId"
                  :chat-thread-id="currentChatId"
                  :graph-open="graphOpen"
                  :files-open="filesOpen"
                  :site-open="siteOpen"
                  :links-open="linksOpen"
                  :model-value="mode"
                  @update:model-value="setMode"
                  @update:links-open="onLinksOpen"
                  @open-page="openPage"
                  @open-plugin="openPlugin"
                  @close-plugin="closePlugin"
                  @open-thread="openChat"
                  @close-chat="closeChat"
                  @open-graph="openGraph(true)"
                  @close-graph="graphOpen = false"
                  @close-files="closeFiles"
                  @close-site="closeSite"
                >
                  <template #nav-toggle>
                    <UiIconButton
                      v-if="sidebarCollapsed"
                      :icon="sidebarCollapsed ? 'left_panel_open' : 'left_panel_close'"
                      :label="
                        sidebarCollapsed ? $t('sidebar.showSidebar') : $t('sidebar.hideSidebar')
                      "
                      class="app__nav-toggle app__nav-toggle--desktop"
                      @click="toggleSidebar"
                    />
                  </template>

                  <template #scope>
                    <WorkspaceCrumb
                      v-if="showWorkspaceCrumb"
                      @search="openSearch"
                      @account="openAccount"
                      @graph="openGraph()"
                      @chat="openChat()"
                      @site="openSite"
                      @files="openFiles"
                    />
                  </template>
                </MainPane>
              </div>
            </div>

            <div
              v-show="rightAuxOpen"
              class="app__resize-handle"
              role="separator"
              aria-orientation="vertical"
              :aria-label="$t('aux.title')"
              tabindex="0"
              @pointerdown="startAuxResize($event, 'right')"
              @keydown.left.prevent="resizeAuxBy(-16, 'right')"
              @keydown.right.prevent="resizeAuxBy(16, 'right')"
            />

            <aside
              class="app__aux-panel app__aux-panel--right"
              :class="{
                'app__aux-panel--workspace': !rightAuxContent?.panels.includes('links'),
                'app__aux-panel--idle': !rightAuxContent,
              }"
              :style="{ width: rightAuxOpen ? `${auxWidth}px` : '0px' }"
            >
              <div class="app__aux-panel-body">
                <AuxiliaryRail
                  v-if="rightAuxContent"
                  :side="rightAuxContent.side"
                  :panels="rightAuxContent.panels"
                  :active="rightAuxContent.active"
                  :chat-id="rightAuxContent.chatId"
                  :page-id="rightAuxContent.pageId"
                  :store="workspace"
                  :flat="!rightAuxContent.panels.includes('links')"
                  @update:active="auxActive = $event"
                  @close-panel="closeAuxPanel"
                  @close="closeActiveAux"
                  @expand-chat="expandDock"
                  @open-thread="openChat"
                  @open-page="openPage"
                  @open-graph="openGraph(true)"
                  @move="moveAux"
                />
              </div>
            </aside>
          </div>

          <!-- Mobile drawer + main pane. -->
          <template v-else>
            <div
              class="app__nav"
              :class="{ 'app__nav--open': navOpen }"
              :aria-hidden="navOpen ? 'false' : undefined"
            >
              <Sidebar
                :store="workspace"
                :current-page-id="currentPageId"
                :page-active="pageActive"
                :active-plugin-id="currentPluginId"
                drawer
                @select="openPage"
                @open-plugin="openPlugin"
                @search="openSearch"
                @chat="openChat"
                @graph="openGraph"
                @open-site="openSite"
                @open-files="openFiles"
                @open-account="openAccount"
                @collapse-request="navOpen = false"
              />
            </div>

            <button
              v-if="navOpen"
              type="button"
              class="app__backdrop"
              :aria-label="$t('boot.closeNav')"
              @click="navOpen = false"
            />

            <div class="app__main">
              <MainPane
                :page-id="currentPageId"
                :plugin-instance-id="currentPluginId"
                :chat-thread-id="currentChatId"
                :graph-open="graphOpen"
                :files-open="filesOpen"
                :site-open="siteOpen"
                :links-open="linksOpen"
                :model-value="mode"
                @update:model-value="setMode"
                @update:links-open="onLinksOpen"
                @open-page="openPage"
                @open-plugin="openPlugin"
                @close-plugin="closePlugin"
                @open-thread="openChat"
                @close-chat="closeChat"
                @open-graph="openGraph(true)"
                @close-graph="closeGraph"
                @close-files="closeFiles"
                @close-site="closeSite"
              >
                <template #nav-toggle>
                  <UiIconButton
                    icon="menu"
                    :size="24"
                    :label="$t('boot.openNav')"
                    variant="ghost"
                    class="app__nav-toggle"
                    @click="navOpen = true"
                  />
                </template>

                <template #scope>
                  <WorkspaceCrumb
                    v-if="showWorkspaceCrumb"
                    @search="openSearch"
                    @account="openAccount"
                    @graph="openGraph()"
                    @chat="openChat()"
                    @site="openSite"
                    @files="openFiles"
                  />
                </template>
              </MainPane>
            </div>
          </template>

          <AuxiliaryRail
            v-if="!isDesktop || !inlineAux"
            :open="floatingAuxOpen"
            :side="auxSnapshot?.side ?? auxSide"
            :panels="auxSnapshot?.panels ?? []"
            :active="auxSnapshot?.active ?? 'chat'"
            :chat-id="auxSnapshot?.chatId ?? null"
            :page-id="auxSnapshot?.pageId ?? null"
            :store="workspace"
            floating
            @update:active="auxActive = $event"
            @close-panel="closeAuxPanel"
            @close="closeActiveAux"
            @expand-chat="expandDock"
            @open-thread="openChat"
            @open-page="openPage"
            @open-graph="openGraph(true)"
            @move="moveAux"
            @after-close="finishAuxClose"
          />

          <PluginWindows />

          <UiIconButton
            v-if="zen"
            variant="ghost"
            class="app__zen-exit"
            icon="fullscreen_exit"
            :label="$t('zen.exit')"
            @click="setZen(false)"
          />
        </div>

        <SearchPalette
          v-if="paletteOpen && workspace"
          :store="workspace"
          @open="openSearchResult"
          @close="hidePalette"
        />

        <KeyboardShortcutsDialog v-model:open="shortcutsOpen" />
        <SettingsDialog v-if="workspace" v-model:open="settingsOpen" :store="workspace" />
        <AccountDialog v-if="workspace" />
      </div>
    </template>

    <div v-if="loaded && !storageSetup && !workspace" class="app__chooser">
      <WorkspaceSwitcher mode="screen" />
    </div>

    <UpdateDialog />
  </main>
</template>
