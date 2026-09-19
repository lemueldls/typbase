import type {
  PluginAction,
  PluginCapability,
  PluginContext,
  PluginInstall,
  PluginInstance,
  PluginManifest,
  PluginPatch,
} from "@typbase/typing";

import type { PluginSurfacePackage } from "~/lib/plugins/protocol";

import { resolveAppTheme } from "~/composables/theme";
import { useTypst } from "~/composables/typst";
import { useWorkspace } from "~/composables/workspace";
import { createProviderFor, refreshSections, toSections } from "~/lib/ai/generators";
import { getAiKeys } from "~/lib/ai/keys";
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
import { sanitizePluginHtml } from "~/lib/plugins/sanitize";
import { resolveRequestPayloads } from "~/lib/typstRequests";

export interface PluginError {
  at: number;
  pluginId?: string;
  instanceId?: string;
  message: string;
}

export type PluginLogKind = "info" | "error" | "action" | "render" | "patch";

export interface PluginLogEntry {
  at: number;
  kind: PluginLogKind;
  pluginId?: string;
  instanceId?: string;
  message: string;
}

interface NavigationHooks {
  openPage: (pageId: string) => void;
  openPlugin: (instanceId: string) => void;
}

const navigation: NavigationHooks = { openPage: () => {}, openPlugin: () => {} };

/** The shell registers how plugin actions reach app navigation. */
export function setPluginNavigation(hooks: Partial<NavigationHooks>): void {
  Object.assign(navigation, hooks);
}

let pluginCurrentPageId: string | null = null;

