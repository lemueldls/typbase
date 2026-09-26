import type {
  PluginAction,
  PluginActionResult,
  PluginCapability,
  PluginContext,
  PluginInstall,
  PluginInstance,
  PluginManifest,
  PluginPatch,
  PluginSurface,
  PluginSurfaceKind,
} from "@typbase/typing";

import { PLUGIN_API } from "@typbase/typing";

import type { PluginSurfacePackage } from "~/lib/plugins/protocol";

import { useChat } from "~/composables/chat";
import { resolveAppTheme } from "~/composables/theme";
import { pushToast } from "~/composables/toasts";
import { useTypst } from "~/composables/typst";
import { useWorkspace } from "~/composables/workspace";
import { completeForPlugin } from "~/lib/ai/engine";
import { engineAvailable } from "~/lib/engineHealth";
import { openExternal } from "~/lib/openExternal";
import { specString } from "~/lib/packages";
import {
  loadBundledCatalog,
  loadLocalCatalog,
  type CatalogPlugin,
  UI_LIBRARY_PATH,
  uiLibrarySource,
} from "~/lib/plugins/catalog";
import { compilePluginSurface, pluginEngine, resetPluginEngine } from "~/lib/plugins/engine";
import { importPluginFolder } from "~/lib/plugins/folderImport";
import { validatePatch } from "~/lib/plugins/manifest";
import {
  bumpPluginsRevision,
  pluginsRevision,
  registerPluginSources,
} from "~/lib/plugins/registry";
import { sanitizeHtml } from "~/lib/plugins/sanitize";
import { refreshSections, toSections } from "~/lib/sections";
import { resolveRequestPayloads } from "~/lib/typstRequests";

export interface PluginError {
  at: number;
  pluginId: string;
  instanceId?: string;
  surface?: PluginSurfaceKind;
  message: string;
  /** Virtual path when a compile diagnostic points into a plugin file. */
  file?: string;
  /** 1-based line in `file`. */
  line?: number;
}

export type PluginLogKind = "info" | "error" | "action" | "render" | "patch";

export interface PluginLogEntry {
  at: number;
  kind: PluginLogKind;
  pluginId?: string;
  instanceId?: string;
  message: string;
}

/** What a surface shows: sanitized HTML, plugin styles, or an error. */
export interface PluginSurfaceState {
  status: "ok" | "error";
  html: string;
  styles: string[];
  error?: string;
}

