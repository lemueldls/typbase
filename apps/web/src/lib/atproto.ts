import type { AssetSyncStatus, OAuthSession } from "@typbase/spaces";
import type { LocalState, WorkspaceStore } from "@typbase/storage";

import { AssetSync, base64ToBytes, createAssetRemote } from "@typbase/spaces";
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
import { workspaceNameFromSnapshot } from "@typbase/storage";
import { NATIVE_OAUTH_METADATA_PATH } from "@typbase/typing";

import type { PublicProfile } from "~/lib/actor";
import type { AtprotoAccount } from "~/lib/atprotoAccounts";

import { fetchPublicProfile } from "~/lib/actor";
import { createAssetHost } from "~/lib/assetHost";
import { readAccounts, writeAccounts } from "~/lib/atprotoAccounts";
import { createNativeAuth } from "~/lib/nativeAuth";
import { takeOAuthCallback } from "~/lib/oauthCallback";
import { createSyncHost } from "~/lib/syncHost";
import { withTimeout } from "~/lib/timeout";

export type { AtprotoAccount } from "~/lib/atprotoAccounts";

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
  /**
   * True once a workspace space is attached. A signed-in account whose PDS
   * does not support Spaces stays false, so the UI can say sync is off.
   */
  syncing: boolean;
  did: string | null;
  /** Public identity and profile fields once the session resolves them. */
  profile: PublicProfile | null;
  spaceUri: string | null;
  pendingUpdates: number;
  lastExportAt: number;
  lastImportAt: number;
  /** Content-addressed blobs moving between this device and the space. */
  assets: AssetSyncStatus;
  members: Array<{ did: string; handle: string | null }>;
  relayConnected: boolean;
  error: string | null;
  /** Accounts saved on this device, active account first when just used. */
  accounts: AtprotoAccount[];
}

/** One workspace space the signed-in account has written to. */
export interface WorkspaceSpaceSummary {
  /** The space rkey, which is also the local workspace id. */
  id: string;
  uri: string;
  /** Display name read from the workspace snapshot, when one is available. */
  name?: string;
}

export class AtprotoService {
  private sessions!: SessionManager;
  private sessionRef: OAuthSession | null = null;
  private airspace: WorkspaceClient | null = null;
  private sync: TypbaseSync | null = null;
  private assetSync: AssetSync | null = null;
  private assetWakeTimer: ReturnType<typeof setTimeout> | undefined;
  private relay: RelayClient | null = null;
  private commitUnsubscribe: (() => void) | undefined;
  private persona: Persona = { name: "Guest", color: "#7c7ce0" };
  private presence = new Map<string, PresenceData>();
  private listeners = new Set<() => void>();
  private relayVersions = new Map<string, string>();
  private statusDid: string | null = null;
  private statusProfile: PublicProfile | null = null;
  private statusError: string | null = null;
  private members: Array<{ did: string; handle: string | null }> = [];
  private accounts: AtprotoAccount[] = [];
  private attachEpoch = 0;
  private disposed = false;

  private constructor(
    private readonly store: WorkspaceStore,
    private readonly local: LocalState,
    private readonly opts: {
      appUrl: string;
      oauthOrigin: string;
      handleResolver?: string;
      proxyUrl?: string;
    },
  ) {}

  static async init(
    store: WorkspaceStore,
    local: LocalState,
    opts: {
      appUrl: string;
      oauthOrigin: string;
      handleResolver?: string;
      proxyUrl?: string;
    },
  ): Promise<AtprotoService> {
    const service = new AtprotoService(store, local, opts);
    await service.restore();

    return service;
  }

