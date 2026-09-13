/**
 * atproto surface shared by the server and the browser client. Strings only:
 * the server serves the OAuth client metadata and must advertise exactly the
 * scopes the client requests, and importing the spaces package (which pulls
 * browser-only OAuth code) into a Nitro route is not worth it.
 */

export const APP_SPACE_TYPE = "app.typbase.workspace";

export const SPACE_COLLECTIONS = {
  config: "app.typbase.config",
  update: "app.typbase.update",
  snapshot: "app.typbase.snapshot",
  asset: "app.typbase.asset",
} as const;

export const POST_COLLECTION = "app.typbase.post";

/**
 * Verified against @atproto/oauth-scopes 0.0.0-spaces-alpha-20260818163953:
 * read + write access to Typbase workspaces (any authority, any skey),
 * write access to the public post collection, plus the base atproto/blob
 * pair. Wide by design: Typbase is a workspace client, spaces are per user.
 */
export const OAUTH_SCOPES: readonly string[] = [
  "atproto",
  "blob",
  "space:app.typbase.workspace?authority=*&action=read",
  "space:app.typbase.workspace?authority=*&collection=*",
  "repo:app.typbase.post",
];