/** Device-local floating-window geometry, keyed by instance id. */
export interface PluginWindowPlacement {
  open: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

interface NavigationHooks {
  openPage: (pageId: string) => void;
  openPlugin: (instanceId: string) => void;
}

const navigation: NavigationHooks = {
  openPage: () => {},
  openPlugin: () => {},
};

/** The shell registers how plugin actions reach app navigation. */
export function setPluginNavigation(hooks: Partial<NavigationHooks>): void {
  Object.assign(navigation, hooks);
}

let pluginCurrentPageId: string | null = null;

/** The shell reports the open page so plugin context can include it. */
export function setPluginCurrentPage(id: string | null): void {
  if (pluginCurrentPageId === id) return;
  pluginCurrentPageId = id;
  // Surfaces read `ctx.page`; a page switch has to rebuild them or a window
  // keeps offering actions against the page that was open when it rendered.
  bumpPluginsRevision();
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseConfig(instance: PluginInstance): Record<string, unknown> {
  try {
    const value = JSON.parse(instance.config) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const DEFAULT_WINDOW_SIZE = { width: 620, height: 480 };

export function usePluginHost() {
  const { workspace, backend, localState, dataRevision, pluginFilesRevision } = useWorkspace();
  const { locale } = useI18n();
  // Plugin AI actions go through the chat runtime; instantiate it so the
  // engine deps exist even when no chat pane is open (for example /debug).
  useChat();

  const catalog = shallowRef<CatalogPlugin[]>(loadBundledCatalog());
  const errors = ref<PluginError[]>([]);
  const logs = ref<PluginLogEntry[]>([]);
  const renderStates = new Map<string, PluginSurfaceState>();
  const listeners = new Map<string, Set<(state: PluginSurfaceState) => void>>();
  const docUnsubscribes = new Map<string, () => void>();
  const renderQueues = new Map<string, Promise<void>>();
  /** One in-flight `ai.stream` per plugin instance; a new one aborts the old. */
  const aiStreams = new Map<string, AbortController>();
  const views = shallowRef<Record<string, Record<string, unknown>>>({});
  const windows = ref<Record<string, PluginWindowPlacement>>({});
  let viewsLoaded = false;
  let windowsLoaded = false;
  let fallbackLogged = false;
  let windowZ = 1;
  let windowSaveTimer: ReturnType<typeof setTimeout> | undefined;

  const keyOf = (instanceId: string, kind: PluginSurfaceKind): string => `${instanceId}:${kind}`;

  /** Diagnostics for the plugin studio; newest first, capped. */
  function log(entry: Omit<PluginLogEntry, "at">): void {
    logs.value = [{ at: Date.now(), ...entry }, ...logs.value].slice(0, 200);
  }

  function clearLogs(): void {
    logs.value = [];
  }

  /**
   * postMessage uses structured clone, which rejects Vue reactive proxies.
   * Every payload crossing to the plugin worker goes through this.
   */
  function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function manifestOf(pluginId: string): PluginManifest | undefined {
    const entry = catalog.value.find((candidate) => candidate.manifest.id === pluginId);
    if (entry) return entry.manifest;

    const record = workspace.value?.getPluginInstall(pluginId);
    if (!record) return undefined;
    try {
      return JSON.parse(record.manifest) as PluginManifest;
    } catch {
      return undefined;
    }
  }

  /** Local copies win: forking a bundled plugin is how it becomes editable. */
  async function refreshCatalog(): Promise<void> {
    const bundled = loadBundledCatalog();
    const local = await loadLocalCatalog(backend.value);
    const localIds = new Set(local.map((entry) => entry.manifest.id));
    catalog.value = [...local, ...bundled.filter((entry) => !localIds.has(entry.manifest.id))];

    // Notes import plugin modules through the request channel; keep the
    // served copy in sync with what surfaces compile against.
    registerPluginSources([
      { path: UI_LIBRARY_PATH, text: uiLibrarySource },
      ...catalog.value.flatMap((entry) => entry.sources),
    ]);
    bumpPluginsRevision();

    await dropLegacyInstalls();

    log({
      kind: "info",
      message: `catalog refreshed: ${catalog.value.length} plugin(s), ${local.length} local`,
    });
  }

  /**
   * v1 installs (one instance per surface, `api: typbase.host.v1`) are not
   * readable by this runtime. Removing them also removes their orphaned
   * instance docs.
   */
  async function dropLegacyInstalls(): Promise<void> {
    const store = workspace.value;
    if (!store) return;

    for (const record of store.listPluginInstalls()) {
      if (!catalog.value.some((entry) => entry.manifest.id === record.id)) continue;
      let api = "";
      try {
        api = (JSON.parse(record.manifest) as { api?: string }).api ?? "";
      } catch {
        api = "";
      }
      if (api && api !== PLUGIN_API) {
        log({ kind: "info", message: `removed v1 install ${record.id}` });
        await store.uninstallPlugin(record.id);
      }
    }
  }

  watch(backend, () => void refreshCatalog(), { immediate: true });

  // External edits under `plugins/` (an editor outside the app) reload the
  // catalog; saves from the studio call refreshCatalog directly.
  watch(pluginFilesRevision, () => void refreshCatalog());

  // Plugin source or data changes rebuild every mounted surface.
  watch(pluginsRevision, () => {
    for (const key of [...listeners.keys()]) {
      const separator = key.lastIndexOf(":");
      void renderInstance(key.slice(0, separator), key.slice(separator + 1) as PluginSurfaceKind);
    }
  });

  const installs = computed<PluginInstall[]>(() => {
    void dataRevision.value;
    return workspace.value?.listPluginInstalls() ?? [];
  });

  const instances = computed<PluginInstance[]>(() => {
    void dataRevision.value;
    return workspace.value?.listPluginInstances() ?? [];
  });

  function surfacesOf(instanceId: string): PluginSurface[] {
    const instance = workspace.value?.getPluginInstance(instanceId);
    if (!instance) return [];

    return manifestOf(instance.pluginId)?.surfaces ?? [];
  }

  function surfaceOf(instanceId: string, kind: PluginSurfaceKind): PluginSurface | undefined {
    return surfacesOf(instanceId).find((surface) => surface.kind === kind);
  }

  /** Instances of enabled plugins that declare a surface of this kind. */
  function instancesWithSurface(kind: PluginSurfaceKind): PluginInstance[] {
    void dataRevision.value;

    return instances.value.filter((instance) => {
      const enabled = installs.value.find((record) => record.id === instance.pluginId)?.enabled;
      return enabled && surfacesOf(instance.id).some((surface) => surface.kind === kind);
    });
  }

  /** Manifest-declared host components for one instance. */
  function hostComponentsOf(instanceId: string): string[] {
    const instance = workspace.value?.getPluginInstance(instanceId);
    if (!instance) return [];

    return manifestOf(instance.pluginId)?.hostComponents ?? [];
  }

  function pushError(error: Omit<PluginError, "at">): void {
    errors.value = [{ at: Date.now(), ...error }, ...errors.value].slice(0, 50);
    log({
      kind: "error",
      instanceId: error.instanceId,
      pluginId: error.pluginId,
      message: error.message,
    });
    console.warn(`[plugins] ${error.message}`);
  }

  function clearErrors(pluginId?: string): void {
    errors.value = pluginId ? errors.value.filter((error) => error.pluginId !== pluginId) : [];
  }

  function errorsFor(pluginId: string): PluginError[] {
    return errors.value.filter((error) => error.pluginId === pluginId);
  }

  async function install(pluginId: string): Promise<void> {
    const store = workspace.value;
    const entry = catalog.value.find((candidate) => candidate.manifest.id === pluginId);
    if (!store || !entry || store.getPluginInstall(pluginId)) return;

    store.setPluginInstall({
      id: entry.manifest.id,
      version: entry.manifest.version,
      enabled: true,
      source: entry.source,
      installedAt: Date.now(),
      manifest: JSON.stringify(entry.manifest),
    });

    await store.createPluginInstance({
      pluginId: entry.manifest.id,
      title: entry.manifest.name,
      icon: entry.manifest.icon,
    });
  }

  /** Adds an independent instance, with its own data doc, for a plugin. */
  async function addInstance(pluginId: string): Promise<void> {
    const store = workspace.value;
    const manifest = manifestOf(pluginId);
    if (!store || !manifest) return;

    const count = store.listPluginInstances().filter((i) => i.pluginId === pluginId).length;

    await store.createPluginInstance({
      pluginId: manifest.id,
      title: count === 0 ? manifest.name : `${manifest.name} ${count + 1}`,
      icon: manifest.icon,
    });
  }

  async function uninstall(pluginId: string): Promise<void> {
    const store = workspace.value;
    if (!store) return;

    for (const instance of store.listPluginInstances()) {
      if (instance.pluginId === pluginId) releaseInstance(instance.id);
    }

    await store.uninstallPlugin(pluginId);
  }

  /** Copies a picked folder into workspace storage, then installs it. */
  async function installFromFolder(): Promise<void> {
    const active = backend.value;
    if (!active) return;

    try {
      const manifest = await importPluginFolder(active);
      if (!manifest) return;
      await refreshCatalog();
      await install(manifest.id);
    } catch (error) {
      pushError({
        pluginId: "import",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const store = workspace.value;
    const record = store?.getPluginInstall(pluginId);
    if (!store || !record) return;

    store.setPluginInstall({ ...record, enabled });
  }

  async function removeInstance(instanceId: string): Promise<void> {
    const store = workspace.value;
    if (!store) return;

    releaseInstance(instanceId);
    closeWindow(instanceId);
    await store.deletePluginInstance(instanceId);
  }

  /** Renames one instance; the sidebar row, window title, and manager show it. */
  async function renameInstance(instanceId: string, title: string): Promise<void> {
    const store = workspace.value;
    const trimmed = title.trim();
    if (!store || !trimmed) return;

    await store.updatePluginInstance(instanceId, { title: trimmed });
    rerenderInstance(instanceId);
  }

  function releaseInstance(instanceId: string): void {
    for (const key of [...listeners.keys()]) {
      if (key.startsWith(`${instanceId}:`)) {
        listeners.delete(key);
        renderStates.delete(key);
      }
    }
    docUnsubscribes.get(instanceId)?.();
    docUnsubscribes.delete(instanceId);
  }

  async function loadViews(): Promise<void> {
    const local = localState.value;
    if (!local || viewsLoaded) return;
    viewsLoaded = true;

    try {
      const stored =
        (await local.get<Record<string, Record<string, unknown>>>("pluginViews")) ?? {};
      // In-memory patches win: surfaces can render before device state loads.
      views.value = { ...stored, ...views.value };
    } catch {
      views.value = {};
    }

    // Surfaces may have rendered before device state was loaded.
    for (const key of [...listeners.keys()]) {
      const separator = key.lastIndexOf(":");
      void renderInstance(key.slice(0, separator), key.slice(separator + 1) as PluginSurfaceKind);
    }
  }

  async function loadWindows(): Promise<void> {
    const local = localState.value;
    if (!local || windowsLoaded) return;
    windowsLoaded = true;

    try {
      const stored =
        (await local.get<Record<string, PluginWindowPlacement>>("pluginWindows")) ?? {};
      // A window opened before local state loaded must keep its placement.
      windows.value = { ...stored, ...windows.value };
    } catch {
      windows.value = {};
    }
  }

  watch(localState, () => {
    void loadViews();
    void loadWindows();
  });
  void loadViews();
  void loadWindows();

  function persistWindows(): void {
    const local = localState.value;
    if (!local) return;
    if (windowSaveTimer) clearTimeout(windowSaveTimer);
    windowSaveTimer = setTimeout(() => {
      windowSaveTimer = undefined;
      void local.set("pluginWindows", windows.value);
    }, 400);
  }

  function applyView(instanceId: string, patch: Record<string, unknown>): void {
    views.value = {
      ...views.value,
      [instanceId]: { ...(views.value[instanceId] ?? {}), ...patch },
    };

    const local = localState.value;
    if (local) void local.set("pluginViews", views.value);
  }

  function viewOf(instanceId: string): Record<string, unknown> {
    return views.value[instanceId] ?? {};
  }

  function resetView(instanceId: string): void {
    views.value = { ...views.value, [instanceId]: {} };

    const local = localState.value;
    if (local) void local.set("pluginViews", views.value);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function windowOf(instanceId: string): PluginWindowPlacement {
    const existing = windows.value[instanceId];
    if (existing) return existing;

    const openCount = Object.values(windows.value).filter((placement) => placement.open).length;

    return {
      open: false,
      x: 96 + (openCount % 6) * 32,
      y: 80 + (openCount % 6) * 32,
      width: DEFAULT_WINDOW_SIZE.width,
      height: DEFAULT_WINDOW_SIZE.height,
      z: 1,
    };
  }

  function writeWindow(instanceId: string, placement: PluginWindowPlacement): void {
    windows.value = { ...windows.value, [instanceId]: placement };
    persistWindows();
  }

  function openWindow(instanceId: string): void {
    const current = windowOf(instanceId);
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
    const width = Math.min(current.width, Math.max(320, viewportWidth - 16));
    const height = Math.min(current.height, Math.max(240, viewportHeight - 96));

    writeWindow(instanceId, {
      ...current,
      open: true,
      width,
      height,
      x: clamp(current.x, 8, Math.max(8, viewportWidth - width - 8)),
      y: clamp(current.y, 8, Math.max(8, viewportHeight - height - 8)),
      z: ++windowZ,
    });
  }

  function closeWindow(instanceId: string): void {
    const current = windows.value[instanceId];
    if (!current) return;
    writeWindow(instanceId, { ...current, open: false });
  }

  function focusWindow(instanceId: string): void {
    const current = windowOf(instanceId);
    if (current.z === windowZ) return;
    writeWindow(instanceId, { ...current, z: ++windowZ });
  }

  function moveWindow(instanceId: string, x: number, y: number): void {
    const current = windowOf(instanceId);
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;

    writeWindow(instanceId, {
      ...current,
      x: clamp(x, -current.width + 80, viewportWidth - 80),
      y: clamp(y, 0, viewportHeight - 48),
    });
  }

  function resizeWindow(instanceId: string, width: number, height: number): void {
    const current = windowOf(instanceId);
    writeWindow(instanceId, {
      ...current,
      width: clamp(width, 320, 1600),
      height: clamp(height, 200, 1400),
    });
  }

  function subscribe(
    instanceId: string,
    kind: PluginSurfaceKind,
    listener: (state: PluginSurfaceState) => void,
  ): () => void {
    const key = keyOf(instanceId, kind);
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(listener);

    if (!docUnsubscribes.has(instanceId)) {
      const store = workspace.value;
      if (store) {
        void store
          .onPluginDocChange(instanceId, () => {
            for (const surface of surfacesOf(instanceId)) {
              if (listeners.has(keyOf(instanceId, surface.kind))) {
                void renderInstance(instanceId, surface.kind);
              }
            }
          })
          .then((off) => {
            if (listeners.has(keyOf(instanceId, kind))) docUnsubscribes.set(instanceId, off);
            else off();
          });
      }
    }

    const cached = renderStates.get(key);
    if (cached !== undefined) listener(cached);
    else void renderInstance(instanceId, kind);

    return () => {
      const current = listeners.get(key);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          listeners.delete(key);
          renderStates.delete(key);
        }
      }
      if (![...listeners.keys()].some((entry) => entry.startsWith(`${instanceId}:`))) {
        docUnsubscribes.get(instanceId)?.();
        docUnsubscribes.delete(instanceId);
      }
    };
  }

  /** Queues a render so actions and doc echoes never compile concurrently. */
  function renderInstance(
    instanceId: string,
    kind: PluginSurfaceKind,
    action?: PluginAction,
    result?: PluginActionResult | null,
  ): Promise<void> {
    const key = keyOf(instanceId, kind);
    const previous = renderQueues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => {
        // a failed render must not stall the queue
      })
      .then(() => doRender(instanceId, kind, action, result));
    renderQueues.set(key, next);

    return next;
  }

  /** Re-renders the instance's mounted surfaces; unmounted ones render on
   *  mount, and their stale cache entries were dropped by the patch. */
  function rerenderInstance(instanceId: string): void {
    for (const slot of surfacesOf(instanceId)) {
      if (listeners.has(keyOf(instanceId, slot.kind))) {
        void renderInstance(instanceId, slot.kind);
      }
    }
  }

  async function doRender(
    instanceId: string,
    kind: PluginSurfaceKind,
    action?: PluginAction,
    result?: PluginActionResult | null,
  ): Promise<void> {
    const store = workspace.value;
    if (!store) return;

    const instance = store.getPluginInstance(instanceId);
    if (!instance) {
      releaseInstance(instanceId);
      return;
    }

    const entry = catalog.value.find((candidate) => candidate.manifest.id === instance.pluginId);
    const record = store.getPluginInstall(instance.pluginId);
    if (!entry || !record) {
      pushError({
        instanceId,
        pluginId: instance.pluginId,
        surface: kind,
        message: "plugin sources missing",
      });
      return;
    }

    const manifest = entry.manifest;
    const surface = manifest.surfaces.find((candidate) => candidate.kind === kind);
    if (!surface) return;

    const key = keyOf(instanceId, kind);
    const styles = entry.styles.map((style) => style.text);
    const settings = store.getSettings();
    const state = await store.readPluginState(instanceId);
    const canReadPages = manifest.capabilities.includes("pages.read");

    const ctx: PluginContext = {
      plugin: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
      },
      instance: {
        id: instance.id,
        title: instance.title,
      },
      surface: { kind: surface.kind, title: surface.title },
      locale: locale.value,
      now: new Date().toISOString(),
      today: todayISO(),
      config: parseConfig(instance),
      state,
      view: views.value[instanceId] ?? {},
      action: action ? { ...action, fields: action.fields ?? {} } : null,
      result: result ?? null,
      page: canReadPages && pluginCurrentPageId ? { id: pluginCurrentPageId } : null,
      data: canReadPages
        ? {
            pages: store.listPages(),
            categories: store.listCategories(),
            daily: store.listPages().filter((page) => page.path.startsWith("daily/")),
          }
        : null,
      theme: resolveAppTheme(settings).palette as unknown as Record<string, string>,
    };

    try {
      const started = performance.now();
      const sources = plain([{ path: UI_LIBRARY_PATH, text: uiLibrarySource }, ...entry.sources]);
      const files: { path: string; bytes: Uint8Array }[] = [];
      const packages: PluginSurfacePackage[] = [];
      const style = plain({
        font: settings.font,
        mathFont: settings.mathFont,
        codeFont: settings.codeFont,
        textSize: settings.textSize,
        palette: resolveAppTheme(settings).palette,
      });

      let compiled = await compilePluginSurface({
        spaceId: store.workspaceId,
        slug: entry.slug,
        entry: manifest.entry,
        fn: surface.fn,
        sources,
        styles,
        files,
        packages,
        ctx: plain(ctx),
        style,
      });

      // Answer `#typbase.query`/`#typbase.embed` requests like notes do, then
      // recompile with the resolved sources and files.
      for (let pass = 0; pass < 8 && compiled.requests.length > 0; pass++) {
        const payloads = await resolveRequestPayloads(
          compiled.requests,
          store,
          pluginCurrentPageId,
          {
            pluginId: manifest.id,
            allowPages: canReadPages,
          },
        );
        let added = false;
        for (const payload of payloads) {
          if (payload.type === "source") {
            if (!sources.some((source) => source.path === payload.path)) {
              sources.push({ path: payload.path, text: payload.text });
              added = true;
            }
          } else if (payload.type === "package") {
            if (!packages.some((pkg) => specString(pkg.spec) === specString(payload.spec))) {
              packages.push({ spec: payload.spec, bytes: payload.bytes });
              added = true;
            }
          } else if (!files.some((file) => file.path === payload.path)) {
            files.push({ path: payload.path, bytes: payload.bytes });
            added = true;
          }
        }
        if (!added) break;

        compiled = await compilePluginSurface({
          spaceId: store.workspaceId,
          slug: entry.slug,
          entry: manifest.entry,
          fn: surface.fn,
          sources,
          styles,
          files,
          packages,
          ctx: plain(ctx),
          style,
        });
      }

      const duration = Math.round(performance.now() - started);

      log({
        kind: "render",
        instanceId,
        pluginId: manifest.id,
        message: `${surface.fn} via ${compiled.engine ?? "?"} in ${duration}ms (${compiled.html.length}b)`,
      });

      if (compiled.engine === "local" && compiled.fallbackReason && !fallbackLogged) {
        fallbackLogged = true;
        log({
          kind: "info",
          instanceId,
          pluginId: manifest.id,
          message: `plugin worker unavailable, compiling on the main thread: ${compiled.fallbackReason}`,
        });
      }

      const diagnostics = compiled.diagnostics as Array<{
        severity?: string;
        message?: string;
        file?: string;
        line?: number;
      }>;
      const compileErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      for (const diagnostic of compileErrors) {
        pushError({
          instanceId,
          pluginId: manifest.id,
          surface: kind,
          message: diagnostic.message ?? "compile error",
          file: diagnostic.file,
          line: diagnostic.line,
        });
      }

      if (compiled.requests.length) {
        pushError({
          instanceId,
          pluginId: manifest.id,
          surface: kind,
          message: `unresolved plugin imports: ${compiled.requests.map((request) => String(request.value)).join(", ")}`,
        });
      }

      // A broken plugin shows its error instead of the recovery render; the
      // editor's partial-input recovery has no place on a plugin surface.
      if (compileErrors.length) {
        const first = compileErrors[0]!;
        const site = first.file ? ` (${first.file}:${first.line ?? 1})` : "";
        publish(key, {
          status: "error",
          html: "",
          styles,
          error: `${first.message ?? "compile error"}${site}`,
        });
        return;
      }

      const sanitized = sanitizeHtml(compiled.html);
      for (const error of sanitized.errors) {
        pushError({ instanceId, pluginId: manifest.id, surface: kind, message: error });
      }

      let patched = false;
      let statePatched = false;
      if (sanitized.patch) {
        const validated = validatePatch(sanitized.patch as PluginPatch, manifest);
        for (const error of validated.errors) {
          pushError({ instanceId, pluginId: manifest.id, surface: kind, message: error });
        }
        if (validated.patch.state?.length) {
          log({
            kind: "patch",
            instanceId,
            pluginId: manifest.id,
            message: validated.patch.state
              .map((op) => `${op.op}:${op.collection}`)
              .join(", ")
              .slice(0, 200),
          });
          await store.applyPluginPatch(instanceId, validated.patch.state);
          patched = true;
          statePatched = true;
          // Notes embedding this plugin's data recompile; other surfaces
          // re-render through the revision watcher.
          bumpPluginsRevision();
        }
        if (validated.patch.view && Object.keys(validated.patch.view).length) {
          log({
            kind: "patch",
            instanceId,
            pluginId: manifest.id,
            message: `view ${JSON.stringify(validated.patch.view).slice(0, 160)}`,
          });
          applyView(instanceId, validated.patch.view);
          patched = true;
        }
      }

      if (patched) {
        // This render predates the patch. Drop the cached HTML for every
        // surface of the instance so a surface that mounts later compiles the
        // patched state instead of replaying stale markup. State patches go
        // through the revision watcher; a view-only patch has no revision to
        // wait for, so the instance's mounted surfaces re-render here.
        for (const slot of manifest.surfaces) {
          renderStates.delete(keyOf(instanceId, slot.kind));
        }
        if (!statePatched) rerenderInstance(instanceId);
        return;
      }

      publish(key, { status: "ok", html: sanitized.html, styles });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushError({ instanceId, pluginId: manifest.id, surface: kind, message });
      publish(key, { status: "error", html: "", styles, error: message });
    }
  }

  function publish(key: string, next: PluginSurfaceState): void {
    const previous = renderStates.get(key);
    if (
      previous &&
      previous.status === next.status &&
      previous.html === next.html &&
      previous.error === next.error &&
      previous.styles.length === next.styles.length &&
      previous.styles.every((style, index) => style === next.styles[index])
    ) {
      return;
    }

    renderStates.set(key, next);
    for (const listener of listeners.get(key) ?? []) listener(next);
  }

  function stateOf(instanceId: string, kind: PluginSurfaceKind): PluginSurfaceState | undefined {
    return renderStates.get(keyOf(instanceId, kind));
  }

  async function dispatch(
    instanceId: string,
    kind: PluginSurfaceKind,
    action: PluginAction,
  ): Promise<void> {
    log({
      kind: "action",
      instanceId,
      message: `${action.name} ${JSON.stringify(action.args ?? {})}`.slice(0, 240),
    });

    if (action.name.startsWith("app.") || action.name.startsWith("ai.")) {
      const result = await handleBuiltin(instanceId, action);
      if (!result.rerender) await renderInstance(instanceId, kind, action, result);
      return;
    }

    await renderInstance(instanceId, kind, action);
  }

  function pluginIdOf(instanceId: string): string {
    return workspace.value?.getPluginInstance(instanceId)?.pluginId ?? "unknown";
  }

  function capabilityOf(instanceId: string, capability: PluginCapability): boolean {
    const store = workspace.value;
    const instance = store?.getPluginInstance(instanceId);
    const manifest = instance ? manifestOf(instance.pluginId) : undefined;

    return manifest?.capabilities.includes(capability) ?? false;
  }

  function deny(instanceId: string, action: PluginAction, capability: PluginCapability) {
    pushError({
      instanceId,
      pluginId: pluginIdOf(instanceId),
      message: `action denied: missing capability "${capability}"`,
    });

    return { action: action.name, ok: false, message: `missing capability "${capability}"` };
  }

  /** Host actions return a result the plugin sees on its next render. */
  async function handleBuiltin(
    instanceId: string,
    action: PluginAction,
  ): Promise<PluginActionResult & { rerender?: boolean }> {
    const store = workspace.value;
    if (!store) return { action: action.name, ok: false, message: "no workspace" };

    switch (action.name) {
      case "app.open-page": {
        if (!capabilityOf(instanceId, "pages.read")) return deny(instanceId, action, "pages.read");
        const id = String(action.args.id ?? action.fields?.id ?? "");
        if (id) navigation.openPage(id);
        return { action: action.name, ok: Boolean(id) };
      }

      case "app.create-page": {
        if (!capabilityOf(instanceId, "pages.create"))
          return deny(instanceId, action, "pages.create");
        const title = String(action.fields?.title ?? action.args.title ?? "Untitled");
        const page = await store.createPage({ title });
        navigation.openPage(page.id);
        return { action: action.name, ok: true, data: { pageId: page.id } };
      }

      case "app.create-daily": {
        if (!capabilityOf(instanceId, "daily.write"))
          return deny(instanceId, action, "daily.write");
        const date = String(action.args.date ?? action.fields?.date ?? todayISO());
        const page = await store.createDailyNote(date);
        navigation.openPage(page.id);
        return { action: action.name, ok: true, data: { pageId: page.id } };
      }

      case "app.open-plugin":
      case "app.open-instance": {
        const explicit = String(action.args.instanceId ?? "");
        if (explicit && store.getPluginInstance(explicit)) {
          navigation.openPlugin(explicit);
          return { action: action.name, ok: true };
        }

        const pluginId = String(action.args.pluginId ?? "");
        const kind = String(action.args.surface ?? "pane") as PluginSurfaceKind;
        const instance = store
          .listPluginInstances()
          .find(
            (candidate) =>
              candidate.pluginId === pluginId &&
              (surfacesOf(candidate.id).some((surface) => surface.kind === kind) ||
                kind === "pane"),
          );
        if (instance) navigation.openPlugin(instance.id);
        return { action: action.name, ok: Boolean(instance) };
      }

      case "app.link": {
        const href = String(action.args.href ?? "");
        if (href.startsWith("typbase://page/")) {
          if (!capabilityOf(instanceId, "pages.read"))
            return deny(instanceId, action, "pages.read");
          navigation.openPage(href.slice("typbase://page/".length));
          return { action: action.name, ok: true };
        }
        if (href.startsWith("typbase://plugin/")) {
          const id = href.slice("typbase://plugin/".length);
          if (store.getPluginInstance(id)) navigation.openPlugin(id);
          return { action: action.name, ok: Boolean(store.getPluginInstance(id)) };
        }
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
          if (!capabilityOf(instanceId, "ui.external"))
            return deny(instanceId, action, "ui.external");
          if (window.confirm(`Open external link?\n\n${href}`)) {
            openExternal(href);
            return { action: action.name, ok: true };
          }
          return { action: action.name, ok: false, message: "cancelled" };
        }
        return { action: action.name, ok: false, message: "unsupported link" };
      }

      case "app.page-append": {
        if (!capabilityOf(instanceId, "pages.write"))
          return deny(instanceId, action, "pages.write");
        const text = String(action.args.text ?? action.fields?.text ?? "");
        if (!text) return { action: action.name, ok: false, message: "nothing to insert" };

        const explicitId = String(action.args.pageId ?? "");
        const date = String(action.args.date ?? "");
        const page = explicitId
          ? store.getPage(explicitId)
          : date
            ? await store.createDailyNote(date)
            : undefined;
        if (!page) {
          pushError({
            instanceId,
            pluginId: pluginIdOf(instanceId),
            message: "page-append: no page",
          });
          return { action: action.name, ok: false, message: "no page" };
        }

        const current = await store.loadPageText(page.id);
        const separator = current.endsWith("\n") || current === "" ? "" : "\n";
        const next = `${current}${separator}${text}\n`;
        await store.setPageText(page.id, next);

        // Sections feed the note index and plugin data; refresh them now so
        // plugins see fresh content without a page switch.
        const typstState = await useTypst().catch(() => null);
        if (typstState) {
          await refreshSections(store, page.id, next, (source) =>
            engineAvailable() ? toSections(typstState.extractSections(source), source) : null,
          );
        }
        bumpPluginsRevision();

        pushToast({
          titleKey: "plugins.appended",
          params: { title: page.title },
          duration: 2200,
        });
        return { action: action.name, ok: true, data: { pageId: page.id } };
      }

      case "app.external": {
        if (!capabilityOf(instanceId, "ui.external"))
          return deny(instanceId, action, "ui.external");
        const url = String(action.args.url ?? "");
        if (
          /^(https?:|mailto:|tel:)/i.test(url) &&
          window.confirm(`Open external link?\n\n${url}`)
        ) {
          openExternal(url);
          return { action: action.name, ok: true };
        }
        return { action: action.name, ok: false, message: "cancelled" };
      }

      case "app.toast": {
        const message = String(action.args.message ?? action.fields?.message ?? "");
        if (!message) return { action: action.name, ok: false, message: "empty toast" };
        pushToast({
          title: message,
          variant: action.args.tone === "danger" ? "danger" : "default",
          duration: 3000,
        });
        return { action: action.name, ok: true };
      }

      case "app.window-open": {
        openWindow(instanceId);
        return { action: action.name, ok: true, rerender: false };
      }

      case "app.window-close": {
        closeWindow(instanceId);
        return { action: action.name, ok: true, rerender: false };
      }

      case "ai.complete":
      case "ai.stream": {
        if (!capabilityOf(instanceId, "plugin.ai")) return deny(instanceId, action, "plugin.ai");
        const kind = surfaceOf(instanceId, "pane") ? "pane" : firstKind(instanceId);
        if (!kind) return { action: action.name, ok: false };
        await runAi(instanceId, kind, action);
        return { action: action.name, ok: true, rerender: false };
      }

      default: {
        pushError({
          instanceId,
          pluginId: pluginIdOf(instanceId),
          message: `unknown host action "${action.name}"`,
        });
        return { action: action.name, ok: false, message: "unknown host action" };
      }
    }
  }

  function firstKind(instanceId: string): PluginSurfaceKind | undefined {
    return surfacesOf(instanceId)[0]?.kind;
  }

  /** Maps a resolved AI call back into the plugin as an `ai.result` render. */
  async function runAi(
    instanceId: string,
    kind: PluginSurfaceKind,
    action: PluginAction,
  ): Promise<void> {
    const store = workspace.value;
    if (!store) return;

    const followUp = (args: Record<string, unknown>) =>
      renderInstance(instanceId, kind, {
        id: crypto.randomUUID(),
        name: "ai.result",
        args: { request: action.id, ...args },
        fields: {},
      });

    if (!store.getAiSettings().enabled) {
      await followUp({ error: "AI features are disabled in settings." });
      return;
    }

    const args = action.args;
    const fields = action.fields ?? {};
    const prompt = String(args.prompt ?? fields.prompt ?? "").trim();
    if (!prompt) {
      await followUp({ error: "ai: prompt is required" });
      return;
    }

    const format = args.format === "typst" ? "typst" : "text";
    const canReadPages = capabilityOf(instanceId, "pages.read");
    const pageId =
      canReadPages && typeof (fields.pageId ?? args.pageId) === "string"
        ? String(fields.pageId ?? args.pageId)
        : null;
    const selection = typeof args.selection === "string" ? args.selection : null;
    const providerId = typeof args.providerId === "string" ? args.providerId : null;
    const model = typeof args.model === "string" ? args.model : null;

    if (action.name === "ai.stream") {
      await runAiStream(instanceId, {
        followUp,
        prompt,
        format,
        pageId,
        selection,
        providerId,
        model,
        collection: String(args.collection ?? fields.collection ?? ""),
        recordId: String(args.id ?? fields.id ?? ""),
        field: String(args.field ?? fields.field ?? "text"),
      });
      return;
    }

    try {
      const result = await completeForPlugin({
        store,
        prompt,
        format,
        pageId,
        selection,
        providerId,
        model,
      });
      await followUp({ text: result.text, diagnostics: result.diagnostics });
    } catch (error) {
      await followUp({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Streaming AI calls write the growing text into one plugin record, so a
   * surface can render its own live chat without new protocol. The field is
   * patched on a debounce; `<field>Status` tracks streaming/done/error.
   */
  async function runAiStream(
    instanceId: string,
    input: {
      followUp: (args: Record<string, unknown>) => Promise<void>;
      prompt: string;
      format: "text" | "typst";
      pageId: string | null;
      selection: string | null;
      providerId: string | null;
      model: string | null;
      collection: string;
      recordId: string;
      field: string;
    },
  ): Promise<void> {
    const store = workspace.value;
    if (!store) return;
    if (!input.collection || !input.recordId) {
      await input.followUp({
        error: "ai.stream: collection and id are required",
      });
      return;
    }

    aiStreams.get(instanceId)?.abort();
    const controller = new AbortController();
    aiStreams.set(instanceId, controller);

    const statusField = `${input.field}Status`;
    let passText = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patch = async (): Promise<void> => {
      await store.applyPluginPatch(instanceId, [
        {
          op: "merge",
          collection: input.collection,
          id: input.recordId,
          record: { [input.field]: passText },
        },
      ]);
    };
    const schedule = (): void => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void patch().catch(() => {
          // A deleted record stops the stream from the plugin's side; the
          // completion patch below will recreate nothing.
        });
      }, 150);
    };

    await store.applyPluginPatch(instanceId, [
      {
        op: "merge",
        collection: input.collection,
        id: input.recordId,
        record: { [input.field]: "", [statusField]: "streaming" },
      },
    ]);

    try {
      const result = await completeForPlugin({
        store,
        prompt: input.prompt,
        format: input.format,
        pageId: input.pageId,
        selection: input.selection,
        providerId: input.providerId,
        model: input.model,
        signal: controller.signal,
        onDelta: (delta) => {
          passText += delta;
          schedule();
        },
        onReset: () => {
          passText = "";
          void patch();
        },
      });

      if (timer) clearTimeout(timer);
      await store.applyPluginPatch(instanceId, [
        {
          op: "merge",
          collection: input.collection,
          id: input.recordId,
          record: {
            [input.field]: result.text,
            [statusField]: "done",
            [`${input.field}Diagnostics`]: JSON.stringify(result.diagnostics),
          },
        },
      ]);
      await input.followUp({
        text: result.text,
        diagnostics: result.diagnostics,
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      await store
        .applyPluginPatch(instanceId, [
          {
            op: "merge",
            collection: input.collection,
            id: input.recordId,
            record: {
              [statusField]: "error",
              [`${input.field}Error`]: message,
            },
          },
        ])
        .catch(() => undefined);
      await input.followUp({ error: message });
    } finally {
      if (aiStreams.get(instanceId) === controller) aiStreams.delete(instanceId);
    }
  }

  // Workspace changes (install, theme, pages) refresh every mounted surface.
  watch(dataRevision, () => {
    for (const key of [...listeners.keys()]) {
      const separator = key.lastIndexOf(":");
      void renderInstance(key.slice(0, separator), key.slice(separator + 1) as PluginSurfaceKind);
    }
  });

  return {
    catalog,
    installs,
    instances,
    errors,
    logs,
    engine: pluginEngine,
    resetEngine: resetPluginEngine,
    clearLogs,
    install,
    addInstance,
    installFromFolder,
    refreshCatalog,
    uninstall,
    setEnabled,
    removeInstance,
    renameInstance,
    instanceById: (id: string) => workspace.value?.getPluginInstance(id),
    manifestOf,
    surfacesOf,
    surfaceOf,
    instancesWithSurface,
    hostComponentsOf,
    subscribe,
    stateOf,
    dispatch,
    renderInstance,
    errorsFor,
    clearErrors,
    windows,
    windowOf,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
    viewOf,
    resetView,
  };
}

export const usePlugins = createSharedComposable(usePluginHost);
