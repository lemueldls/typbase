import type { StorageBackend } from "@typbase/storage";

import {
  LocalState,
  localStatePath,
  MemoryBackend,
  OPFSBackend,
  WorkspaceStore,
} from "@typbase/storage";

import type { AtprotoService, AtprotoStatus } from "~/lib/atproto";

import { initAiKeys, type AiKeyState } from "~/lib/ai/keys";
import { AtprotoService as Atproto } from "~/lib/atproto";
import { withTimeout } from "~/lib/timeout";

const WORKSPACE_ID = "local";

// ---------------------------------------------------------------------------
// Boot progress. The load gate waits only for storage + the workspace doc;
// the atproto session boots in the background (bootAtproto) bounded by a
// timeout, so a slow OAuth init can never hold the editor hostage.
// ---------------------------------------------------------------------------

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

function initialBootSteps(): BootStepState[] {
  return [
    { id: "storage", label: "Opening local storage", status: "pending" },
    { id: "workspace", label: "Loading workspace documents", status: "pending" },
    { id: "atproto", label: "Checking atproto session", status: "pending" },
  ];
}

function appUrl(): string {
  const origin = window.location.origin;
  return origin && window.location.protocol !== "file:" ? origin : "http://localhost:3000";
}

/**
 * The local guest workspace: one Loro workspace doc plus one doc per page,
 * stored under OPFS. Signing in attaches a space to it; a signing guest keeps
 * the identical pipeline minus the atproto transport.
 *
 * Shared via createSharedComposable: every consumer sees the same store, and
 * the whole setup (store handle, atproto service, presence) is torn down when
 * the last consumer unmounts. Leaving the workspace shell and coming back
 * re-opens from OPFS; bootProgress shows the same steps as first boot.
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
  let ensurePromise: Promise<WorkspaceStore> | undefined;

  /** Bumped whenever workspace-level data changes (pages, categories, settings). */
  const dataRevision = ref(0);

  /** Presence state: peer -> { persona, cursor }. Filled by the relay. */
  const presence = shallowRef(
    new Map<string, { persona: { name: string; color: string }; cursor: CursorLike | null }>(),
  );

  const bootProgress = ref<BootStepState[]>(initialBootSteps());
  /** Non-fatal boot notes (OPFS fell back to memory, atproto disabled, ...). */
  const bootNote = ref("");

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

  /** atproto boot, off the critical path and bounded. */
  async function bootAtproto(store: WorkspaceStore, backend: StorageBackend): Promise<void> {
    updateBootStep("atproto", { status: "active", detail: "in background" });
    try {
      const local = new LocalState(backend, localStatePath(WORKSPACE_ID));
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
      if (disposed) {
        service.dispose();
        return;
      }

      function refresh() {
        if (disposed) return;
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
        detail: service.status.signedIn ? "sync available" : "guest workspace",
      });
    } catch (cause) {
      console.warn("[atproto] disabled:", cause);
      bootNote.value = `Sync unavailable (${cause instanceof Error ? cause.message : String(cause)}). The workspace runs as a guest.`;
      updateBootStep("atproto", { status: "error", detail: "running without sync" });
    }
  }

  async function ensure(): Promise<WorkspaceStore> {
    if (workspace.value) return workspace.value;

    ensurePromise ??= (async () => {
      updateBootStep("storage", { status: "active" });

      let backend: OPFSBackend | MemoryBackend;
      try {
        backend = await OPFSBackend.open();
      } catch {
        // Privacy contexts can deny OPFS; a memory backend keeps the app
        // runnable at the cost of durability.
        backend = new MemoryBackend();
        bootNote.value = "OPFS is unavailable; this session is not persisted.";
      }
      updateBootStep("storage", { status: "done" });

      updateBootStep("workspace", { status: "active" });
      const store = await WorkspaceStore.open(backend, WORKSPACE_ID);
      updateBootStep("workspace", {
        status: "done",
        detail: `${store.listPages().length} page(s)`,
      });

      store.onStructureChange(() => {
        dataRevision.value += 1;
      });

      workspace.value = store;

      // atproto boots in the background, never gating the editor.
      void bootAtproto(store, backend);

      if (import.meta.dev) {
        // Console access for debugging (mirrors __typstState in typst.ts).
        (window as unknown as { __store: WorkspaceStore }).__store = store;
      }

      return store;
    })().catch((reason) => {
      error.value = reason;
      throw reason;
    });

    return ensurePromise;
  }

  return {
    workspace,
    localState,
    error,
    dataRevision,
    ensure,
    workspaceId: WORKSPACE_ID,
    atproto,
    atprotoStatus,
    atprotoReady,
    presence,
    bootProgress,
    bootNote,
  };
}

export const useWorkspace = createSharedComposable(useWorkspaceState);
