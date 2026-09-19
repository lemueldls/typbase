/**
 * atproto surface shared by the server and the browser client. Strings only:
 * the Nitro routes serve the OAuth client metadata and must advertise exactly
 * the scopes the client requests, and importing the spaces package (which
 * pulls browser-only OAuth code) into a Nitro route is not worth it. The paths
 * here are the same options the browser client hands to airspace's
 * `createBrowserOAuth`, so the served documents cannot drift from the client.
 */

/**
 * Scopes requested at sign-in, verified against @atproto/oauth-scopes
 * 0.0.0-spaces-alpha-20260913191958 and the PDS's own `assertSpaceScope`
 * checks. `collection=*` covers read/create/update/delete on space records;
 * `manage=create` is what `com.atproto.simplespace.createSpace` asserts; the
 * wildcard blob scope covers the post HTML/PDF uploads and future assets.
 * Wide by design: access is per user, and a workspace gets its own skey.
 */
export const OAUTH_SCOPES: readonly string[] = [
  "atproto",
  "blob:*/*",
  "space:at.typbase.workspace?authority=*&action=read",
  "space:at.typbase.workspace?authority=*&collection=*",
  "space:at.typbase.workspace?authority=*&manage=create",
  "repo:at.typbase.post",
];

/** `client_name` in both OAuth client metadata documents. */
export const OAUTH_CLIENT_NAME = "typbase";

/**
 * Web client metadata document, served at the URL used as `client_id`.
 * airspace's `clientMetadata()` defaults to this path; the constant is passed
 * explicitly so the route and the client cannot disagree.
 */
export const OAUTH_METADATA_PATH = "/oauth-client-metadata.json";

/**
 * Redirect target for the web client: the app root, not a dedicated route.
 * The browser client only processes a callback when `findRedirectUrl()`
 * matches the current location against a registered URI, and a server-side
 * bounce would drop the params before that check.
 */
export const OAUTH_REDIRECT_PATH = "/";

/**
 * Native (Tauri) client metadata document. atproto only accepts private-use
 * redirect schemes that contain a dot, so the deep-link scheme is
 * `at.typbase.app`, not `typbase`.
 */
export const NATIVE_OAUTH_METADATA_PATH = "/oauth-client-metadata/native.json";

/**
 * Redirect URI for the native shells (Tauri), registered in the document
 * above. The OS opens Typbase with the response instead of a page redirect.
 */
export const NATIVE_OAUTH_REDIRECT_URI = "at.typbase.app:/oauth" as const;
