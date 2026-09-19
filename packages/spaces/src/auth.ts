import type { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";
import type { BrowserOAuth } from "airspace/oauth/browser";

import {
  OAUTH_CLIENT_NAME,
  OAUTH_METADATA_PATH,
  OAUTH_REDIRECT_PATH,
  OAUTH_SCOPES,
} from "@typbase/typing";
import { createBrowserOAuth } from "airspace/oauth/browser";

/**
 * OAuth for the browser and the native shells.
 *
 * Web: `airspace/oauth/browser` runs PAR + PKCE + DPoP in the page, keeps
 * tokens and DPoP keys in IndexedDB, and builds its client metadata locally
 * from the shared constants. The app serves the matching document at
 * `OAUTH_METADATA_PATH`, so the PDS fetches exactly what the client declared.
 *
 * Native (Tauri): the shell has no HTTPS origin to receive a page redirect,
 * so sign-in always runs in the system browser and the response comes back
 * through the private-use deep link. The client id is the deployed origin's
 * metadata document, which is why desktop dev needs `NUXT_PUBLIC_APP_URL` set
 * even though the webview loads the dev server. airspace's browser entrypoint
 * always emits a web client with a redirect under the app origin, so the
 * native flow drives `@atproto/oauth-client-browser` directly.
 *
 * A local dev origin gets an RFC 8252 loopback client id (`http://localhost`
 * plus redirect and scope params) because the metadata document has to live
 * at an HTTPS URL. Loopback redirects must use an IP literal, so web sign-in
 * has to happen at 127.0.0.1; `localhost` is a different origin with its own
 * IndexedDB and OPFS.
 */

export interface SessionIdentity {
  did: string;
  handle: string | null;
  pdsUrl: string;
}

/**
 * How a native shell hands OAuth responses back to the app. `redirectUri` must
 * be one of the redirect URIs in the client metadata the shell uses.
 */
export interface NativeAuth {
  redirectUri: NativeRedirectUri;
  /** Open the authorization URL outside the webview (system browser). */
  open(url: string): Promise<void>;
  /** Resolve with the OAuth response params when the OS returns to the app. */
  waitForCallback(): Promise<URLSearchParams>;
  /** Response params from the URL that launched the app, when there are any. */
  takeLaunchCallback?(): Promise<URLSearchParams | null>;
}

/** A private-use (RFC 8252) or HTTPS redirect URI, as the OAuth client types them. */
export type NativeRedirectUri = `${string}.${string}:/${string}` | `https://${string}`;

export interface SessionManagerOptions {
  /** Dev-only: let the client talk HTTP and did:web endpoints. */
  allowHttp?: boolean;
  /** Dev-only: local PLC directory (self-hosted PDS development). */
  plcDirectoryUrl?: string;
  /** atproto service that resolves handles (a PDS). Defaults to bsky.social. */
  handleResolver?: string;
  /** Native shell callback handling. Omit on the web. */
  nativeAuth?: NativeAuth;
  /**
   * Native client metadata document URL. Required with `nativeAuth`: the
   * document lives on the deployed origin, which the dev webview is not.
   */
  clientId?: string;
}

/** 127.0.0.1 form of a loopback app URL, for the sign-in guard message. */
export function loopbackAppUrl(appUrl: string): string {
  const url = new URL(appUrl);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";

  return url.toString();
}

export class SessionManager {
  private oauth: BrowserOAuth | undefined;
  private nativeClient: BrowserOAuthClient | undefined;
  private restoring = false;
  private currentDid: string | null = null;

  constructor(
    private readonly appUrl: string,
    private readonly onSession: (session: SessionIdentity | null) => void,
    private readonly options: SessionManagerOptions = {},
  ) {}

  /** True when the page origin is a loopback HTTP origin (dev). */
  private isLoopback(): boolean {
    try {
      return new URL(this.appUrl).protocol === "http:";
    } catch {
      return false;
    }
  }

  /** A localhost page cannot finish a loopback sign-in (the redirect lands on 127.0.0.1). */
  private needsLoopbackIp(): boolean {
    try {
      return this.isLoopback() && new URL(this.appUrl).hostname === "localhost";
    } catch {
      return false;
    }
  }

  private allowHttp(): boolean {
    return this.options.allowHttp ?? this.isLoopback();
  }

  /** Web OAuth through airspace's browser entrypoint. */
  private async webOAuth(): Promise<BrowserOAuth> {
    if (!this.oauth) {
      this.oauth = await createBrowserOAuth({
        baseUrl: this.appUrl,
        redirectPath: OAUTH_REDIRECT_PATH,
        name: OAUTH_CLIENT_NAME,
        scopes: OAUTH_SCOPES,
        metadataPath: OAUTH_METADATA_PATH,
        responseMode: "fragment",
        allowHttp: this.allowHttp(),
        ...(this.options.handleResolver ? { handleResolver: this.options.handleResolver } : {}),
        ...(this.options.plcDirectoryUrl ? { plcDirectoryUrl: this.options.plcDirectoryUrl } : {}),
      });
    }

    return this.oauth;
  }

  /** Native shells use a private-use redirect, which airspace cannot express. */
  private async nativeOAuth(): Promise<BrowserOAuthClient> {
    if (!this.nativeClient) {
      const clientId = this.options.clientId;
      if (!clientId) {
        throw new Error("Native sign-in needs a client metadata document URL.");
      }
      if (!clientId.startsWith("https:")) {
        throw new Error(
          `Native sign-in needs an https client metadata document, got ${clientId}. Set the deployed app URL.`,
        );
      }

      const { BrowserOAuthClient } = await import("@atproto/oauth-client-browser");
      this.nativeClient = await BrowserOAuthClient.load({
        clientId,
        responseMode: "fragment",
        allowHttp: this.allowHttp(),
        ...(this.options.handleResolver ? { handleResolver: this.options.handleResolver } : {}),
        ...(this.options.plcDirectoryUrl ? { plcDirectoryUrl: this.options.plcDirectoryUrl } : {}),
      });
    }

    return this.nativeClient;
  }

  /**
   * Restores a persisted session (or completes a login callback if the URL
   * carries oauth params). Returns null when nobody is signed in.
   */
  async restore(): Promise<OAuthSession | null> {
    if (this.restoring) return null;

    const native = this.options.nativeAuth;
    if (native?.takeLaunchCallback) {
      // The app was opened by the OS with an OAuth response (cold start).
      const params = await native.takeLaunchCallback();
      if (params) return await this.completeNativeCallback(params);
    } else if (this.needsLoopbackIp()) {
      return null;
    }

    this.restoring = true;
    try {
      let session: OAuthSession | null = null;
      if (native) {
        const client = await this.nativeOAuth();
        session = (await client.init())?.session ?? null;
      } else {
        const oauth = await this.webOAuth();
        session = (await oauth.init())?.session ?? null;
      }
      this.notify(session);

      return session;
    } finally {
      this.restoring = false;
    }
  }

  /**
   * Full-page redirect flow on the web; system browser + deep link on native.
   * The web promise only settles if the user navigates back; the callback is
   * completed by `restore()` on the next load.
   */
  async login(identifier: string): Promise<OAuthSession> {
    const native = this.options.nativeAuth;
    if (!native && this.needsLoopbackIp()) {
      throw new Error(
        `Loopback sign-in runs on the IP literal: open ${loopbackAppUrl(this.appUrl)} and sign in there.`,
      );
    }

    if (native) {
      const client = await this.nativeOAuth();
      const scope = OAUTH_SCOPES.join(" ");
      // Register the listener before opening the browser so a fast redirect is
      // not missed.
      const authorization = await client.authorize(identifier, {
        scope,
        redirect_uri: native.redirectUri,
      });
      const response = native.waitForCallback();
      await native.open(authorization.href);

      return await this.completeNativeCallback(await response);
    }

    const oauth = await this.webOAuth();

    return await oauth.signIn(identifier);
  }

  async signOut(): Promise<void> {
    const native = this.options.nativeAuth;
    if (native) {
      const client = await this.nativeOAuth();
      const session = await client.initRestore();
      if (session) await client.revoke(session.session.sub);
    } else if (this.currentDid) {
      const oauth = await this.webOAuth();
      await oauth.revoke(this.currentDid);
    }
    this.notify(null);
  }

  private async completeNativeCallback(params: URLSearchParams): Promise<OAuthSession> {
    const native = this.options.nativeAuth!;
    const client = await this.nativeOAuth();
    const { session } = await client.initCallback(params, native.redirectUri);
    this.notify(session);

    return session;
  }

  private notify(session: OAuthSession | null): void {
    this.currentDid = session?.did ?? null;
    // pdsUrl is resolved lazily via DID documents: the OAuth client has no
    // authoritative service endpoint on the session's metadata.
    this.onSession(session ? { did: session.did, handle: null, pdsUrl: "" } : null);
  }
}
