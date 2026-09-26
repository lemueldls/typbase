import type { StorageBackend, TauriStorageMode, TauriStorageState } from "@typbase/storage";
import type { WorkspaceInfo } from "@typbase/typing";

import {
  FileSystemAccessBackend,
  LocalState,
  MemoryBackend,
  OPFSBackend,
  TauriBackend,
  WorkspaceRegistry,
  WorkspaceStore,
  configureTauriStorage,
  createId,
  directoryPermission,
  forgetDirectoryHandle,
  isFsaSupported,
  isTauri,
  localStatePath,
  migrateLayout,
  pickDirectory,
  pickTauriDirectory,
  removeWorkspace,
  requestDirectoryPermission,
  storedDirectoryHandle,
  tauriStorageState,
  workspacePath,
} from "@typbase/storage";

import type { AtprotoService, AtprotoStatus } from "~/lib/atproto";

import { initAiKeys, type AiKeyState } from "~/lib/ai/keys";
import { AtprotoService as Atproto } from "~/lib/atproto";
import { withTimeout } from "~/lib/timeout";

const LAST_WORKSPACE_KEY = "typbase:lastWorkspace";
/** Set once the user deletes every workspace, so a reload shows the chooser. */
const WORKSPACES_EMPTY_KEY = "typbase:workspacesEmpty";
/** Browser storage choice: OPFS (default) or a picked folder handle. */
const STORAGE_MODE_KEY = "typbase:storageMode";

export type StorageEnvironment = "native" | "browser" | "opfs" | "memory";

export interface StorageLocation {
  environment: StorageEnvironment;
  /** Localized label for the active root. */
  label: string;
  /** Native root path, picked folder name, or "OPFS". */
  path: string | null;
  canPickFolder: boolean;
}

export interface StorageSetupState {
  environment: "native" | "browser";
  reason: "choose" | "reconnect";
  /** False on first run: the setup screen has no valid state to return to. */
  canCancel: boolean;
  native?: TauriStorageState;
  folderName?: string;
}

export type StorageSetupChoice =
  | { kind: "native"; mode: TauriStorageMode; path?: string }
  | { kind: "native-folder" }
  | { kind: "browser-folder" }
  | { kind: "browser-reconnect" }
  | { kind: "browser-opfs" };

/** Thrown through the boot chain when the setup screen must resolve storage. */
class StorageSetupPending extends Error {
  constructor() {
    super("storage setup required");
    this.name = "StorageSetupPending";
  }
}

// Boot progress. The load gate waits only for storage + the workspace doc;
// the atproto session boots in the background (bootAtproto) bounded by a
// timeout, so a slow OAuth init can never hold the editor hostage.

export type BootStepId = "storage" | "workspace" | "atproto";

export interface BootStepState {
  id: BootStepId;
  label: string;
  status: "pending" | "active" | "done" | "error";
  /** Extra context, e.g. how many pages loaded or why a step failed. */
  detail?: string;
}

interface CursorLike {
  docId: string;
  from: number;
  to: number;
}

function initialBootSteps(t: (key: string) => string): BootStepState[] {
  return [
    { id: "storage", label: t("boot.storage"), status: "pending" },
    { id: "workspace", label: t("boot.workspace"), status: "pending" },
    { id: "atproto", label: t("boot.atproto"), status: "pending" },
  ];
}

/**
 * The origin the atproto layer talks to. On the web that is the page origin.
 * A Tauri production build runs from `tauri://localhost` (or
 * `http://tauri.localhost` on Windows), where there is no server, so it uses
 * the configured deploy URL instead. Tauri dev loads the Nuxt dev server over
 * http and keeps the page origin.
 */
function appUrl(configured: string): string {
  const fallback = configured.replace(/\/$/, "") || "http://localhost:3000";
  const { origin, protocol, hostname } = window.location;
  const isWebOrigin =
    (protocol === "http:" || protocol === "https:") && hostname !== "tauri.localhost";

  return isWebOrigin ? origin.replace(/\/$/, "") : fallback;
}

/**
 * The local workspaces: one Loro workspace doc plus one doc per page per
 * workspace, on whichever backend the platform offers (Tauri commands, a
 * picked folder, OPFS, or memory). Signing in attaches a space to the active
 * workspace; a signing guest keeps the identical pipeline minus atproto.
 *
 * Shared via createSharedComposable: every consumer sees the same active
 * store, and the setup is torn down when the last consumer unmounts.
 * Switching workspaces disposes the previous store service and re-opens the
 * next from the active backend; `workspaceGeneration` is the remount key for
 * the shell.
 */
