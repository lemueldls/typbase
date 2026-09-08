import type { OAuthSession } from "@typbase/spaces";
import type { LocalState, WorkspaceStore } from "@typbase/storage";

import {
  RelayClient,
  SessionManager,
  TypbaseSync,
  createIdResolver,
  createWorkspaceSpace,
  listMembers,
  mintSpaceCredential,
  parseWorkspaceSpaceUri,
  putSpaceRecord,
  resolvePds,
  type SpaceCredential,
} from "@typbase/spaces";

import { createSyncHost } from "~/lib/syncHost";
import { withTimeout } from "~/lib/timeout";

/**
 * The app-side atproto service. One per workspace. Auth goes through the
 * browser OAuth client (PAR + PKCE + DPoP), spaces through credentials, and
 * the sync engine shuttles Loro updates between the local store and the
 * space. The relay is a best-effort fanout channel for updates and presence.
 */

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

const CREDENTIAL_TTL_MS = 90 * 60 * 1000;

export class AtprotoService {
  private sessions!: SessionManager;
  private sessionRef: OAuthSession | null = null;
  private sync: TypbaseSync | null = null;
  private relay: RelayClient | null = null;
  private credential: SpaceCredential | null = null;
  private credentialAt = 0;
  private resolver = createIdResolver();
  private persona: Persona = { name: "Guest", color: "#7c7ce0" };
  private presence = new Map<string, PresenceData>();
  private listeners = new Set<() => void>();
  private relayVersions = new Map<string, string>();
  private statusDid: string | null = null;
  private statusError: string | null = null;
  private members: Array<{ did: string; handle: string | null }> = [];
  private attachedSpaceUri: string | null = null;
  private disposed = false;

  private constructor(
    private readonly store: WorkspaceStore,
    private readonly local: LocalState,
    private readonly opts: { appUrl: string },
  ) {}

  static async init(
    store: WorkspaceStore,
    local: LocalState,
    opts: { appUrl: string },
  ): Promise<AtprotoService> {
    const service = new AtprotoService(store, local, opts);
    await service.restore();

    return service;
  }

