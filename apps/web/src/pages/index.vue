<script setup lang="ts">
import type { PageKind, PluginSurfaceKind } from "@typbase/typing";
import type { SplitterPanel } from "reka-ui";
import type { LocationQueryRaw } from "vue-router";

import { isTauri } from "@typbase/storage";
import iconUrl from "~~/public/icon.svg?url";

import type { NavQuery } from "~/lib/navStack";

import { setChatNavigation, useChat } from "~/composables/chat";
import { setProviderOverride } from "~/lib/ai/engine";
import { bundleTextFiles, compileBundle } from "~/lib/bundleCheck";
import { formatDocumentTitle } from "~/lib/documentTitle";
import { engineAvailable } from "~/lib/engineHealth";
import { sectionsOf } from "~/lib/engineSyntax";
import { buildExport, type ExportOptions } from "~/lib/exportPage";
import { resolveOpenPageId } from "~/lib/openPage";
import { isMac } from "~/lib/platform";
import { requestReveal } from "~/lib/reveal";
import { refreshSections, toSections } from "~/lib/sections";
import { testApi } from "~/lib/testApi";
import { VIEW_MODES, type ViewModeId } from "~/lib/view";

const {
  workspace,
  workspaces,
  error,
  ensure,
  dataRevision,
  bootProgress,
  bootNote,
  workspaceGeneration,
  switching,
  storageSetup,
} = useWorkspace();

const loaded = ref(false);
const activeBootStep = computed(
  () => bootProgress.value.find((step) => step.status === "active") ?? bootProgress.value.at(-1),
);
const currentPageId = ref<string>("");
const currentPluginId = ref<string | null>(null);
const currentChatId = ref<string | null>(null);
/** Desktop side dock: the chat sits beside the main pane instead of replacing it. */
const dockChatId = ref<string | null>(null);
const graphOpen = ref(false);
const requestedMode = ref<ViewModeId | null>(null);
const mode = computed<ViewModeId>(() => requestedMode.value ?? "write");
const plugins = usePlugins();
const {
  open: paletteOpen,
  show: showPalette,
  hide: hidePalette,
  toggle: togglePalette,
} = useSearchPalette();
/** Sidebar drawer state (mobile only). */
const navOpen = ref(false);
/** Desktop gets a resizable splitter, while mobile keeps the drawer. The query
 *  mirrors `--breakpoint-md` in tokens.css (mobile <= 48rem, desktop above). */
const isDesktop = useMediaQuery("(min-width: 48.0625rem)");

const nav = useNavHistory();
const { visible: appBarVisible, toggle: toggleAppBar } = useAppBar();

const { t } = useI18n();

// Back closes the drawer and the palette before it navigates or leaves.
useBackLayer(navOpen);
useBackLayer(paletteOpen, hidePalette);

/** Name of the workspace being opened, for the switching pill. */
const switchingName = computed(
  () => workspaces.value.find((entry) => entry.id === switching.value)?.name ?? null,
);

/** Desktop sidebar collapse. Reka-ui persists the collapsed layout, so the
 *  initial state is read from the panel rather than assumed. */
const navPanel = useTemplateRef<InstanceType<typeof SplitterPanel>>("navPanel");
const sidebarCollapsed = ref(false);

function syncSidebarCollapsed() {
  const panel = navPanel.value;
  if (panel) sidebarCollapsed.value = (panel.getSize() ?? 0) === 0;
}

onMounted(() => nextTick(syncSidebarCollapsed));
watch(isDesktop, (desktop) => {
  if (desktop) {
    nextTick(syncSidebarCollapsed);

    return;
  }

  // Narrow windows have no dock. Keep the thread open as the full pane.
  if (dockChatId.value) {
    currentChatId.value = dockChatId.value;
    dockChatId.value = null;
    syncRoute("replace");
  }
});

function toggleSidebar() {
  const panel = navPanel.value;
  if (!panel) return;

  if (sidebarCollapsed.value) {
    sidebarCollapsed.value = false;
    panel.expand();
  } else {
    sidebarCollapsed.value = true;
    panel.collapse();
  }
}

const { ensure: ensureSearch } = useSearch();
const chat = useChat();
const appUpdates = useAppUpdates();