  private async restore(): Promise<void> {
    this.accounts = readAccounts();
    const origin = this.opts.appUrl.replace(/\/$/, "");
    // Native shells always sign in through the system browser and a deep
    // link, dev included, so their client id is the deployed origin's
    // metadata document rather than the page origin.
    const nativeAuth = createNativeAuth();
    const webCallback = nativeAuth ? undefined : (takeOAuthCallback() ?? undefined);
    const oauthOrigin = this.opts.oauthOrigin.replace(/\/$/, "");
    this.sessions = new SessionManager(
      origin,
      (session) => {
        if (!session) {
          this.statusDid = null;
          this.statusProfile = null;
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
    // metadata. In an odd browser context it can stall. Bounded here so a
    // hung restore degrades to guest instead of stalling the boot step.
    const session = await withTimeout(
      this.sessions.restore(webCallback),
      8_000,
      "OAuth session restore",
    ).catch((cause) => {
      this.setError(`Session restore failed: ${String(cause)}`);

      return null;
    });
    if (!session) return;

    this.sessionRef = session;
    this.statusDid = session.did;
    this.recordActiveAccount(session.did);

    try {
      await this.attach();
    } catch (error) {
      this.setError(`Space setup failed: ${String(error)}`);
    }
    this.emit();
    void this.refreshProfile();
  }

  get status(): AtprotoStatus {
    const syncStatus = this.sync?.status();

    return {
      signedIn: this.statusDid !== null,
      syncing: this.sync !== null,
      did: this.statusDid,
      profile: this.statusProfile,
      spaceUri:
        this.sync && this.statusDid
          ? workspaceSpaceUri(this.statusDid, this.store.workspaceId)
          : null,
      pendingUpdates: syncStatus?.pending ?? 0,
      lastExportAt: syncStatus?.lastExportAt ?? 0,
      lastImportAt: syncStatus?.lastImportAt ?? 0,
      assets: this.assetSync?.status() ?? {
        syncing: false,
        pending: 0,
        revision: 0,
        lastSyncedAt: 0,
        error: null,
      },
      members: this.members,
      relayConnected: this.relay?.connected ?? false,
      error: this.statusError,
      accounts: this.accounts,
    };
  }

  async signIn(identifier: string): Promise<void> {
    // A failure from an earlier attempt should not linger in the status line
    // once the user retries.
    this.setError(null);

    let session: OAuthSession;
    try {
      session = await this.sessions.login(identifier);
    } catch (error) {
      // A loopback guard or a rejected authorization. The caller surfaces the
      // message. The status line shows it for anyone else reading the popover.
      this.setError(`Sign-in failed: ${String(error)}`);
      throw error;
    }

    if (this.disposed) return;

    this.detach();
    this.sessionRef = session;
    this.statusDid = session.did;
    this.statusProfile = null;
    this.members = [];
    this.recordActiveAccount(session.did);

    try {
      await this.attach();
    } catch (error) {
      this.setError(`Space setup failed: ${String(error)}`);
    }
    this.emit();
    void this.refreshProfile();
  }

  async signOut(): Promise<void> {
    const did = this.statusDid;
    await this.sessions.signOut();
    if (did) this.removeStoredAccount(did);
    this.sessionRef = null;
    this.statusDid = null;
    this.statusProfile = null;
    this.detach();
    this.setError(null);
    const next = this.accounts[0];
    if (next) {
      try {
        await this.switchAccount(next.did);
        return;
      } catch {
        // switchAccount reports the failure and leaves the app signed out.
      }
    }
    this.emit();
  }

  /** Switch the active session without revoking the current one. */
  async switchAccount(did: string): Promise<void> {
    if (!did || did === this.statusDid) return;

    this.setError(null);

    let session: OAuthSession;
    try {
      // Restore first. A dead session leaves the current account alone.
      session = await this.sessions.restoreAccount(did);
    } catch (error) {
      this.removeStoredAccount(did);
      // A failed user-initiated switch leaves the active account in place, so
      // the panel shows the error next to the list. A sign-out fallback has no
      // active account to carry that message.
      if (!this.statusDid) {
        this.setError(`Account switch failed: ${String(error)}`);
        this.emit();
      }
      throw error;
    }

    if (this.disposed) return;

    this.detach();
    this.statusProfile = null;
    this.members = [];
    await this.activateSession(session);
  }

  /** Revoke one account. Signing out the active account switches to the next. */
  async removeAccount(did: string): Promise<void> {
    if (did === this.statusDid) {
      await this.signOut();
      return;
    }

    try {
      await this.sessions.revoke(did);
    } finally {
      this.removeStoredAccount(did);
    }
  }

  private async activateSession(session: OAuthSession): Promise<void> {
    if (this.disposed) return;

    this.sessionRef = session;
    this.statusDid = session.did;
    this.recordActiveAccount(session.did);

    try {
      await this.attach();
    } catch (error) {
      this.setError(`Space setup failed: ${String(error)}`);
    }
    this.emit();
    void this.refreshProfile();
  }

  private recordActiveAccount(did: string): void {
    const now = Date.now();
    let account = this.accounts.find((entry) => entry.did === did);
    if (!account) {
      account = {
        did,
        handle: null,
        displayName: null,
        avatar: null,
        addedAt: now,
        lastUsedAt: now,
      };
      this.accounts.push(account);
    } else {
      account.lastUsedAt = now;
    }
    if (this.statusProfile?.did === did) this.applyProfile(account, this.statusProfile);
    this.accounts.sort((left, right) => right.lastUsedAt - left.lastUsedAt);
    writeAccounts(this.accounts);
    this.emit();
  }

  private updateAccountProfile(profile: PublicProfile): void {
    let account = this.accounts.find((entry) => entry.did === profile.did);
    if (!account) {
      const now = Date.now();
      account = {
        did: profile.did,
        handle: null,
        displayName: null,
        avatar: null,
        addedAt: now,
        lastUsedAt: now,
      };
      this.accounts.push(account);
    }
    this.applyProfile(account, profile);
    this.accounts.sort((left, right) => right.lastUsedAt - left.lastUsedAt);
    writeAccounts(this.accounts);
  }

  private applyProfile(account: AtprotoAccount, profile: PublicProfile): void {
    account.handle = profile.handle ?? account.handle;
    account.displayName = profile.displayName ?? account.displayName;
    account.avatar = profile.avatar ?? account.avatar;
  }

  private removeStoredAccount(did: string): void {
    this.accounts = this.accounts.filter((entry) => entry.did !== did);
    writeAccounts(this.accounts);
    this.emit();
  }

  /**
   * Ensures the workspace space exists with member-list read/write and open app
   * access, then starts syncing. Called on every boot with a session. `ensure`
   * is a no-op once the space is configured.
   */
  private async attach(): Promise<void> {
    const session = this.sessionRef;
    if (!session || this.disposed) return;
    const epoch = this.attachEpoch;

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
      if (!this.isCurrentAttach(session, epoch)) return;
      // The session is fine. This PDS just cannot host the workspace space
      // (bsky.social does not run the spaces alpha). Publishing still works.
      if (isSpacesUnsupported(error)) {
        this.setError(
          "This PDS does not support permissioned spaces yet, so sync is off. Sign in on a spaces-enabled PDS to sync.",
        );

        return;
      }
      throw error;
    }

    if (!this.isCurrentAttach(session, epoch)) return;
    this.airspace = airspace;

    try {
      await this.startSync(airspace, session, epoch);
    } catch (error) {
      if (!this.isCurrentAttach(session, epoch)) return;
      throw error;
    }
    if (!this.isCurrentAttach(session, epoch)) return;
    void this.refreshMembers();
  }

  private isCurrentAttach(session: OAuthSession, epoch: number): boolean {
    return !this.disposed && this.attachEpoch === epoch && this.sessionRef === session;
  }

  /**
   * Resolve the account's public handle from its PDS, then any richer profile
   * fields the AppView has. The PDS call is authoritative for the handle; the
   * AppView is optional and may not index a self-hosted account.
   */
  private async refreshProfile(): Promise<void> {
    const session = this.sessionRef;
    if (!session || this.disposed) return;
    const did = session.did;

    let handle: string | null = null;
    try {
      const params = new URLSearchParams({ repo: did });
      const response = await session.fetchHandler(
        `/xrpc/com.atproto.repo.describeRepo?${params.toString()}`,
      );
      if (response.ok) {
        const body = (await response.json()) as { handle?: string };
        handle = body.handle ?? null;
      }
    } catch {
      // A profile is a convenience. Sync still works without one.
    }

    const rich = await fetchPublicProfile(did);
    if (this.disposed || this.sessionRef?.did !== did) return;
    this.statusProfile = {
      did,
      handle: rich?.handle ?? handle,
      displayName: rich?.displayName ?? null,
      description: rich?.description ?? null,
      avatar: rich?.avatar ?? null,
      banner: rich?.banner ?? null,
    };
    this.updateAccountProfile(this.statusProfile);
    this.emit();
  }

  private async startSync(
    airspace: WorkspaceClient,
    session: OAuthSession,
    epoch: number,
  ): Promise<void> {
    if (this.disposed) return;

    const memberDid = session.did;
    const syncHost = createSyncHost(
      this.store,
      (level, message) => console[level](`[sync] ${message}`),
      () => {
        // Pages and settings may have arrived after the asset pass read the
        // reference set. Debounce the wake so a snapshot import does not scan
        // the whole reference set once per page.
        this.scheduleAssetSync();
      },
    );
    // Sync state is per account and space, and has a schema revision. Bump the
    // revision when the import order or host semantics change: the new key
    // makes every device do one full scan instead of trusting cursors from the
    // old model. `v2` opened pre-metadata page docs, which fixed pages coming
    // in empty on a freshly joined workspace. The DID keeps a switch from
    // carrying the old account's cursors and pending queue into the new space.
    const syncStatePrefix = `sync:${WORKSPACE_SPACE_TYPE}:v2:${memberDid}:`;
    const syncStore = {
      get: (key: string) => this.local.get(`${syncStatePrefix}${key}`),
      set: (key: string, value: unknown) => this.local.set(`${syncStatePrefix}${key}`, value),
    };

    const sync = new TypbaseSync(syncHost, syncStore, createAirspaceTransport(airspace.workspace), {
      compactionThreshold: 100,
      pollIntervalMs: 5000,
    });
    this.sync = sync;

    this.commitUnsubscribe?.();
    this.commitUnsubscribe = this.store.onLocalCommit((docId) => {
      void this.handleLocalCommit(docId);
    });

    await sync.start();
    if (!this.isCurrentAttach(session, epoch) || this.sync !== sync) {
      sync.stop();
      return;
    }

    // Once per account and space: push a snapshot of every doc so a fresh
    // device has a starting point, then send only deltas. The flag carries
    // the space type, so another space starts its own bootstrap.
    const bootstrapFlag = `synced:${memberDid}:${this.store.workspaceId}:${WORKSPACE_SPACE_TYPE}`;
    if (!(await this.local.get<boolean>(bootstrapFlag))) {
      if (!this.isCurrentAttach(session, epoch) || this.sync !== sync) {
        sync.stop();
        return;
      }
      try {
        await sync.bootstrapSnapshots();
        if (this.isCurrentAttach(session, epoch) && this.sync === sync) {
          await this.local.set(bootstrapFlag, true);
        }
      } catch (error) {
        if (this.isCurrentAttach(session, epoch) && this.sync === sync) {
          this.setError(`Snapshot bootstrap failed: ${String(error)}`);
        }
      }
    }

    if (!this.isCurrentAttach(session, epoch) || this.sync !== sync) {
      sync.stop();
      return;
    }
    this.startAssetSync(airspace, session);
    this.startRelay();
    this.emit();
  }

  private scheduleAssetSync(): void {
    if (this.assetWakeTimer) clearTimeout(this.assetWakeTimer);
    this.assetWakeTimer = setTimeout(() => {
      this.assetWakeTimer = undefined;
      void this.assetSync?.syncNow();
    }, 300);
  }

  private startAssetSync(airspace: WorkspaceClient, session: OAuthSession): void {
    this.assetSync?.stop();
    this.assetSync = new AssetSync(
      createAssetHost(this.store),
      createAssetRemote(airspace, session),
      {
        onStatus: () => this.emit(),
      },
    );
    this.assetSync.start();
  }

  private async handleLocalCommit(docId: string): Promise<void> {
    // The PDS queue is the durable path. The relay only accelerates peers
    // that are online now, so every local commit has to enter the queue even
    // when no relay is connected.
    try {
      await this.sync?.onLocalCommit(docId);
    } catch (error) {
      this.setError(`Sync export failed: ${String(error)}`);
    }

    if (!this.relay?.connected) return;

    try {
      const since = this.relayVersions.get(docId);
      const exported = await this.store.exportUpdatesSince(docId, since ?? null);
      if (!exported) return;

      this.relayVersions.set(docId, exported.version);
      this.relay.sendUpdate(docId, exported.bytes);
    } catch {
      // Relay is best effort. The sync queue is the durable path.
    }
  }

  private startRelay(): void {
    if (this.relay) return;

    // Static deploys have no Nitro relay. `proxyUrl` lets a hosted one take
    // over. Without it the relay targets the app origin and just never opens,
    // which leaves the polling sync loop as the only path.
    const base = (this.opts.proxyUrl?.trim() || this.opts.appUrl).replace(/\/$/, "");
    // Two accounts can use the same local workspace id. Scope the live room by
    // DID so their relay traffic cannot cross.
    const room = `${this.store.workspaceId}:${this.statusDid ?? ""}`;
    const url = `${base}/relay?workspace=${encodeURIComponent(room)}`;
    this.relay = new RelayClient(url, room, {
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

  /** The signed-in OAuth session, for public repo writes outside a space. */
  requireSession(): OAuthSession {
    if (!this.sessionRef) throw new Error("Not signed in");

    return this.sessionRef;
  }

  get session(): OAuthSession | null {
    return this.sessionRef;
  }

  /** True when the session can write the site collections. Older sign-ins cannot. */
  async hasSitePublishingScope(): Promise<boolean> {
    if (!this.sessionRef) return false;
    try {
      const info = await this.sessionRef.getTokenInfo();
      const scope = String(info.scope);

      return scope.includes("repo:place.wisp.fs") && scope.includes("repo:site.standard.document");
    } catch {
      return false;
    }
  }

  /** Re-runs OAuth so an older session picks up the site scopes. */
  async reauthorize(): Promise<void> {
    const identifier = this.statusDid;
    if (!identifier) throw new Error("Not signed in");
    await this.signIn(identifier);
  }

  async refreshMembers(): Promise<void> {
    const airspace = this.airspace;
    if (!airspace) return;

    try {
      const members = await airspace.workspace.manage.members.list();
      if (this.airspace !== airspace) return;
      this.members = members.map((member) => ({ did: member.did, handle: null }));
      this.emit();
    } catch (error) {
      if (this.airspace !== airspace) return;
      this.members = [];
      this.setError(`Member list failed: ${String(error)}`);
    }
  }

  /** Spaces the account can open as a workspace. */
  async listWorkspaceSpaces(
    knownIds: ReadonlySet<string> = new Set(),
  ): Promise<WorkspaceSpaceSummary[]> {
    const session = this.sessionRef;
    const did = this.statusDid;
    if (!session || !did) return [];

    const spaces: WorkspaceSpaceSummary[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({
        type: WORKSPACE_SPACE_TYPE,
        did,
        limit: "100",
      });
      if (cursor) params.set("cursor", cursor);
      const response = await session.fetchHandler(
        `/xrpc/com.atproto.space.listSpaces?${params.toString()}`,
      );
      if (!response.ok) throw new Error(`Listing spaces failed (${response.status})`);
      const body = (await response.json()) as {
        spaces?: Array<{ uri?: string }>;
        cursor?: string;
      };
      for (const space of body.spaces ?? []) {
        const uri = space.uri;
        const id = typeof uri === "string" ? uri.split("/").pop() : "";
        if (uri && id) spaces.push({ id, uri });
      }
      cursor = body.cursor;
    } while (cursor);

    await Promise.all(
      spaces.map(async (space) => {
        if (knownIds.has(space.id)) return;
        space.name = await this.readWorkspaceSpaceName(space.id).catch(() => undefined);
      }),
    );

    if (this.sessionRef !== session || this.statusDid !== did) return [];

    return spaces;
  }

  /** Read the workspace title from the latest workspace doc snapshot. */
  private async readWorkspaceSpaceName(id: string): Promise<string | undefined> {
    const session = this.sessionRef;
    const did = this.statusDid;
    if (!session || !did) return undefined;

    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({
        space: workspaceSpaceUri(did, id),
        repo: did,
        collection: "at.typbase.snapshot",
        limit: "100",
        excludeValues: "false",
      });
      if (cursor) params.set("cursor", cursor);
      const response = await session.fetchHandler(
        `/xrpc/com.atproto.space.listRecords?${params.toString()}`,
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as {
        records?: Array<{
          value?: { docId?: string; snapshot?: string };
        }>;
        cursor?: string;
      };
      for (const record of body.records ?? []) {
        if (record.value?.docId !== id || !record.value.snapshot) continue;
        const name = await workspaceNameFromSnapshot(base64ToBytes(record.value.snapshot));
        if (name) return name;
      }
      cursor = body.cursor;
    } while (cursor);

    return undefined;
  }

  /** Confirm a space exists before opening it as a local workspace. */
  async workspaceSpaceExists(id: string): Promise<boolean> {
    const session = this.sessionRef;
    const did = this.statusDid;
    if (!session || !did) return false;

    const params = new URLSearchParams({ space: workspaceSpaceUri(did, id) });
    const response = await session.fetchHandler(
      `/xrpc/com.atproto.simplespace.getSpace?${params.toString()}`,
    );
    if (response.ok) return true;
    if (response.status === 404) return false;
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === "SpaceNotFound") return false;
    throw new Error(`Space lookup failed (${response.status})`);
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
    void this.assetSync?.syncNow();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  /**
   * Stops the sync loop and relay. Called when the workspace composable's
   * shared scope is disposed (last consumer unmounted). The persisted state in
   * local.json survives, so re-opening the workspace resumes where it left.
   */
  dispose(): void {
    this.disposed = true;
    this.detach();
  }

  private detach(): void {
    this.attachEpoch += 1;
    this.commitUnsubscribe?.();
    this.commitUnsubscribe = undefined;
    this.sync?.stop();
    this.sync = null;
    if (this.assetWakeTimer) clearTimeout(this.assetWakeTimer);
    this.assetWakeTimer = undefined;
    this.assetSync?.stop();
    this.assetSync = null;
    this.relay?.disconnect();
    this.relay = null;
    this.airspace = null;
    this.members = [];
    this.presence.clear();
    this.relayVersions.clear();
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
