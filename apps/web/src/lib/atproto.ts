import type { OAuthSession } from "@typbase/spaces";
import type { LocalState, WorkspaceStore } from "@typbase/storage";

import {
  RelayClient,
  SessionManager,
  TypbaseSync,
  WORKSPACE_SPACE_TYPE,
  createAirspaceTransport,
  createWorkspaceClient,
  workspaceSpaceUri,
  type WorkspaceClient,
} from "@typbase/spaces";
import { NATIVE_OAUTH_METADATA_PATH } from "@typbase/typing";

import { createNativeAuth } from "~/lib/nativeAuth";
import { createSyncHost } from "~/lib/syncHost";
import { withTimeout } from "~/lib/timeout";

export interface Persona {
  name: string;
  color: string;
}

export interface CursorState {
  docId: string;
  from: number;
  to: number;
}

type PresenceData = {
  persona: Persona;
  cursor: CursorState | null;
};

export interface AtprotoStatus {
  signedIn: boolean;
  did: string | null;
  spaceUri: string | null;
  pendingUpdates: number;
  lastExportAt: number;
  lastImportAt: number;
  members: Array<{ did: string; handle: string | null }>;
  relayConnected: boolean;
  error: string | null;
}

export class AtprotoService {
  private sessions!: SessionManager;
  private sessionRef: OAuthSession | null = null;
  private airspace: WorkspaceClient | null = null;
  private sync: TypbaseSync | null = null;
  private relay: RelayClient | null = null;
  private commitUnsubscribe: (() => void) | undefined;
  private persona: Persona = { name: "Guest", color: "#7c7ce0" };
  private presence = new Map<string, PresenceData>();
  private listeners = new Set<() => void>();
  private relayVersions = new Map<string, string>();
  private statusDid: string | null = null;
  private statusError: string | null = null;
  private members: Array<{ did: string; handle: string | null }> = [];
  private disposed = false;

  private constructor(
    private readonly store: WorkspaceStore,
    private readonly local: LocalState,
    private readonly opts: { appUrl: string; oauthOrigin: string; handleResolver?: string },
  ) {}

  static async init(
    store: WorkspaceStore,
    local: LocalState,
    opts: { appUrl: string; oauthOrigin: string; handleResolver?: string },
  ): Promise<AtprotoService> {
    const service = new AtprotoService(store, local, opts);
    await service.restore();

    return service;
  }

  private async restore(): Promise<void> {
    const origin = this.opts.appUrl.replace(/\/$/, "");
    // Native shells always sign in through the system browser and a deep
    // link, dev included, so their client id is the deployed origin's
    // metadata document rather than the page origin.
    const nativeAuth = createNativeAuth();
    const oauthOrigin = this.opts.oauthOrigin.replace(/\/$/, "");
    this.sessions = new SessionManager(
      origin,
      (session) => {
        if (!session) {
          this.statusDid = null;
          this.detach();
        }
        this.emit();
      },
      {
        ...(nativeAuth
          ? { clientId: `${oauthOrigin}${NATIVE_OAUTH_METADATA_PATH}`, nativeAuth }
          : {}),
        ...(this.opts.handleResolver ? { handleResolver: this.opts.handleResolver } : {}),
      },
    );

    // The OAuth client init touches IndexedDB and fetches the client
    // metadata; in an odd browser context it can stall. Bounded here so a
    // hung restore degrades to guest instead of stalling the boot step.
    const session = await withTimeout(
      this.sessions.restore(),
      8_000,
      "OAuth session restore",
    ).catch((cause) => {
      this.setError(`Session restore failed: ${String(cause)}`);

      return null;
    });
    if (!session) return;

    this.sessionRef = session;
    this.statusDid = session.did;

    try {
      await this.attach();
    } catch (error) {
      this.setError(`Space setup failed: ${String(error)}`);
    }
  }