// Cmd-K / Ctrl-K opens the search palette.
onCapturedKey(
  (event) => (event.metaKey || event.ctrlKey) && event.key === "K",
  (event) => {
    event.preventDefault();
    togglePalette();
  },
);

/**
 * Back and forward, on the chords browsers and editors use. The desktop shell
 * has no browser to do it, and in a browser tab Alt-ArrowLeft is the browser's
 * own back, which would navigate twice.
 */
function isNavChord(event: KeyboardEvent, direction: "back" | "forward"): boolean {
  if (event.ctrlKey || event.shiftKey) return false;

  if (event.altKey && !event.metaKey) {
    return event.key === (direction === "back" ? "ArrowLeft" : "ArrowRight");
  }

  if (!isMac() || !event.metaKey || event.altKey) return false;

  // `code` keeps the bracket chords working on layouts where the key is
  // something else.
  return event.code === (direction === "back" ? "BracketLeft" : "BracketRight");
}

for (const direction of ["back", "forward"] as const) {
  onCapturedKey(
    (event) => isTauri() && isNavChord(event, direction),
    (event) => {
      // The settings fields and the plugin studio install CodeMirror's default
      // keymap, where these arrows walk the syntax tree and the brackets
      // reindent. The capture phase gets here first, so the carve-out has to.
      if ((event.target as HTMLElement | null)?.closest(".cm-editor")) return;

      event.preventDefault();
      if (direction === "back") nav.goBack();
      else nav.goForward();
    },
  );
}

