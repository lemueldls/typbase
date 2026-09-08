import type { OAuthSession } from "@atproto/oauth-client-browser";

import { createDidResolver } from "@atproto-labs/did-resolver";
import { createIdentityResolver } from "@atproto-labs/identity-resolver";
import { BrowserOAuthClient } from "@atproto/oauth-client-browser";

import { OAUTH_SCOPES } from "./constants";

/**
 * Browser OAuth: PAR + PKCE + DPoP, handled by @atproto/oauth-client-browser.
 * The client persists its own state (DPoP keys, sessions, caches) in
 * IndexedDB, which is the browser-native store the alpha library is built
 * for. The app additionally mirrors `{did, handle, pdsUrl}` into local.json
 * through LocalSession whenever a session changes; that mirror is what the
 * sync engine reads when the OAuth client has not been initialized yet.
 *
 * The Switcheroo to a Tauri loopback client (M4) happens behind this class:
 * `login` and `resolveSession` are the only two entry points the app uses.
 */

export interface SessionIdentity {
  did: string;
  handle: string | null;
  pdsUrl: string;
}

export interface SessionManagerOptions {
  /** Dev-only: let the client talk HTTP and did:web endpoints. */
  allowHttp?: boolean;
  /** Dev-only: local PLC directory (self-hosted PDS development). */
  plcDirectoryUrl?: string;
}

export class SessionManager {
  private client: BrowserOAuthClient | undefined;
  private restoring = false;

  constructor(
    private readonly clientId: string,
    private readonly onSession: (session: SessionIdentity | null) => void,
    private readonly options: SessionManagerOptions = {},
  ) {}

  private async ensureClient(): Promise<BrowserOAuthClient> {
    if (!this.client) {
      this.client = await BrowserOAuthClient.load({
        clientId: this.clientId,
        allowHttp: this.options.allowHttp,
        ...(this.options.plcDirectoryUrl
          ? {
              // Local dev net: DIDs live in the self-hosted PLC, not the
              // public one, so identity resolution must ask there.
              identityResolver: createIdentityResolver({
                didResolver: createDidResolver({
                  plcDirectoryUrl: this.options.plcDirectoryUrl,
                }),
              }),
            }
          : {}),
        // The client metadata document is served by the app's Nitro server;
        // the PDS fetches it once at authorization time.
      });
    }

    return this.client;
  }

  /**
   * Restores a persisted session (or completes a login callback if the URL
   * carries oauth params). Returns null when nobody is signed in.
   */
  async restore(): Promise<OAuthSession | null> {
    if (this.restoring) return null;

    this.restoring = true;
    try {
      const client = await this.ensureClient();
      const result = await client.init();
      const session = result?.session ?? null;
      this.notify(session);

      return session;
    } finally {
      this.restoring = false;
    }
  }

  /** Full-page redirect flow. The callback lands on /oauth/callback. */
  async login(identifier: string): Promise<OAuthSession> {
    const client = await this.ensureClient();
    const session = await client.signIn(identifier, {
      scope: OAUTH_SCOPES.join(" "),
    });
    this.notify(session);

    return session;
  }

  async signOut(): Promise<void> {
    const client = await this.ensureClient();
    const session = await client.initRestore();
    if (session) await client.revoke(session.session.sub);
    this.notify(null);
  }

  private notify(session: OAuthSession | null): void {
    // pdsUrl is resolved lazily via DID documents: the OAuth client has no
    // authoritative service endpoint on the session's metadata.
    this.onSession(
      session ? { did: session.did, handle: null, pdsUrl: "" } : null,
    );
  }
}