function useWorkspaceState() {
  const workspace = shallowRef<WorkspaceStore>();
  const localState = shallowRef<LocalState>();
  const error = shallowRef<unknown>();
  const atproto = shallowRef<AtprotoService>();
  const atprotoStatus = ref<AtprotoStatus>({
    signedIn: false,
    syncing: false,
    did: null,
    spaceUri: null,
    pendingUpdates: 0,
    lastExportAt: 0,
    lastImportAt: 0,
    members: [],
    relayConnected: false,
    error: null,
  });
  const atprotoReady = ref(false);
  let ensurePromise: Promise<WorkspaceStore | null> | undefined;

  /** Bumped whenever workspace-level data changes (pages, categories, settings). */
  const dataRevision = ref(0);

  /** Bumped when files under `plugins/` change on disk (studio reload). */
  const pluginFilesRevision = ref(0);

  /** Presence state: peer -> { persona, cursor }. Filled by the relay. */
  const presence = shallowRef(
    new Map<string, { persona: { name: string; color: string }; cursor: CursorLike | null }>(),
  );

  const { t } = useI18n();
  const runtimeConfig = useRuntimeConfig();
  const bootProgress = ref<BootStepState[]>(initialBootSteps((key) => t(key as never)));
  /** Non-fatal boot notes (storage fell back to memory, atproto disabled, ...). */
  const bootNote = ref("");

  const workspaces = ref<WorkspaceInfo[]>([]);
  const activeWorkspaceId = ref<string | null>(null);
  /** Workspace id currently being opened, null when idle. Drives switch UI. */
  const switching = ref<string | null>(null);
  /** Bumped whenever the active workspace changes; key the shell on it. */
  const workspaceGeneration = ref(0);

  const backendRef = shallowRef<StorageBackend>();
  let registry: WorkspaceRegistry | undefined;
  let openingSeq = 0;
  /** Disposer for the active workspace's source watcher, if the backend has one. */
  let unwatchSources: (() => void) | undefined;
  /**
   * Owns the switching overlay. Kept apart from `openingSeq` because
   * `bootAtproto` also bumps that one, which made the overlay's cleanup guard
   * fail and left the pill up forever.
   */
  let switchingSeq = 0;
  let disposed = false;
  /** The picked browser folder, kept so permission can be re-requested. */
  let folderHandle: FileSystemDirectoryHandle | null = null;

  const storageSetup = shallowRef<StorageSetupState>();
  const storageLocation = shallowRef<StorageLocation>({
    environment: "memory",
    label: "Temporary session",
    path: null,
    canPickFolder: false,
  });

  onScopeDispose(() => {
    disposed = true;
    atproto.value?.dispose();
    void workspace.value?.flush();
    void localState.value?.flush();
  });

  function updateBootStep(id: BootStepId, patch: Partial<BootStepState>): void {
    bootProgress.value = bootProgress.value.map((step) =>
      step.id === id ? { ...step, ...patch } : step,
    );
  }

  function nativeLocation(state: TauriStorageState): StorageLocation {
    const keys: Record<TauriStorageMode, string> = {
      app: "storage.modeApp",
      device: "storage.modeDevice",
      custom: "storage.modeCustom",
    };

    return {
      environment: "native",
      label: t(keys[state.mode] as never),
      path: state.root,
      canPickFolder: state.canPickFolder,
    };
  }

  function browserFolderLocation(handle: FileSystemDirectoryHandle): StorageLocation {
    return {
      environment: "browser",
      label: t("storage.modeFolder" as never),
      path: handle.name,
      canPickFolder: true,
    };
  }

  function opfsLocation(): StorageLocation {
    return {
      environment: "opfs",
      label: t("storage.modeBrowser" as never),
      path: "OPFS",
      canPickFolder: isFsaSupported(),
    };
  }

  /** Browser boot: a picked folder when one is authorized, else OPFS. */
  async function openBrowserBackend(): Promise<StorageBackend> {
    const mode = localStorage.getItem(STORAGE_MODE_KEY);

    if (mode === "folder" && isFsaSupported()) {
      const handle = await storedDirectoryHandle();
      if (handle) {
        if ((await directoryPermission(handle)) === "granted") {
          folderHandle = handle;
          storageLocation.value = browserFolderLocation(handle);

          return new FileSystemAccessBackend(handle);
        }

        // The handle survived but needs a fresh permission gesture.
        storageSetup.value = {
          environment: "browser",
          reason: "reconnect",
          canCancel: false,
          folderName: handle.name,
        };

        throw new StorageSetupPending();
      }
      // The handle is gone (cleared site data); fall back to OPFS.
      localStorage.removeItem(STORAGE_MODE_KEY);
    }

    const backend = await OPFSBackend.open();

    // First run in a Chromium browser gets the same choice as the desktop
    // shell. Existing data or a previous choice skips straight to OPFS.
    const hasData =
      (await backend.read("workspaces.json")) !== null ||
      (await backend.read(workspacePath("local"))) !== null ||
      localStorage.getItem(LAST_WORKSPACE_KEY) !== null ||
      localStorage.getItem(WORKSPACES_EMPTY_KEY) !== null;

    if (!mode && !hasData && isFsaSupported()) {
      storageSetup.value = {
        environment: "browser",
        reason: "choose",
        canCancel: false,
      };
      throw new StorageSetupPending();
    }

    storageLocation.value = opfsLocation();

    return backend;
  }

  async function ensureBackend(): Promise<StorageBackend> {
    if (backendRef.value) return backendRef.value;

    updateBootStep("storage", { status: "active" });

    try {
      if (isTauri()) {
        const state = await tauriStorageState();
        if (!state.configured) {
          storageSetup.value = {
            environment: "native",
            reason: "choose",
            canCancel: false,
            native: state,
          };

          throw new StorageSetupPending();
        }

        backendRef.value = await TauriBackend.open();
        storageLocation.value = nativeLocation(state);
      } else {
        backendRef.value = await openBrowserBackend();
      }
    } catch (reason) {
      if (reason instanceof StorageSetupPending) throw reason;

      // Privacy contexts can deny OPFS; a memory backend keeps the app
      // runnable at the cost of durability.
      console.warn("[storage] persistent storage unavailable:", reason);
      backendRef.value = new MemoryBackend();
      bootNote.value = "Persistent storage is unavailable; this session is not saved.";
      storageLocation.value = {
        environment: "memory",
        label: t("storage.modeTemporary" as never),
        path: null,
        canPickFolder: false,
      };
    }

    updateBootStep("storage", { status: "done" });

    return backendRef.value;
  }

  async function ensureRegistry(): Promise<WorkspaceRegistry> {
    if (!registry) registry = new WorkspaceRegistry(await ensureBackend());
    return registry;
  }

  /** Restarts storage after a location change: flush, drop, and re-open. */
  async function afterStorageChange(): Promise<void> {
    teardownActive();
    workspace.value = undefined;
    backendRef.value = undefined;
    registry = undefined;
    ensurePromise = undefined;
    activeWorkspaceId.value = null;
    workspaceGeneration.value += 1;

    // The setup screen stays up (busy) until the new root has a workspace,
    // so a failed root shows its error in place instead of flashing the
    // chooser.
    await ensure();
    storageSetup.value = undefined;
  }

  async function configureStorage(choice: StorageSetupChoice): Promise<void> {
    error.value = undefined;

    if (choice.kind === "native") {
      storageLocation.value = nativeLocation(await configureTauriStorage(choice.mode, choice.path));
    } else if (choice.kind === "native-folder") {
      const path = await pickTauriDirectory();
      if (!path) return; // cancelled picker: keep the setup screen
      storageLocation.value = nativeLocation(await configureTauriStorage("custom", path));
    } else if (choice.kind === "browser-folder") {
      const handle = await pickDirectory();
      if (!handle) return;
      folderHandle = handle;
      localStorage.setItem(STORAGE_MODE_KEY, "folder");
      storageLocation.value = browserFolderLocation(handle);
    } else if (choice.kind === "browser-reconnect") {
      const handle = folderHandle ?? (await storedDirectoryHandle());
      if (!handle) throw new Error(t("storage.reconnectMissing" as never));
      if ((await requestDirectoryPermission(handle)) !== "granted") {
        throw new Error(t("storage.reconnectDenied" as never));
      }
      folderHandle = handle;
      storageLocation.value = browserFolderLocation(handle);
    } else {
      localStorage.setItem(STORAGE_MODE_KEY, "opfs");
      folderHandle = null;
      await forgetDirectoryHandle();
      storageLocation.value = opfsLocation();
    }

    await afterStorageChange();
  }

  /** Opens the location picker from settings without restarting storage. */
  async function openStorageSetup(): Promise<void> {
    if (isTauri()) {
      try {
        storageSetup.value = {
          environment: "native",
          reason: "choose",
          canCancel: true,
          native: await tauriStorageState(),
        };
      } catch (reason) {
        error.value = reason;
      }

      return;
    }

    storageSetup.value = {
      environment: "browser",
      reason: "choose",
      canCancel: true,
      folderName: folderHandle?.name,
    };
  }

  function cancelStorageSetup(): void {
    storageSetup.value = undefined;
  }

  /** atproto boot, off the critical path and bounded. */
  async function bootAtproto(
    store: WorkspaceStore,
    activeBackend: StorageBackend,
    local: LocalState,
  ): Promise<void> {
    const token = ++openingSeq;
    updateBootStep("atproto", { status: "active", detail: "in background" });
    try {
      // AI keys are device-only state. Load once; writes go through the
      // setter so settings UI and generators see the same object.
      const keys = (await local.get<AiKeyState>("aiKeys")) ?? {};
      initAiKeys(keys, (next) => void local.set("aiKeys", next));

      const service = await withTimeout(
        Atproto.init(store, local, {
          appUrl: appUrl(String(runtimeConfig.public.appUrl ?? "")),
          // Desktop shells sign in against the deployed metadata document even
          // when the webview loads the dev server, so the configured origin is
          // kept separate from the page origin.
          oauthOrigin: String(runtimeConfig.public.appUrl ?? ""),
          ...(runtimeConfig.public.relayUrl
            ? { relayUrl: String(runtimeConfig.public.relayUrl) }
            : {}),
          ...(runtimeConfig.public.pdsUrl
            ? { handleResolver: String(runtimeConfig.public.pdsUrl) }
            : {}),
        }),
        12_000,
        "Atproto initialization",
      );
      if (disposed || token !== openingSeq) {
        service.dispose();
        return;
      }

      function refresh() {
        if (disposed || token !== openingSeq) return;
        presence.value = service.presenceSnapshot();
        atprotoStatus.value = { ...service.status };
      }
      service.onChange(refresh);
      refresh();

      window.addEventListener("pagehide", () => void local.flush());
      atproto.value = service;
      atprotoReady.value = true;

      updateBootStep("atproto", {
        status: "done",
        detail: service.status.signedIn ? t("boot.syncAvailable") : t("boot.guest"),
      });
    } catch (cause) {
      console.warn("[atproto] disabled:", cause);
      bootNote.value = `Sync unavailable (${cause instanceof Error ? cause.message : String(cause)}). The workspace runs as a guest.`;
      updateBootStep("atproto", {
        status: "error",
        detail: t("boot.withoutSync"),
      });
    }
  }

  async function refreshWorkspaceList(): Promise<void> {
    const reg = await ensureRegistry();
    workspaces.value = await reg.list();
  }

  /** Nothing but the atproto/search/services belong to the old workspace. */
  function teardownActive(): void {
    unwatchSources?.();
    unwatchSources = undefined;
    atproto.value?.dispose();
    atproto.value = undefined;
    atprotoReady.value = false;
    atprotoStatus.value = {
      signedIn: false,
      syncing: false,
      did: null,
      spaceUri: null,
      pendingUpdates: 0,
      lastExportAt: 0,
      lastImportAt: 0,
      members: [],
      relayConnected: false,
      error: null,
    };
    void workspace.value?.flush();
    void localState.value?.flush();
    localState.value = undefined;
  }

  async function openWorkspace(id: string): Promise<WorkspaceStore> {
    const token = ++openingSeq;
    const switchToken = ++switchingSeq;
    switching.value = id;

    try {
      teardownActive();
      bootProgress.value = initialBootSteps((key) => t(key as never));
      bootNote.value = "";

      const reg = await ensureRegistry();
      const info = await reg.get(id);
      if (!info) throw new Error(`No workspace named ${id}`);

      await reg.save({ ...info, lastOpenedAt: Date.now() });
      if (token !== openingSeq) throw new Error("Superseded by another workspace switch");

      updateBootStep("workspace", { status: "active" });
      // A fresh doc seeds from the registry name; an existing doc's settings
      // name wins and is copied back into the registry below.
      const store = await WorkspaceStore.open(backendRef.value!, id, { name: info.name });
      if (token !== openingSeq) return store;

      // Keep the registry name in sync with the workspace doc.
      const name = store.getSettings().name;
      if (name !== info.name) await reg.save({ ...info, lastOpenedAt: Date.now(), name });
      updateBootStep("workspace", {
        status: "done",
        detail: `${store.listPages().length} page(s)`,
      });

      // The engine's memo caches belong to the previous workspace's docs.
      evictTypstCaches();

      store.onStructureChange(() => {
        dataRevision.value += 1;
        void syncRegistryName(store);
      });

      activeWorkspaceId.value = id;
      workspace.value = store;
      workspaceGeneration.value += 1;
      localStorage.setItem(LAST_WORKSPACE_KEY, id);
      void refreshWorkspaceList();

      // Device-local state doubles as the source-mirror bookkeeping; create it
      // before atproto boots so the page tree can sync right away.
      const local = new LocalState(backendRef.value!, localStatePath(id));
      localState.value = local;
      store.attachSourceSync(local);

      // atproto boots in the background, never gating the editor.
      void bootAtproto(store, backendRef.value!, local);

      // Mirror pages to their paths and pick up external edits.
      void store
        .syncSources()
        .then((result) => {
          if (result.created.length || result.imported.length || result.conflicts.length) {
            console.info("[sources] synced", result);
          }
        })
        .catch((reason) => console.warn("[sources] sync failed:", reason));

      // Native and picked-folder backends push changes as they land; the
      // focus/visibility sweep still covers engines without a watcher.
      unwatchSources = store.watchSources(syncExternalChanges, () => {
        pluginFilesRevision.value += 1;
      });

      if (import.meta.dev) {
        // Console access for debugging (mirrors __typstState in typst.ts).
        (window as unknown as { __store: WorkspaceStore }).__store = store;
      }

      return store;
    } finally {
      if (switchToken === switchingSeq) switching.value = null;
    }
  }

  /** Mirrors the workspace doc's name into the registry, only when changed. */
  async function syncRegistryName(store: WorkspaceStore): Promise<void> {
    const reg = await ensureRegistry();
    const entry = await reg.get(store.workspaceId);
    if (!entry) return;
    const name = store.getSettings().name;
    if (entry.name !== name) {
      await reg.save({ ...entry, name });
      workspaces.value = await reg.list();
    }
  }

  /** Picks the workspace to boot: last opened, else first, else a legacy "local", else a fresh one. */
  async function chooseWorkspaceId(reg: WorkspaceRegistry): Promise<string> {
    const all = await reg.list();
    workspaces.value = all;
    if (all.length > 0) {
      const last = localStorage.getItem(LAST_WORKSPACE_KEY);
      return all.find((entry) => entry.id === last)?.id ?? all[0]!.id;
    }

    // The user deleted every workspace: show the chooser instead of silently
    // recreating a default on reload.
    if (localStorage.getItem(WORKSPACES_EMPTY_KEY)) return "";

    // First run: adopt the legacy single-workspace data under "local",
    // otherwise that id becomes the first fresh workspace.
    const legacyExists = (await backendRef.value!.read(workspacePath("local"))) !== null;
    if (legacyExists) {
      const store = await WorkspaceStore.open(backendRef.value!, "local");
      const info: WorkspaceInfo = {
        id: "local",
        name: store.getSettings().name,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      await reg.save(info);
      return "local";
    }

    const id = createId();
    await reg.save({
      id,
      name: "My workspace",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    });
    return id;
  }

  async function ensure(): Promise<WorkspaceStore | null> {
    if (workspace.value) return workspace.value;

    ensurePromise ??= (async () => {
      await ensureBackend();
      // One-time move off the pre-restructure layout; see
      // `packages/storage/src/migrate.ts` for the removal recipe.
      await migrateLayout(backendRef.value!);
      const reg = await ensureRegistry();
      const id = await chooseWorkspaceId(reg);
      if (!id) return null; // nothing to open; the shell shows the chooser

      return openWorkspace(id);
    })().catch((reason) => {
      if (reason instanceof StorageSetupPending) {
        // The shell renders the setup screen; `configureStorage` restarts
        // the boot once a location is chosen.
        return null;
      }

      error.value = reason;
      throw reason;
    });

    return ensurePromise as Promise<WorkspaceStore | null>;
  }

  async function switchWorkspace(id: string): Promise<void> {
    error.value = undefined;
    try {
      ensurePromise = undefined;
      await openWorkspace(id);
      // A switch may land on a workspace with no pages; the shell picks
      // home/first page off the generation key.
    } catch (reason) {
      error.value = reason;
      throw reason;
    }
  }

  async function createWorkspace(name: string, icon?: string): Promise<WorkspaceInfo> {
    const reg = await ensureRegistry();
    const info: WorkspaceInfo = {
      id: createId(),
      name: name.trim() || "Untitled workspace",
      icon: icon || undefined,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    };
    localStorage.removeItem(WORKSPACES_EMPTY_KEY);
    await reg.save(info);
    workspaces.value = await reg.list();
    await switchWorkspace(info.id);

    return info;
  }

  async function renameWorkspace(id: string, name: string): Promise<void> {
    const reg = await ensureRegistry();
    const entry = await reg.get(id);
    if (!entry) return;

    const trimmed = name.trim();
    if (!trimmed) return;

    await reg.save({ ...entry, name: trimmed });
    workspaces.value = await reg.list();
    if (id === activeWorkspaceId.value && workspace.value) {
      // updateSettings is synchronous (commits the Loro doc itself).
      workspace.value.updateSettings({ name: trimmed });
      return;
    }

    // Renaming a workspace that is not open still has to reach its doc: the
    // doc's settings name is what wins when it opens (and what syncs), so a
    // registry-only rename would be reverted on the next open.
    const store = await WorkspaceStore.open(backendRef.value!, id, { name: trimmed });
    store.updateSettings({ name: trimmed });
    await store.flush();
  }

  async function setWorkspaceIcon(id: string, icon: string): Promise<void> {
    const reg = await ensureRegistry();
    const entry = await reg.get(id);
    if (!entry) return;

    await reg.save({ ...entry, icon });
    workspaces.value = await reg.list();
  }

  async function deleteWorkspace(id: string): Promise<void> {
    const reg = await ensureRegistry();
    await removeWorkspace(backendRef.value!, id);
    await reg.remove(id);
    workspaces.value = await reg.list();

    if (activeWorkspaceId.value === id) {
      teardownActive();
      workspace.value = undefined;
      activeWorkspaceId.value = null;
      workspaceGeneration.value += 1;
      localStorage.removeItem(LAST_WORKSPACE_KEY);
      ensurePromise = undefined;
      if (workspaces.value.length === 0) localStorage.setItem(WORKSPACES_EMPTY_KEY, "1");

      // Boot the next workspace that exists (if any); the shell falls back to
      // the chooser when none do.
      const next = workspaces.value[0];
      if (next) await switchWorkspace(next.id);
    }
  }

  /** Deletes every workspace on the active backend (debug tool). */
  async function wipeStorage(): Promise<void> {
    const active = backendRef.value;
    if (!active) return;

    teardownActive();
    workspace.value = undefined;
    activeWorkspaceId.value = null;
    workspaceGeneration.value += 1;
    localStorage.removeItem(LAST_WORKSPACE_KEY);
    localStorage.setItem(WORKSPACES_EMPTY_KEY, "1");

    const reg = await ensureRegistry();
    for (const entry of await reg.list()) {
      await removeWorkspace(active, entry.id);
      await reg.remove(entry.id);
    }

    await active.delete("workspaces.json").catch(() => {});
    workspaces.value = [];
    ensurePromise = undefined;
  }

  const workspaceId = computed(() => activeWorkspaceId.value ?? "");

  // One debounced sync pass serves both the watcher (native, picked folder)
  // and the focus/visibility sweep that covers engines without one.
  const syncExternalChanges = useDebounceFn(() => {
    void workspace.value?.syncSources().catch((reason) => {
      console.warn("[sources] sync failed:", reason);
    });
  }, 600);

  if (typeof window !== "undefined") {
    window.addEventListener("focus", syncExternalChanges);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void syncExternalChanges();
    });
  }

  return {
    workspace,
    localState,
    error,
    dataRevision,
    pluginFilesRevision,
    ensure,
    workspaceId,
    atproto,
    atprotoStatus,
    atprotoReady,
    presence,
    bootProgress,
    bootNote,
    workspaces,
    activeWorkspaceId,
    switching,
    workspaceGeneration,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    setWorkspaceIcon,
    deleteWorkspace,
    refreshWorkspaceList,
    backend: backendRef,
    storageSetup,
    storageLocation,
    configureStorage,
    openStorageSetup,
    cancelStorageSetup,
    wipeStorage,
  };
}

export const useWorkspace = createSharedComposable(useWorkspaceState);
