/**
 * atproto surface shared by the server and the browser client. Strings only:
 * the server serves the OAuth client metadata and must advertise exactly the
 * scopes the client requests, and importing the spaces package (which pulls
 * browser-only OAuth code) into a Nitro route is not worth it.
 */

/**
 * Scopes requested at sign-in, verified against @atproto/oauth-scopes
 * 0.0.0-spaces-alpha-20260913191953 and the PDS's own `assertSpaceScope`
 * checks. `collection=*` covers read/create/update/delete on space records;
 * `manage=create` is what `com.atproto.simplespace.createSpace` asserts.
 * Wide by design: access is per user, and a workspace gets its own skey.
 */
export const OAUTH_SCOPES: readonly string[] = [
  "atproto",
  "blob",
  "space:app.typbase.workspace?authority=*&action=read",
  "space:app.typbase.workspace?authority=*&collection=*",
  "space:app.typbase.workspace?authority=*&manage=create",
  "repo:app.typbase.post",
];

/**
 * Redirect URI for the native shells (Tauri). atproto only accepts private-use
 * schemes that contain a dot, so the Tauri deep-link scheme is
 * `at.typbase.app`, not `typbase`. Served from `/client-metadata/native`.
 */
export const NATIVE_OAUTH_REDIRECT_URI = "at.typbase.app:/oauth" as const;
