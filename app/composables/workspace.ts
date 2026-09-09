import type { StorageBackend } from "@typbase/storage";
import type { WorkspaceInfo } from "@typbase/typing";

import {
  LocalState,
  localStatePath,
  MemoryBackend,
  OPFSBackend,
  WorkspaceRegistry,
  WorkspaceStore,
  createId,
  removeWorkspace,
  workspacePath,
} from "@typbase/storage";

import type { AtprotoService, AtprotoStatus } from "~/lib/atproto";

import { initAiKeys, type AiKeyState } from "~/lib/ai/keys";
import { AtprotoService as Atproto } from "~/lib/atproto";
import { withTimeout } from "~/lib/timeout";

const LAST_WORKSPACE_KEY = "typbase:lastWorkspace";
/** Set once the user deletes every workspace, so a reload shows the chooser. */
const WORKSPACES_EMPTY_KEY = "typbase:workspacesEmpty";

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

function appUrl(): string {
  const origin = window.location.origin;
  return origin && window.location.protocol !== "file:" ? origin : "http://localhost:3000";
}

/**
 * The local workspaces: one Loro workspace doc plus one doc per page per
 * workspace, all under OPFS. Signing in attaches a space to the active
 * workspace; a signing guest keeps the identical pipeline minus atproto.
 *
 * Shared via createSharedComposable: every consumer sees the same active
 * store, and the setup is torn down when the last consumer unmounts.
 * Switching workspaces disposes the previous store service and re-opens the
 * next from OPFS; `workspaceGeneration` is the remount key for the shell.
 */
function useWorkspaceState() {
  const workspace = shallowRef<WorkspaceStore>();
  const localState = shallowRef<LocalState>();
  const error = shallowRef<unknown>();
  const atproto = shallowRef<AtprotoService>();
  const atprotoStatus = ref<AtprotoStatus>({
    signedIn: false,
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

  /** Presence state: peer -> { persona, cursor }. Filled by the relay. */
  const presence = shallowRef(
    new Map<string, { persona: { name: string; color: string }; cursor: CursorLike | null }>(),
  );

  const { t } = useI18n();
  const bootProgress = ref<BootStepState[]>(initialBootSteps((key) => t(key as never)));
  /** Non-fatal boot notes (OPFS fell back to memory, atproto disabled, ...). */
  const bootNote = ref("");

  const workspaces = ref<WorkspaceInfo[]>([]);
  const activeWorkspaceId = ref<string | null>(null);
  /** Bumped whenever the active workspace changes; key the shell on it. */
  const workspaceGeneration = ref(0);

  let backend: StorageBackend | undefined;
  let registry: WorkspaceRegistry | undefined;
  let openingSeq = 0;
  let disposed = false;

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

  async function ensureBackend(): Promise<StorageBackend> {
    if (backend) return backend;

    updateBootStep("storage", { status: "active" });
    try {
      backend = await OPFSBackend.open();
    } catch {
      // Privacy contexts can deny OPFS; a memory backend keeps the app
      // runnable at the cost of durability.
      backend = new MemoryBackend();
      bootNote.value = "OPFS is unavailable; this session is not persisted.";
    }
    updateBootStep("storage", { status: "done" });
    return backend;
  }

  async function ensureRegistry(): Promise<WorkspaceRegistry> {
    if (!registry) registry = new WorkspaceRegistry(await ensureBackend());
    return registry;
  }

  /** atproto boot, off the critical path and bounded. */
  async function bootAtproto(store: WorkspaceStore, activeBackend: StorageBackend): Promise<void> {
    const token = ++openingSeq;
    updateBootStep("atproto", { status: "active", detail: "in background" });
    try {
      const local = new LocalState(activeBackend, localStatePath(store.workspaceId));
      localState.value = local;

      // AI keys are device-only state. Load once; writes go through the
      // setter so settings UI and generators see the same object.
      const keys = (await local.get<AiKeyState>("aiKeys")) ?? {};
      initAiKeys(keys, (next) => void local.set("aiKeys", next));

      const service = await withTimeout(
        Atproto.init(store, local, { appUrl: appUrl() }),
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
    atproto.value?.dispose();
    atproto.value = undefined;
    atprotoReady.value = false;
    atprotoStatus.value = {
      signedIn: false,
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
    teardownActive();
    bootProgress.value = initialBootSteps((key) => t(key as never));
    bootNote.value = "";

    const reg = await ensureRegistry();
    const info = await reg.get(id);
    if (!info) throw new Error(`No workspace named ${id}`);

    await reg.save({ ...info, lastOpenedAt: Date.now() });
    if (token !== openingSeq) throw new Error("Superseded by another workspace switch");

    updateBootStep("workspace", { status: "active" });
    const store = await WorkspaceStore.open(backend!, id);
    if (token !== openingSeq) return store;

    // Keep the registry name in sync with the workspace doc.
    const name = store.getSettings().name;
    if (name !== info.name) await reg.save({ ...info, lastOpenedAt: Date.now(), name });
    updateBootStep("workspace", {
      status: "done",
      detail: `${store.listPages().length} page(s)`,
    });

    store.onStructureChange(() => {
      dataRevision.value += 1;
      void syncRegistryName(store);
    });

    activeWorkspaceId.value = id;
    workspace.value = store;
    workspaceGeneration.value += 1;
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
    void refreshWorkspaceList();

    // atproto boots in the background, never gating the editor.
    void bootAtproto(store, backend!);

    if (import.meta.dev) {
      // Console access for debugging (mirrors __typstState in typst.ts).
      (window as unknown as { __store: WorkspaceStore }).__store = store;
    }

    return store;
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
    const legacyExists = (await backend!.read(workspacePath("local"))) !== null;
    if (legacyExists) {
      const store = await WorkspaceStore.open(backend!, "local");
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
      const reg = await ensureRegistry();
      const id = await chooseWorkspaceId(reg);
      if (!id) return null; // nothing to open; the shell shows the chooser

      return openWorkspace(id);
    })().catch((reason) => {
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
    if (id === activeWorkspaceId.value) {
      // updateSettings is synchronous (commits the Loro doc itself).
      workspace.value?.updateSettings({ name: trimmed });
    }
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
    await removeWorkspace(backend!, id);
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

  const workspaceId = computed(() => activeWorkspaceId.value ?? "");

  return {
    workspace,
    localState,
    error,
    dataRevision,
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
    workspaceGeneration,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    setWorkspaceIcon,
    deleteWorkspace,
    refreshWorkspaceList,
  };
}

export const useWorkspace = createSharedComposable(useWorkspaceState);