  private async restore(): Promise<void> {
    const origin = this.opts.appUrl.replace(/\/$/, "");
    this.sessions = new SessionManager(
      `${origin}/client-metadata`,
      (session) => {
        void this.local.set("identity", session);
        if (!session) {
          this.statusDid = null;
          this.detach();
        }
        this.emit();
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

    const mirror = await this.local.get<{
      did: string;
      handle: string | null;
      pdsUrl: string;
    }>("identity");
    if (mirror?.did === session.did) {
      await this.local.set("identity", { ...mirror, handle: mirror.handle });
    } else {
      await this.local.set("identity", {
        did: session.did,
        handle: null,
        pdsUrl: "",
      });
    }

    const spaceUri = await this.local.get<string | null>("spaceUri");
    if (spaceUri) {
      this.attachedSpaceUri = spaceUri;
      await this.startSync(spaceUri, session.did);
    } else {
      // First sign-in for this workspace: create the space and adopt it.
      try {
        const uri = await createWorkspaceSpace(session, {
          skey: this.store.workspaceId,
        });
        await this.attach(uri, session.did);
      } catch (error) {
        this.setError(`Could not create the workspace space: ${String(error)}`);
      }
    }
  }

  get status(): AtprotoStatus {
    const syncStatus = this.sync?.status();

    return {
      signedIn: this.statusDid !== null,
      did: this.statusDid,
      spaceUri: syncStatus?.spaceUri ?? null,
      pendingUpdates: syncStatus?.pending ?? 0,
      lastExportAt: syncStatus?.lastExportAt ?? 0,
      lastImportAt: syncStatus?.lastImportAt ?? 0,
      members: this.members,
      relayConnected: this.relay?.connected ?? false,
      error: this.statusError,
    };
  }

  async signIn(identifier: string): Promise<void> {
    const session = await this.sessions.login(identifier);
    this.sessionRef = session;
    this.statusDid = session.did;
    await this.local.set("identity", {
      did: session.did,
      handle: null,
      pdsUrl: "",
    });

    try {
      const uri = await createWorkspaceSpace(session, {
        skey: this.store.workspaceId,
      });
      await this.attach(uri, session.did);
    } catch (error) {
      // The space may already exist (previous attach never completed). Try to
      // read it before giving up.
      this.setError(`Space setup failed: ${String(error)}`);
    }
    this.emit();
  }

  async signOut(): Promise<void> {
    await this.sessions.signOut();
    this.sessionRef = null;
    this.statusDid = null;
    await this.local.set("identity", null);
    await this.local.set("spaceUri", null);
    this.detach();
    this.emit();
  }

  /** Adopt a space uri (created now or persisted earlier) and start syncing. */
  private async attach(spaceUri: string, authorityDid: string): Promise<void> {
    await this.local.set("spaceUri", spaceUri);
    this.attachedSpaceUri = spaceUri;
    await this.bootstrapSnapshots(spaceUri, authorityDid);
    await this.startSync(spaceUri, authorityDid);
    void this.refreshMembers();
  }

  /**
   * Guest-to-space migration: push a snapshot of every doc so a fresh device
   * (or a later member) has a starting point. The engine then exports only
   * the delta from here on.
   */
  private async bootstrapSnapshots(
    spaceUri: string,
    authorityDid: string,
  ): Promise<void> {
    if (!this.sessionRef) return;

    try {
      const credential = await this.getCredential();
      const pdsUrl = await this.resolveMemberPds(authorityDid);
      const client = credential.client(pdsUrl);

      for (const docId of await this.store.listDocIds()) {
        const snapshot = await this.store.exportDocSnapshot(docId);
        await putSpaceRecord(client, {
          space: spaceUri,
          repoDid: authorityDid,
          collection: "app.typbase.snapshot",
          rkey: `snap-${Date.now().toString(36)}-${docId.slice(0, 6)}`,
          record: {
            docId,
            snapshot: b64encode(snapshot.bytes),
            version: snapshot.version,
            createdAt: new Date().toISOString(),
          },
        });
        await this.sync?.markDocExported(docId, snapshot.version);
      }
    } catch (error) {
      this.setError(`Snapshot bootstrap failed: ${String(error)}`);
      // Keep going: incremental updates still work, remote backfill just
      // starts from the first update.
    }
  }

  private async startSync(
    spaceUri: string,
    authorityDid: string,
  ): Promise<void> {
    const session = await this.requireSession().catch(() => null);
    const memberDid = session?.did ?? authorityDid;
    const syncHost = createSyncHost(
      this.store,
      (level, message) => console[level](`[sync] ${message}`),
      (did) => this.resolveMemberPds(did),
    );

    this.sync = new TypbaseSync(
      syncHost,
      {
        get: (key) => this.local.get(`sync:${key}`),
        set: (key, value) => this.local.set(`sync:${key}`, value),
      },
      () => this.getCredential(),
      memberDid,
      { compactionThreshold: 100, pollIntervalMs: 5000 },
    );

    this.store.onLocalCommit((docId) => {
      void this.handleLocalCommit(docId);
    });

    await this.sync.start(spaceUri, authorityDid);
    this.startRelay();
    this.emit();
  }

  private async handleLocalCommit(docId: string): Promise<void> {
    if (!this.relay?.connected) return;

    try {
      const since = this.relayVersions.get(docId);
      const exported = await this.store.exportUpdatesSince(
        docId,
        since ?? null,
      );
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

  /** OAuth session for own-repo calls (publishing). Throws when signed out. */
  async requireSession(): Promise<OAuthSession> {
    const session = this.sessionRef ?? (await this.sessions.restore());
    if (!session) throw new Error("Not signed in");
    this.sessionRef = session;

    return session;
  }

  /** The signed-in user's own PDS. */
  async ownPds(): Promise<string> {
    const session = await this.requireSession();

    return this.resolveMemberPds(session.did);
  }

  /** Space credential with lazy refresh. Cached per TTL, DPoP-bound. */
  private async getCredential(): Promise<SpaceCredential> {
    const now = Date.now();
    if (this.credential && now - this.credentialAt < CREDENTIAL_TTL_MS) {
      return this.credential;
    }
    if (!this.sessionRef) throw new Error("Not signed in");
    const spaceUri =
      this.attachedSpaceUri ??
      (await this.local.get<string | null>("spaceUri"));
    if (!spaceUri) throw new Error("No space attached");
    const authority = parseWorkspaceSpaceUri(spaceUri)?.authorityDid;
    if (!authority) throw new Error("Invalid space uri");
    const authorityPds = await this.resolveMemberPds(authority);
    this.credential = await mintSpaceCredential(
      this.sessionRef,
      spaceUri,
      authorityPds,
    );
    this.credentialAt = now;

    return this.credential;
  }

  private async resolveMemberPds(did: string): Promise<string> {
    const cached = await this.local.get<string>(`pds:${did}`);
    if (cached) return cached;

    const pdsUrl = await resolvePds(did, this.resolver, {
      getPdsUrl: () => undefined,
      setPdsUrl: () => {},
    });
    await this.local.set(`pds:${did}`, pdsUrl);

    return pdsUrl;
  }

  async refreshMembers(): Promise<void> {
    const spaceUri = this.status.spaceUri;
    if (!spaceUri) return;

    try {
      const credential = await this.getCredential();
      const authority = parseWorkspaceSpaceUri(spaceUri)?.authorityDid ?? "";
      const pdsUrl = await this.resolveMemberPds(authority);
      const members = await listMembers(credential.client(pdsUrl), spaceUri);
      this.members = members;
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

    const colors = [
      "#e8555f",
      "#e8a13f",
      "#57c08c",
      "#4f9ddb",
      "#8d6fd8",
      "#d85fb4",
    ];
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
    this.sync?.stop();
    this.sync = null;
    this.relay?.disconnect();
    this.relay = null;
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

function b64encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i] ?? 0);

  return btoa(binary);
}

function b64decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return bytes;
}