/** The shell reports the open page so plugin context can include it. */
export function setPluginCurrentPage(id: string | null): void {
  pluginCurrentPageId = id;
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

function usePluginHost() {
  const { workspace, backend, localState, dataRevision } = useWorkspace();
  const { locale } = useI18n();

  const catalog = shallowRef<CatalogPlugin[]>(loadBundledCatalog());
  const errors = ref<PluginError[]>([]);
  const logs = ref<PluginLogEntry[]>([]);
  const htmlByInstance = new Map<string, string>();
  const subscriptions = new Map<string, Set<(html: string) => void>>();
  const docUnsubscribes = new Map<string, () => void>();
  const renderQueues = new Map<string, Promise<void>>();
  const views = shallowRef<Record<string, Record<string, unknown>>>({});
  let viewsLoaded = false;
  let fallbackLogged = false;

  /** Diagnostics for the plugin lab; newest first, capped. */
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

    log({
      kind: "info",
      message: `catalog refreshed: ${catalog.value.length} plugin(s), ${local.length} local`,
    });
  }

  watch(backend, () => void refreshCatalog(), { immediate: true });

  // Plugin source or data changes rebuild every mounted surface.
  watch(pluginsRevision, () => {
    for (const instanceId of subscriptions.keys()) void renderInstance(instanceId);
  });

  const installs = computed<PluginInstall[]>(() => {
    void dataRevision.value;
    return workspace.value?.listPluginInstalls() ?? [];
  });

  const instances = computed<PluginInstance[]>(() => {
    void dataRevision.value;
    return workspace.value?.listPluginInstances() ?? [];
  });

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

  function clearErrors(): void {
    errors.value = [];
  }

  function manifestOf(pluginId: string): PluginManifest | undefined {
    const bundled = catalog.value.find((entry) => entry.manifest.id === pluginId);
    if (bundled) return bundled.manifest;

    const record = workspace.value?.getPluginInstall(pluginId);
    if (!record) return undefined;
    try {
      return JSON.parse(record.manifest) as PluginManifest;
    } catch {
      return undefined;
    }
  }

  async function install(pluginId: string): Promise<void> {
    const store = workspace.value;
    const entry = catalog.value.find((candidate) => candidate.manifest.id === pluginId);
    if (!store || !entry) return;

    store.setPluginInstall({
      id: entry.manifest.id,
      version: entry.manifest.version,
      enabled: true,
      source: entry.source,
      installedAt: Date.now(),
      manifest: JSON.stringify(entry.manifest),
    });

    for (const surface of entry.manifest.surfaces) {
      await store.createPluginInstance({
        pluginId: entry.manifest.id,
        surface: surface.kind,
        title: surface.title,
        icon: surface.icon ?? entry.manifest.icon,
      });
    }
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
      pushError({ message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const store = workspace.value;
    const record = store?.getPluginInstall(pluginId);
    if (!store || !record) return;

    store.setPluginInstall({ ...record, enabled });
  }

  async function createInstance(
    pluginId: string,
    surfaceKind?: PluginInstance["surface"],
  ): Promise<void> {
    const store = workspace.value;
    const manifest = manifestOf(pluginId);
    if (!store || !manifest) return;

    const surface =
      manifest.surfaces.find((candidate) => candidate.kind === surfaceKind) ?? manifest.surfaces[0];
    if (!surface) return;

    await store.createPluginInstance({
      pluginId,
      surface: surface.kind,
      title: surface.title,
      icon: surface.icon ?? manifest.icon,
    });
  }

  async function removeInstance(instanceId: string): Promise<void> {
    const store = workspace.value;
    if (!store) return;

    releaseInstance(instanceId);
    await store.deletePluginInstance(instanceId);
  }

  function releaseInstance(instanceId: string): void {
    subscriptions.delete(instanceId);
    htmlByInstance.delete(instanceId);
    docUnsubscribes.get(instanceId)?.();
    docUnsubscribes.delete(instanceId);
  }

  // ---- device-local view state -------------------------------------------

  async function loadViews(): Promise<void> {
    const local = localState.value;
    if (!local || viewsLoaded) return;
    viewsLoaded = true;

    try {
      views.value = (await local.get<Record<string, Record<string, unknown>>>("pluginViews")) ?? {};
    } catch {
      views.value = {};
    }

    // Surfaces may have rendered before device state was loaded.
    for (const instanceId of subscriptions.keys()) void renderInstance(instanceId);
  }

  watch(localState, () => void loadViews());
  void loadViews();

  function applyView(instanceId: string, patch: Record<string, unknown>): void {
    views.value = {
      ...views.value,
      [instanceId]: { ...(views.value[instanceId] ?? {}), ...patch },
    };

    const local = localState.value;
    if (local) void local.set("pluginViews", views.value);
  }

  // ---- rendering ----------------------------------------------------------

  function subscribe(instanceId: string, listener: (html: string) => void): () => void {
    let listeners = subscriptions.get(instanceId);
    if (!listeners) {
      listeners = new Set();
      subscriptions.set(instanceId, listeners);
    }
    listeners.add(listener);

    if (!docUnsubscribes.has(instanceId)) {
      const store = workspace.value;
      if (store) {
        void store
          .onPluginDocChange(instanceId, () => void renderInstance(instanceId))
          .then((off) => {
            if (subscriptions.has(instanceId)) docUnsubscribes.set(instanceId, off);
            else off();
          });
      }
    }

    const cached = htmlByInstance.get(instanceId);
    if (cached !== undefined) listener(cached);
    else void renderInstance(instanceId);

    return () => {
      const set = subscriptions.get(instanceId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) releaseInstance(instanceId);
    };
  }

  /** Queues a render so actions and doc echoes never compile concurrently. */
  function renderInstance(instanceId: string, action?: PluginAction): Promise<void> {
    const previous = renderQueues.get(instanceId) ?? Promise.resolve();
    const next = previous
      .catch(() => {
        // a failed render must not stall the queue
      })
      .then(() => doRender(instanceId, action));
    renderQueues.set(instanceId, next);

    return next;
  }

  async function doRender(instanceId: string, action?: PluginAction): Promise<void> {
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
      pushError({ instanceId, pluginId: instance.pluginId, message: "plugin sources missing" });
      return;
    }

    const manifest = entry.manifest;
    const surface =
      manifest.surfaces.find((candidate) => candidate.kind === instance.surface) ??
      manifest.surfaces[0];
    if (!surface) return;

    const settings = store.getSettings();
    const state = await store.readPluginState(instanceId);
    const canReadPages = manifest.capabilities.includes("pages.read");

    const ctx: PluginContext = {
      plugin: { id: manifest.id, name: manifest.name, version: manifest.version },
      instance: { id: instance.id, title: instance.title, surface: instance.surface },
      locale: locale.value,
      now: new Date().toISOString(),
      today: todayISO(),
      config: parseConfig(instance),
      state,
      view: views.value[instanceId] ?? {},
      action: action ? { ...action, fields: action.fields ?? {} } : null,
      page: canReadPages && pluginCurrentPageId ? { id: pluginCurrentPageId } : null,
      data: canReadPages
        ? {
            pages: store.listPages(),
            categories: store.listCategories(),
            daily: store.listPages().filter((page) => page.path.startsWith("daily/")),
          }
        : null,
    };

    try {
      const started = performance.now();
      const sources = plain([{ path: UI_LIBRARY_PATH, text: uiLibrarySource }, ...entry.sources]);
      const files: { path: string; bytes: Uint8Array }[] = [];
      const packages: PluginSurfacePackage[] = [];
      let result = await compilePluginSurface({
        spaceId: store.workspaceId,
        slug: entry.slug,
        entry: manifest.entry,
        fn: surface.fn,
        sources,
        files,
        packages,
        ctx: plain(ctx),
        style: plain({
          font: settings.font,
          mathFont: settings.mathFont,
          codeFont: settings.codeFont,
          textSize: settings.textSize,
          palette: resolveAppTheme(settings).palette,
        }),
      });

      // Answer `#typbase.query`/`#typbase.embed` requests like notes do, then
      // recompile with the resolved sources and files.
      for (let pass = 0; pass < 8 && result.requests.length > 0; pass++) {
        const payloads = await resolveRequestPayloads(result.requests, store, pluginCurrentPageId, {
          pluginId: manifest.id,
          allowPages: canReadPages,
        });
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

        result = await compilePluginSurface({
          spaceId: store.workspaceId,
          slug: entry.slug,
          entry: manifest.entry,
          fn: surface.fn,
          sources,
          files,
          packages,
          ctx: plain(ctx),
          style: plain({
            font: settings.font,
            mathFont: settings.mathFont,
            codeFont: settings.codeFont,
            textSize: settings.textSize,
            palette: resolveAppTheme(settings).palette,
          }),
        });
      }

      const duration = Math.round(performance.now() - started);

      log({
        kind: "render",
        instanceId,
        pluginId: manifest.id,
        message: `${surface.fn} via ${result.engine ?? "?"} in ${duration}ms (${result.html.length}b)`,
      });

      if (result.engine === "local" && result.fallbackReason && !fallbackLogged) {
        fallbackLogged = true;
        log({
          kind: "info",
          instanceId,
          pluginId: manifest.id,
          message: `plugin worker unavailable, compiling on the main thread: ${result.fallbackReason}`,
        });
      }

      for (const diagnostic of result.diagnostics as Array<{
        severity?: string;
        message?: string;
      }>) {
        if (diagnostic.severity === "error") {
          pushError({
            instanceId,
            pluginId: manifest.id,
            message: diagnostic.message ?? "compile error",
          });
        }
      }

      if (result.requests.length) {
        pushError({
          instanceId,
          pluginId: manifest.id,
          message: `unresolved plugin imports: ${result.requests.map((request) => String(request.value)).join(", ")}`,
        });
      }

      const sanitized = sanitizePluginHtml(result.html);
      for (const error of sanitized.errors) {
        pushError({ instanceId, pluginId: manifest.id, message: error });
      }

      if (sanitized.patch) {
        const validated = validatePatch(sanitized.patch as PluginPatch, manifest);
        for (const error of validated.errors) {
          pushError({ instanceId, pluginId: manifest.id, message: error });
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
        }
      }

      if (sanitized.html === htmlByInstance.get(instanceId)) return;
      htmlByInstance.set(instanceId, sanitized.html);
      for (const listener of subscriptions.get(instanceId) ?? []) listener(sanitized.html);
    } catch (error) {
      pushError({
        instanceId,
        pluginId: manifest.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ---- actions ------------------------------------------------------------

  async function dispatch(instanceId: string, action: PluginAction): Promise<void> {
    log({
      kind: "action",
      instanceId,
      message: `${action.name} ${JSON.stringify(action.args ?? {})}`.slice(0, 240),
    });

    if (action.name.startsWith("app.")) {
      await handleBuiltin(instanceId, action);
      return;
    }

    await renderInstance(instanceId, action);
  }

  function capabilityOf(instanceId: string, capability: PluginCapability): boolean {
    const store = workspace.value;
    const instance = store?.getPluginInstance(instanceId);
    const manifest = instance ? manifestOf(instance.pluginId) : undefined;

    return manifest?.capabilities.includes(capability) ?? false;
  }

  async function handleBuiltin(instanceId: string, action: PluginAction): Promise<void> {
    const store = workspace.value;
    if (!store) return;

    switch (action.name) {
      case "app.open-page": {
        if (!capabilityOf(instanceId, "pages.read")) return deny(instanceId, "pages.read");
        const id = String(action.args.id ?? action.fields?.id ?? "");
        if (id) navigation.openPage(id);
        return;
      }

      case "app.create-page": {
        if (!capabilityOf(instanceId, "pages.create")) return deny(instanceId, "pages.create");
        const title = String(action.fields?.title ?? action.args.title ?? "Untitled");
        const page = await store.createPage({ title });
        navigation.openPage(page.id);
        return;
      }

      case "app.create-daily": {
        if (!capabilityOf(instanceId, "daily.write")) return deny(instanceId, "daily.write");
        const date = String(action.args.date ?? action.fields?.date ?? todayISO());
        const page = await store.createDailyNote(date);
        navigation.openPage(page.id);
        return;
      }

      case "app.open-plugin":
      case "app.open-instance": {
        const explicit = String(action.args.instanceId ?? "");
        if (explicit && store.getPluginInstance(explicit)) {
          navigation.openPlugin(explicit);
          return;
        }

        const pluginId = String(action.args.pluginId ?? "");
        const surface = String(action.args.surface ?? "main") as PluginInstance["surface"];
        const instance = store
          .listPluginInstances()
          .find((candidate) => candidate.pluginId === pluginId && candidate.surface === surface);
        if (instance) navigation.openPlugin(instance.id);
        return;
      }

      case "app.link": {
        const href = String(action.args.href ?? "");
        if (href.startsWith("typbase://page/")) {
          if (!capabilityOf(instanceId, "pages.read")) return deny(instanceId, "pages.read");
          navigation.openPage(href.slice("typbase://page/".length));
          return;
        }
        if (href.startsWith("typbase://plugin/")) {
          const id = href.slice("typbase://plugin/".length);
          if (store.getPluginInstance(id)) navigation.openPlugin(id);
          return;
        }
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
          if (!capabilityOf(instanceId, "ui.external")) return deny(instanceId, "ui.external");
          if (window.confirm(`Open external link?\n\n${href}`)) {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        }
        return;
      }

      case "app.page-append": {
        if (!capabilityOf(instanceId, "pages.write")) return deny(instanceId, "pages.write");
        const text = String(action.args.text ?? action.fields?.text ?? "");
        if (!text) return;

        const explicitId = String(action.args.pageId ?? "");
        const date = String(action.args.date ?? "");
        const page = explicitId
          ? store.getPage(explicitId)
          : date
            ? await store.createDailyNote(date)
            : undefined;
        if (!page) {
          pushError({ instanceId, message: "page-append: no page" });
          return;
        }

        const current = await store.loadPageText(page.id);
        const separator = current.endsWith("\n") || current === "" ? "" : "\n";
        const next = `${current}${separator}${text}\n`;
        await store.setPageText(page.id, next);

        // Sections feed flashcards and the note index; refresh them now so
        // plugins see fresh content without a page switch.
        const typstState = await useTypst().catch(() => null);
        if (typstState) {
          await refreshSections(store, page.id, next, (source) =>
            toSections(typstState.extractSections(source), source),
          );
        }
        bumpPluginsRevision();
        return;
      }

      case "app.external": {
        if (!capabilityOf(instanceId, "ui.external")) return deny(instanceId, "ui.external");
        const url = String(action.args.url ?? "");
        if (
          /^(https?:|mailto:|tel:)/i.test(url) &&
          window.confirm(`Open external link?\n\n${url}`)
        ) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }

      case "app.ai": {
        if (!capabilityOf(instanceId, "plugin.ai")) return deny(instanceId, "plugin.ai");
        await runAi(instanceId, action);
        return;
      }

      default:
        pushError({ instanceId, message: `unknown host action "${action.name}"` });
    }
  }

  function deny(instanceId: string, capability: PluginCapability): void {
    pushError({ instanceId, message: `action denied: missing capability "${capability}"` });
  }

  async function runAi(instanceId: string, action: PluginAction): Promise<void> {
    const store = workspace.value;
    if (!store) return;

    const followUp = (args: Record<string, unknown>) =>
      renderInstance(instanceId, {
        id: crypto.randomUUID(),
        name: "ai.result",
        args: { request: action.id, ...args },
        fields: {},
      });

    if (!store.getAiConfig().enabled) {
      await followUp({ error: "AI features are disabled in settings." });
      return;
    }

    try {
      const provider = createProviderFor(store, getAiKeys());
      let prompt = String(action.args.prompt ?? action.fields?.prompt ?? "");
      const pageId = String(action.fields?.pageId ?? action.args.pageId ?? "");
      if (pageId && capabilityOf(instanceId, "pages.read")) {
        const text = await store.loadPageText(pageId);
        prompt = `${prompt}\n\n---\n${text}`;
      }

      const text = await provider.chat([
        {
          role: "system",
          content:
            "You are a typbase plugin assistant. Answer with plain text or JSON exactly as the prompt requests.",
        },
        { role: "user", content: prompt },
      ]);
      await followUp({ text });
    } catch (error) {
      await followUp({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Workspace changes (install, theme, pages) refresh every mounted surface.
  watch(dataRevision, () => {
    for (const instanceId of subscriptions.keys()) void renderInstance(instanceId);
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
    installFromFolder,
    refreshCatalog,
    uninstall,
    htmlOf: (instanceId: string) => htmlByInstance.get(instanceId) ?? "",
    setEnabled,
    createInstance,
    removeInstance,
    instanceById: (id: string) => workspace.value?.getPluginInstance(id),
    manifestOf,
    subscribe,
    dispatch,
    renderInstance,
    clearErrors,
  };
}

export const usePlugins = createSharedComposable(usePluginHost);