  get status(): AtprotoStatus {
    const syncStatus = this.sync?.status();

    return {
      signedIn: this.statusDid !== null,
      did: this.statusDid,
      spaceUri:
        this.sync && this.statusDid
          ? workspaceSpaceUri(this.statusDid, this.store.workspaceId)
          : null,
      pendingUpdates: syncStatus?.pending ?? 0,
      lastExportAt: syncStatus?.lastExportAt ?? 0,
      lastImportAt: syncStatus?.lastImportAt ?? 0,
      members: this.members,
      relayConnected: this.relay?.connected ?? false,
      error: this.statusError,
    };
  }

  async signIn(identifier: string): Promise<void> {
    let session: OAuthSession;
    try {
      session = await this.sessions.login(identifier);
    } catch (error) {
      // A loopback guard or a rejected authorization. The caller surfaces the
      // message; the status line shows it for anyone else reading the popover.
      this.setError(`Sign-in failed: ${String(error)}`);
      throw error;
    }

    this.sessionRef = session;
    this.statusDid = session.did;

    try {
      await this.attach();
    } catch (error) {
      this.setError(`Space setup failed: ${String(error)}`);
    }
    this.emit();
  }

  async signOut(): Promise<void> {
    await this.sessions.signOut();
    this.sessionRef = null;
    this.statusDid = null;
    this.detach();
    this.emit();
  }

  /**
   * Ensures the workspace space exists with member-list read/write and open app
   * access, then starts syncing. Called on every boot with a session; `ensure`
   * is a no-op once the space is configured.
   */
  private async attach(): Promise<void> {
    const session = this.sessionRef;
    if (!session) throw new Error("Not signed in");

    const airspace = createWorkspaceClient({
      session,
      did: session.did,
      workspaceId: this.store.workspaceId,
    });
    this.airspace = airspace;

    try {
      await airspace.workspace.manage.ensure({
        read: "member-list",
        write: "member-list",
        appAccess: "open",
      });
    } catch (error) {
      // The session is fine; this PDS just cannot host the workspace space
      // (bsky.social does not run the spaces alpha). Publishing still works.
      if (isSpacesUnsupported(error)) {
        this.setError(
          "This PDS does not support permissioned spaces yet, so sync is off. Sign in on a spaces-enabled PDS to sync.",
        );

        return;
      }
      throw error;
    }

    await this.startSync(airspace);
    void this.refreshMembers();
  }

  private async startSync(airspace: WorkspaceClient): Promise<void> {
    const memberDid = this.sessionRef?.did ?? this.statusDid ?? "";
    const syncHost = createSyncHost(this.store, (level, message) =>
      console[level](`[sync] ${message}`),
    );
    // Sync state is per space: rkeys and cursors mean nothing in another
    // space, so the key carries the space type.
    const syncStore = {
      get: (key: string) => this.local.get(`sync:${WORKSPACE_SPACE_TYPE}:${key}`),
      set: (key: string, value: unknown) =>
        this.local.set(`sync:${WORKSPACE_SPACE_TYPE}:${key}`, value),
    };

    this.sync = new TypbaseSync(syncHost, syncStore, createAirspaceTransport(airspace.workspace), {
      compactionThreshold: 100,
      pollIntervalMs: 5000,
    });

    this.commitUnsubscribe?.();
    this.commitUnsubscribe = this.store.onLocalCommit((docId) => {
      void this.handleLocalCommit(docId);
    });

    await this.sync.start();

    // Once per account and space: push a snapshot of every doc so a fresh
    // device has a starting point, then send only deltas. The flag carries
    // the space type, so another space starts its own bootstrap.
    const bootstrapFlag = `synced:${memberDid}:${this.store.workspaceId}:${WORKSPACE_SPACE_TYPE}`;
    if (!(await this.local.get<boolean>(bootstrapFlag))) {
      try {
        await this.sync.bootstrapSnapshots();
        await this.local.set(bootstrapFlag, true);
      } catch (error) {
        this.setError(`Snapshot bootstrap failed: ${String(error)}`);
      }
    }

    this.startRelay();
    this.emit();
  }

