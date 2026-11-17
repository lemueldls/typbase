import type { TypstState } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type { ChatMessage, PluginSurfaceKind } from "@typbase/typing";

import type { AiProvider } from "~/lib/ai/providers";
import type { ExportOptions } from "~/lib/exportPage";
import type { WorkspaceExportOptions } from "~/lib/exportWorkspace";
import type { SearchResultItem, SearchStatus } from "~/lib/search";

import { bundleTextFiles, compileBundle } from "~/lib/bundleCheck";
import { buildExport } from "~/lib/exportPage";
import { buildWorkspaceExport } from "~/lib/exportWorkspace";
import { buildSite, siteBaseUrl } from "~/lib/site/build";
import { testApi } from "~/lib/testApi";

import type { usePlugins } from "./plugins";

export interface PageTestApiOptions {
  workspace: Ref<WorkspaceStore | undefined>;
  plugins: ReturnType<typeof usePlugins>;
  openPage: (id: string) => void;
  setMode: (mode: string) => void;
  searchStatus: () => SearchStatus | null;
  searchQuery: (text: string) => Promise<SearchResultItem[]>;
  openGraph: () => void;
  openChat: (threadId?: string | null) => void;
  newChat: (pageId?: string | null) => Promise<string>;
  sendChat: (threadId: string, text: string) => Promise<void>;
  chatMessages: (threadId: string) => Promise<ChatMessage[]>;
  setAiStub: (provider: AiProvider | null) => void;
  openPlugin: (id: string) => void;
  openSite: () => void;
  siteDid: () => string | null;
  writeFile: (path: string, text: string) => Promise<void>;
  typstState: () => Promise<TypstState>;
}

/**
 * Wires the dev-only `window.__typbase` handle to the shell. It lives in its
 * own module so the page keeps the app behavior instead of a hundred lines of
 * e2e fixtures. Production builds never expose the handle, so the assignments
 * are unreachable there.
 */
export function bindPageTestApi(options: PageTestApiOptions): void {
  testApi.openPage = options.openPage;
  testApi.setMode = (value) => options.setMode(value);
  testApi.searchStatus = () => options.searchStatus();
  testApi.searchQuery = (text) => options.searchQuery(text);
  testApi.openGraph = () => options.openGraph();
  testApi.openChat = (threadId) => options.openChat(threadId ?? undefined);
  testApi.newChat = (pageId) => options.newChat(pageId ?? null);
  testApi.sendChat = (threadId, text) => options.sendChat(threadId, text);
  testApi.chatMessages = (threadId) => options.chatMessages(threadId);
  testApi.setAiStub = (provider) => options.setAiStub(provider);

  const store = options.workspace.value;
  if (!store) return;

  testApi.openPlugin = options.openPlugin;
  testApi.openSite = options.openSite;
  testApi.siteState = () => store.getSiteSettings();
  testApi.siteBuild = async (siteOptions = {}) => {
    const site = store.getSiteSettings();
    const did = options.siteDid();
    const build = await buildSite(store, site, {
      baseUrl: siteOptions.baseUrl ?? siteBaseUrl(site, did),
      did,
    });
    const readable = new Map(bundleTextFiles(build.files).map((file) => [file.name, file.text]));

    return {
      hash: build.hash,
      files: build.files.map((file) => ({
        name: file.name,
        size: file.bytes.length,
        text: readable.get(file.name),
      })),
      pages: build.pages.map((page) => ({ id: page.id, title: page.title, url: page.url })),
    };
  };
  testApi.installPlugin = async (pluginId) => {
    await options.plugins.install(pluginId);

    return (
      options.plugins.instances.value.find((candidate) => candidate.pluginId === pluginId)?.id ?? ""
    );
  };
  testApi.pluginStatus = (id, kind) =>
    options.plugins.stateOf(id, kind as PluginSurfaceKind)?.status ?? null;
  testApi.pluginHtml = (id, kind) =>
    options.plugins.stateOf(id, kind as PluginSurfaceKind)?.html ?? "";
  testApi.pluginAction = (id, kind, name, args = {}, fields = {}) =>
    options.plugins.dispatch(id, kind as PluginSurfaceKind, {
      id: crypto.randomUUID(),
      name,
      args,
      fields,
    });
  testApi.pluginWindowOpen = (id) => options.plugins.windowOf(id).open;
  testApi.pluginState = async (id) => (await options.workspace.value?.readPluginState(id)) ?? {};
  testApi.writeWorkspaceFile = (path, text) => options.writeFile(path, text);
  testApi.exportPage = async (pageId, exportOptions) => {
    const { base, files } = await buildExport(store, pageId, {
      html: false,
      pdf: false,
      svg: false,
      svgMerged: false,
      project: true,
      fonts: false,
      theme: "light",
      pageSize: "a4",
      ...(exportOptions as Partial<ExportOptions>),
    });

    return { base, files: bundleTextFiles(files) };
  };
  testApi.exportWorkspace = async (pageIds, exportOptions) => {
    const typstState = await options.typstState();
    const { name, files } = await buildWorkspaceExport(
      store,
      pageIds,
      {
        html: false,
        pdf: false,
        svg: false,
        svgMerged: true,
        project: false,
        stripMarkers: false,
        fonts: false,
        theme: "light",
        pageSize: "a4",
        separate: true,
        combined: false,
        ...(exportOptions as Partial<WorkspaceExportOptions>),
      } as WorkspaceExportOptions,
      typstState,
    );

    const readable = new Map(bundleTextFiles(files).map((file) => [file.name, file.text]));

    return {
      name,
      files: files.map((file) => ({
        name: file.name,
        size: file.bytes.length,
        text: readable.get(file.name),
      })),
    };
  };
  testApi.compileBundle = (files, entry) =>
    compileBundle(files, entry, options.workspace.value?.workspaceId ?? "bundle");
  testApi.refreshPlugins = () => options.plugins.refreshCatalog();
  testApi.pluginLogs = () =>
    options.plugins.logs.value.map((entry) =>
      `${entry.kind} ${entry.pluginId ?? ""} ${entry.message}`.trim(),
    );
}
