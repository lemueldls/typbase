import type { OAuthSession } from "@atproto/oauth-client-browser";

import { createDidResolver } from "@atproto-labs/did-resolver";
import { AtprotoDohHandleResolver } from "@atproto-labs/handle-resolver";
import { AtprotoIdentityResolver } from "@atproto-labs/identity-resolver";
import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import { OAUTH_SCOPES } from "@typbase/typing";

/**
 * Browser OAuth: PAR + PKCE + DPoP, handled by @atproto/oauth-client-browser.
 * The client persists its own state (DPoP keys, sessions, caches) in
 * IndexedDB, which is the browser-native store the alpha library is built
 * for. The session it hands back is passed straight to `createAirspace`.
 *
 * A local dev origin gets an RFC 8252 loopback client id (`http://localhost`
 * plus redirect and scope params) because the atproto client metadata document
 * has to live at an HTTPS URL. Loopback redirects must use an IP literal, so
 * signing in has to happen at 127.0.0.1; `localhost` is a different origin
 * with its own IndexedDB and OPFS.
 *
 * Native shells (Tauri) pass `clientId` plus a `NativeAuth`: the flow runs in
 * the system browser and the response comes back through a deep link instead
 * of a page redirect. The metadata document for that client is served at
 * `/client-metadata/native`.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
  /** DNS-over-HTTPS endpoint for handle resolution. Defaults to Cloudflare. */
  dohEndpoint?: string;
  /** Override the client id, e.g. a native metadata document. */
  clientId?: string;
  /** Native shell callback handling. Omit on the web. */
  nativeAuth?: NativeAuth;
}

/** The `client_id` for an app origin: a metadata URL, or a loopback client id. */
export function oauthClientId(appUrl: string): string {
  const origin = appUrl.replace(/\/$/, "");
  const url = new URL(origin);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return `${origin}/client-metadata`;
  }

  const redirect = new URL(`${origin}/`);
  if (redirect.hostname === "localhost") redirect.hostname = "127.0.0.1";

  const clientId = new URL("http://localhost");
  clientId.searchParams.set("redirect_uri", redirect.toString());
  clientId.searchParams.set("scope", OAUTH_SCOPES.join(" "));

  return clientId.toString();
}

/** 127.0.0.1 form of a loopback app URL, for the sign-in guard message. */
export function loopbackAppUrl(appUrl: string): string {
  const url = new URL(appUrl);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";

  return url.toString();
}

export class SessionManager {
  private client: BrowserOAuthClient | undefined;
  private restoring = false;

  constructor(
    private readonly appUrl: string,
    private readonly onSession: (session: SessionIdentity | null) => void,
    private readonly options: SessionManagerOptions = {},
  ) {}

  private clientId(): string {
    return this.options.clientId ?? oauthClientId(this.appUrl);
  }

  private isLoopback(): boolean {
    return this.clientId().startsWith("http:");
  }

  /** A localhost page cannot finish a loopback sign-in (the redirect lands on 127.0.0.1). */
  private needsLoopbackIp(): boolean {
    try {
      return this.isLoopback() && new URL(this.appUrl).hostname === "localhost";
    } catch {
      return false;
    }
  }

  private async ensureClient(): Promise<BrowserOAuthClient> {
    if (!this.client) {
      // The browser has no DNS; handles resolve through the well-known file and
      // DNS-over-HTTPS, and DIDs through the PLC directory (the local one during
      // self-hosted PDS development).
      const identityResolver = new AtprotoIdentityResolver(
        createDidResolver({
          ...(this.options.plcDirectoryUrl
            ? { plcDirectoryUrl: this.options.plcDirectoryUrl }
            : {}),
        }),
        new AtprotoDohHandleResolver({
          dohEndpoint: this.options.dohEndpoint ?? "https://cloudflare-dns.com/dns-query",
        }),
      );

      this.client = await BrowserOAuthClient.load({
        clientId: this.clientId(),
        // The callback lands on the app root with the response in the fragment,
        // where BrowserOAuthClient.findRedirectUrl() matches the registered
        // redirect URI and init() processes it. No server-side bounce.
        responseMode: "fragment",
        allowHttp: this.options.allowHttp ?? this.isLoopback(),
        identityResolver,
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
      const client = await this.ensureClient();
      const result = await client.init();
      const session = result?.session ?? null;
      this.notify(session);

      return session;
    } finally {
      this.restoring = false;
    }
  }

  /** Full-page redirect flow on the web; system browser + deep link on native. */
  async login(identifier: string): Promise<OAuthSession> {
    const native = this.options.nativeAuth;
    if (!native && this.needsLoopbackIp()) {
      throw new Error(
        `Loopback sign-in runs on the IP literal: open ${loopbackAppUrl(this.appUrl)} and sign in there.`,
      );
    }

    const client = await this.ensureClient();
    const scope = OAUTH_SCOPES.join(" ");

    if (native) {
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

    const session = await client.signIn(identifier, { scope });
    this.notify(session);

    return session;
  }

  async signOut(): Promise<void> {
    const client = await this.ensureClient();
    const session = await client.initRestore();
    if (session) await client.revoke(session.session.sub);
    this.notify(null);
  }

  private async completeNativeCallback(params: URLSearchParams): Promise<OAuthSession> {
    const native = this.options.nativeAuth!;
    const client = await this.ensureClient();
    const { session } = await client.initCallback(params, native.redirectUri);
    this.notify(session);

    return session;
  }

  private notify(session: OAuthSession | null): void {
    // pdsUrl is resolved lazily via DID documents: the OAuth client has no
    // authoritative service endpoint on the session's metadata.
    this.onSession(session ? { did: session.did, handle: null, pdsUrl: "" } : null);
  }
}