  private async handleLocalCommit(docId: string): Promise<void> {
    if (!this.relay?.connected) return;

    try {
      const since = this.relayVersions.get(docId);
      const exported = await this.store.exportUpdatesSince(docId, since ?? null);
      if (!exported) return;

      this.relayVersions.set(docId, exported.version);
      this.relay.sendUpdate(docId, exported.bytes);
    } catch {
      // Relay is best effort; the sync queue is the durable path.
    }
  }

  private startRelay(): void {
    if (this.relay) return;

    const origin = this.opts.appUrl.replace(/\/$/, "");
    const url = `${origin}/relay?workspace=${encodeURIComponent(this.store.workspaceId)}`;
    this.relay = new RelayClient(url, this.store.workspaceId, {
      onOpen: () => this.emit(),
      onClose: () => this.emit(),
      onUpdate: (docId, b64) => {
        void this.store
          .importDocBytes(docId, b64decode(b64))
          .then(() => this.sync?.poke())
          .catch(() => {});
      },
      onAwareness: (peer, data) => {
        const presence = data as PresenceData | undefined;
        if (!presence?.persona) return;

        this.presence.set(peer, presence);
        this.emit();
      },
      onPeers: () => this.emit(),
    });
    this.relay.connect();
  }

  /** The workspace's airspace client. Throws when signed out. */
  requireWorkspace(): WorkspaceClient {
    if (!this.airspace) throw new Error("Not signed in");

    return this.airspace;
  }

  async refreshMembers(): Promise<void> {
    if (!this.airspace) return;

    try {
      const members = await this.airspace.workspace.manage.members.list();
      this.members = members.map((member) => ({ did: member.did, handle: null }));
      this.emit();
    } catch (error) {
      this.members = [];
      this.setError(`Member list failed: ${String(error)}`);
    }
  }

  /** Stable per-device persona: name + color for remote cursors. */
  async ensurePersona(): Promise<Persona> {
    const stored = await this.local.get<Persona>("persona");
    if (stored) {
      this.persona = stored;

      return stored;
    }

    const colors = ["#e8555f", "#e8a13f", "#57c08c", "#4f9ddb", "#8d6fd8", "#d85fb4"];
    const name = `Device ${Math.random().toString(36).slice(2, 5)}`;
    const hash = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const persona: Persona = {
      name,
      color: colors[hash % colors.length] ?? "#7c7ce0",
    };
    await this.local.set("persona", persona);
    this.persona = persona;

    return persona;
  }

  /** Presence: broadcast our cursor and remember others'. */
  setPresence(persona: Persona, cursor: CursorState | null): void {
    this.persona = persona;
    if (this.relay?.connected) {
      this.relay.sendAwareness({ persona, cursor });
    }
  }

  presenceSnapshot(): Map<string, PresenceData> {
    return this.presence;
  }

  /** Wakes the pull loop (visibilitychange, focus, relay poke). */
  async wake(): Promise<void> {
    await this.sync?.wake();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  /**
   * Stops the sync loop and relay. Called when the workspace composable's
   * shared scope is disposed (last consumer unmounted); the persisted state in
   * local.json survives, so re-opening the workspace resumes where it left.
   */
  dispose(): void {
    this.disposed = true;
    this.detach();
  }

  private detach(): void {
    this.commitUnsubscribe?.();
    this.commitUnsubscribe = undefined;
    this.sync?.stop();
    this.sync = null;
    this.relay?.disconnect();
    this.relay = null;
    this.airspace = null;
  }

  private setError(message: string | null): void {
    this.statusError = message;
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;

    for (const listener of this.listeners) listener();
  }
}

function b64decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return bytes;
}

/** airspace's `SpacesUnsupportedError`, checked by name to survive bundle boundaries. */
function isSpacesUnsupported(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "SpacesUnsupportedError"
  );
}