// Cmd-J / Ctrl-J hides the app bar for the editor's full height.
onCapturedKey(
  (event) =>
    (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === "j",
  (event) => {
    event.preventDefault();
    toggleAppBar();
  },
);

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

testApi.openPage = (id) => openPage(id);
testApi.setMode = (value) => void setMode(value as ViewModeId);
testApi.openGraph = () => openGraph();
testApi.openChat = (threadId) => openChat(threadId ?? undefined);
testApi.newChat = async (pageId) => (await chat.startThread({ pageId: pageId ?? null })).id;
testApi.sendChat = (threadId, text) => chat.send(threadId, text);
testApi.chatMessages = (threadId) => chat.readMessages(threadId);
testApi.setAiStub = (provider) => {
  setProviderOverride(provider);
};

// Section metadata should stay fresh even without the editor being open:
// the store's page changes drive a re-extract on every page switch.
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

onMounted(async () => {
  await ensure();
  loaded.value = true;

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

  // A ?view=plugin:<instance>, ?view=chat:<thread>, or ?view=graph link reopens that pane.
  const linkedView = queryString(viewQuery.value);
  if (linkedView === "graph") graphOpen.value = true;
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

  // Normalize the URL so the first entry carries the resolved state, and back
  // from a later page then restores this one instead of an empty query.
  syncRoute("replace");

  setPluginNavigation({ openPage, openPlugin });
  setChatNavigation({ openChat, openPage });

  // Dev-only handles for the e2e suite. Production builds drop them.
  testApi.openPlugin = openPlugin;
  testApi.installPlugin = async (pluginId) => {
    await plugins.install(pluginId);

    return plugins.instances.value.find((candidate) => candidate.pluginId === pluginId)?.id ?? "";
  };
  testApi.pluginStatus = (id, kind) =>
    plugins.stateOf(id, kind as PluginSurfaceKind)?.status ?? null;
  testApi.pluginHtml = (id, kind) => plugins.stateOf(id, kind as PluginSurfaceKind)?.html ?? "";
  testApi.pluginAction = (id, kind, name, args = {}, fields = {}) =>
    plugins.dispatch(id, kind as PluginSurfaceKind, {
      id: crypto.randomUUID(),
      name,
      args,
      fields,
    });
  testApi.pluginWindowOpen = (id) => plugins.windowOf(id).open;
  testApi.pluginState = async (id) => (await workspace.value?.readPluginState(id)) ?? {};
  testApi.writeWorkspaceFile = async (path, text) => {
    await useWorkspace().backend.value?.write(path, new TextEncoder().encode(text));
  };
  testApi.exportPage = async (pageId, options) => {
    if (!store) throw new Error("no workspace");

    const { base, files } = await buildExport(store, pageId, {
      html: false,
      pdf: false,
      svg: false,
      svgMerged: false,
      project: true,
      fonts: false,
      theme: "light",
      pageSize: "a4",
      ...options,
    });

    return { base, files: bundleTextFiles(files) };
  };
  testApi.compileBundle = (files, entry) =>
    compileBundle(files, entry, workspace.value?.workspaceId ?? "bundle");
  testApi.refreshPlugins = () => plugins.refreshCatalog();
  testApi.pluginLogs = () =>
    plugins.logs.value.map((entry) =>
      `${entry.kind} ${entry.pluginId ?? ""} ${entry.message}`.trim(),
    );
});

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

/** One `?view=` value, so only one of the graph/chat/plugin panes is open. */
function paneViewValue(): string {
  if (currentChatId.value) return `chat:${currentChatId.value}`;
  if (currentPluginId.value) return `plugin:${currentPluginId.value}`;
  if (graphOpen.value) return "graph";

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
  if (sameQuery(query)) return;

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

// Back/forward or a pasted link changes the open pane under us.
watch(viewQuery, (raw) => {
  if (!loaded.value) return;

  const value = queryString(raw);
  if (value === "graph") {
    currentChatId.value = null;
    currentPluginId.value = null;
    graphOpen.value = true;

    return;
  }

  if (value.startsWith("chat:")) {
    const id = value.slice("chat:".length);
    if (workspace.value?.getChat(id)) {
      currentChatId.value = id;
      currentPluginId.value = null;
      graphOpen.value = false;
    } else if (queryString(viewQuery.value) === value) {
      viewQuery.value = "";
    }

    return;
  }

  if (value.startsWith("plugin:")) {
    const id = value.slice("plugin:".length);
    currentChatId.value = null;
    graphOpen.value = false;
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
  navOpen.value = false; // drawer interactions close after selection
  currentPluginId.value = null; // opening a page leaves the other panes
  currentChatId.value = null;
  graphOpen.value = false;
  // An empty id means the open page was deleted. Fall back to home/first.
  currentPageId.value = id || fallbackPageId();
  syncRoute(historyMode);
}

/** Sidebar and toolbar search buttons: close the drawer, open the palette. */
function openSearch() {
  navOpen.value = false;
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
  navOpen.value = false;
  if (!instanceId) return;

  // Window-only plugins (drawing) float. Pane plugins take the main pane. A
  // local plugin's manifest may not be in the catalog yet, so hold the id and
  // retry when it arrives instead of opening a blank pane.
  const kinds = plugins.surfacesOf(instanceId).map((surface) => surface.kind);
  if (!kinds.length) {
    if (workspace.value?.getPluginInstance(instanceId)) pendingPluginId.value = instanceId;
    return;
  }

  if (kinds.includes("pane")) {
    const historyMode = takeLayerHistory();
    currentChatId.value = null;
    graphOpen.value = false;
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

/** The sidebar opens the workspace graph. The links panel roots it at the page. */
function openGraph(rootAtPage = false) {
  const historyMode = takeLayerHistory();
  navOpen.value = false;
  currentPluginId.value = null;
  currentChatId.value = null;
  graphOpen.value = true;

  // A graph opened from a page is about that page. Turn local mode on so the
  // root is real, not just implied by the header chip.
  if (rootAtPage && currentPageId.value) {
    const store = workspace.value;
    const graph = store?.getSettings().graph;
    if (store && graph && !graph.local) store.updateSettings({ graph: { ...graph, local: true } });
  }

  syncRoute(historyMode);
}

function closeGraph() {
  graphOpen.value = false;
  syncRoute("replace");
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
  navOpen.value = false;

  const open = (id: string) => {
    if (isDesktop.value) {
      currentChatId.value = null;
      dockChatId.value = id;
    } else {
      currentPluginId.value = null;
      graphOpen.value = false;
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

/** Moves the docked thread into the main pane. */
function expandDock() {
  const id = dockChatId.value;
  if (!id) return;

  dockChatId.value = null;
  currentPluginId.value = null;
  graphOpen.value = false;
  currentChatId.value = id;
  syncRoute("replace");
}

// Persist pending snapshot writes when the tab goes away.
useEventListener("pagehide", () => {
  void workspace.value?.flush();
});

async function setMode(value: ViewModeId) {
  requestedMode.value = value === "write" ? null : value;
  syncRoute("replace");
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
        <img class="app__splash-mark" :src="iconUrl" alt="" />
        <h1 class="app__splash-title">Typbase</h1>
        <div class="app__splash-bar" aria-hidden="true"><span /></div>
        <p class="app__splash-step">
          {{ activeBootStep?.label ?? $t("boot.title") }}
          <template v-if="activeBootStep?.detail"> · {{ activeBootStep.detail }}</template>
        </p>
        <p v-if="bootNote" class="app__splash-note">{{ bootNote }}</p>
        <p v-if="error" class="app__splash-error">{{ error }}</p>
      </div>
    </Transition>

    <StorageSetup v-if="loaded && storageSetup" :setup="storageSetup" />

    <template v-if="loaded && !storageSetup && workspace">
      <div
        :key="workspaceGeneration"
        class="app__content"
        :class="{ 'app__content--switching': switching }"
        :aria-busy="switching ? true : undefined"
        :inert="switching ? true : undefined"
      >
        <!-- Window-level chrome. Narrow windows keep the mobile layout whole,
             so the bar goes with them rather than eating the editor's height. -->
        <AppBar
          v-if="isDesktop && appBarVisible"
          :store="workspace"
          :back-label="backLabel"
          :forward-label="forwardLabel"
          :sidebar-visible="!sidebarCollapsed"
          @open-page="openPage"
          @toggle-sidebar="toggleSidebar"
        />

        <div class="app__body">
          <SplitterGroup
            v-if="isDesktop"
            direction="horizontal"
            auto-save-id="typbase:sidebar"
            class="app__splitter"
          >
            <SplitterPanel
              ref="navPanel"
              class="app__nav-panel"
              size-unit="px"
              :default-size="264"
              :min-size="200"
              :max-size="480"
              collapsible
              :collapsed-size="0"
              @collapse="sidebarCollapsed = true"
              @expand="sidebarCollapsed = false"
              @resize="syncSidebarCollapsed"
            >
              <Sidebar
                :store="workspace"
                :current-page-id="currentPageId"
                @select="openPage"
                @open-plugin="openPlugin"
                @search="openSearch"
                @chat="openChat"
                @graph="openGraph"
                @collapse-request="toggleSidebar"
              />
            </SplitterPanel>

            <SplitterResizeHandle
              v-show="!sidebarCollapsed"
              class="app__resize-handle"
              :aria-label="$t('sidebar.resizeSidebar')"
            />

            <SplitterPanel class="app__main-panel" :default-size="76">
              <div class="app__main">
                <MainPane
                  :page-id="currentPageId"
                  :plugin-instance-id="currentPluginId"
                  :chat-thread-id="currentChatId"
                  :graph-open="graphOpen"
                  :dock-chat-id="isDesktop ? dockChatId : null"
                  :model-value="mode"
                  @update:model-value="setMode"
                  @open-page="openPage"
                  @open-plugin="openPlugin"
                  @close-plugin="closePlugin"
                  @open-thread="openChat"
                  @close-chat="closeChat"
                  @close-dock="closeDock"
                  @expand-dock="expandDock"
                  @open-graph="openGraph(true)"
                  @close-graph="graphOpen = false"
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
                </MainPane>
              </div>
            </SplitterPanel>
          </SplitterGroup>

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
                @select="openPage"
                @open-plugin="openPlugin"
                @search="openSearch"
                @chat="openChat"
                @graph="openGraph"
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
                :model-value="mode"
                @update:model-value="setMode"
                @open-page="openPage"
                @open-plugin="openPlugin"
                @close-plugin="closePlugin"
                @open-thread="openChat"
                @close-chat="closeChat"
                @open-graph="openGraph(true)"
                @close-graph="closeGraph"
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
              </MainPane>
            </div>
          </template>

          <PluginWindows />
        </div>

        <SearchPalette
          v-if="paletteOpen && workspace"
          :store="workspace"
          @open="openSearchResult"
          @close="hidePalette"
        />
      </div>
    </template>

    <div v-if="loaded && !storageSetup && !workspace" class="app__chooser">
      <WorkspaceSwitcher mode="screen" />
    </div>

    <UpdateDialog />
  </main>
</template>

<style>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

/* The shell is a column: the app bar, then the panes. The content div owns the
   dim and the inert state while a workspace switches, which its children used to
   cover when it was `display: contents`. */
.app__content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app__body {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* Workspace switch feedback: a floating status pill over the dimmed, inert
   content area (see .app__content--switching). */
.app__switching {
  position: fixed;
  top: calc(var(--space-3-5) + var(--safe-top));
  left: 50%;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3-5);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.18);
  pointer-events: none;
  animation: app-switching-in var(--motion-fast);
  transform: translateX(-50%);
}

.app__switching-spinner {
  width: calc(0.95rem * var(--ui-size));
  height: calc(0.95rem * var(--ui-size));
  flex: none;
  border: 2px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: app-switching-spin 0.7s linear infinite;
}

.app__switching-label {
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
}

@keyframes app-switching-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes app-switching-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(var(--space-1) * -1));
  }

  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

.app__content--switching > * {
  pointer-events: none;
  opacity: 0.7;
  transition: opacity var(--motion-fast);
}

.app__chooser {
  flex: 1;
  display: grid;
  place-content: center;
  padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
}

.app__main {
  position: relative;
  min-width: 0;
}

/* Desktop layout: the sidebar panel is px-sized, so it keeps its width when
   the window resizes and only the main panel flexes. */
.app__splitter {
  flex: 1;
  min-width: 0;
}

.app__nav-panel .sidebar {
  border-right: 0;
}

.app__main-panel .app__main {
  height: 100%;
}

.app__resize-handle {
  width: 6px;
  flex: 0 0 6px;
  position: relative;
  cursor: col-resize;
  outline: none;
}

.app__resize-handle::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  background: var(--color-border);
}

.app__resize-handle:hover::before,
.app__resize-handle:focus-visible::before,
.app__resize-handle[data-resize-handle-active]::before {
  width: 3px;
  background: var(--color-accent);
}

/* Mobile: sidebar becomes a drawer below the breakpoint. The nav toggle lives
   in the toolbar flow (MainPane slot), so it pushes content rather than
   floating over it.

   The desktop variant renders whenever the desktop shell does. Its icon and
   label flip with the sidebar state so it can collapse and expand. */
.app__main .app__nav-toggle,
.app__backdrop {
  display: none;
}

.app__main .app__nav-toggle--desktop {
  display: inline-flex;
  padding: var(--space-1-5) var(--space-2);
}

.app__main .app__nav-toggle:focus-visible,
.app__main .app__nav-toggle--desktop:focus-visible {
  background: var(--color-surface-2);
}

@media (max-width: 48rem) {
  .app__main .app__nav-toggle {
    display: inline-flex;
  }

  .app__nav {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 60;
    width: min(84vw, 320px);
    transform: translateX(-100%);
    transition: transform var(--motion-base);
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
  }

  .app__nav--open {
    transform: translateX(0);
  }

  .app__backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 55;
    background: var(--color-overlay);
    border: none;
  }
}

.app__splash {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--space-4);
  padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
  background: var(--color-surface);
  color: var(--color-text);
  user-select: none;
}

.app__splash-mark {
  width: 3.5rem;
  height: 3.5rem;
  display: block;
}

.app__splash-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.app__splash-bar {
  position: relative;
  width: 11rem;
  height: 3px;
  overflow: hidden;
  background: var(--color-border);
  border-radius: var(--radius-full);
}

.app__splash-bar span {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background: var(--color-accent);
  border-radius: inherit;
  animation: app-splash-slide 1.1s ease-in-out infinite;
}

@keyframes app-splash-slide {
  0% {
    left: -40%;
  }

  100% {
    left: 100%;
  }
}

.app__splash-step {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.app__splash-note {
  max-width: 26rem;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  text-align: center;
}

.app__splash-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}

.splash-leave-active {
  transition: opacity var(--motion-slow);
}

.splash-leave-to {
  opacity: 0;
}

.app__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
  background: var(--color-surface);
}
</style>
