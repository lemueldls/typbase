import {
  APP_SPACE_TYPE,
  POST_COLLECTION,
  SPACE_COLLECTIONS,
} from "@typbase/typing";

export { APP_SPACE_TYPE, POST_COLLECTION, SPACE_COLLECTIONS };

/**
 * Scopes requested at sign-in. These exact strings live in @typbase/typing
 * because the Nitro client-metadata route must advertise them; they were
 * produced by and verified against @atproto/oauth-scopes. Update all three
 * copies together (typing/src/atproto.ts is the source).
 */
export { OAUTH_SCOPES } from "@typbase/typing";

export function workspaceSpaceUri(
  authorityDid: string,
  workspaceId: string,
): string {
  return `at://${authorityDid}/space/${APP_SPACE_TYPE}/${workspaceId}`;
}

/** Splits `at://<did>/space/<type>/<skey>`; null when the URI is not a workspace space. */
export function parseWorkspaceSpaceUri(
  uri: string,
): { authorityDid: string; workspaceId: string } | null {
  const match =
    /^at:\/\/(did:[^/]+)\/space\/app\.typbase\.workspace\/([^/]+)$/.exec(uri);
  if (!match) return null;

  return { authorityDid: match[1], workspaceId: match[2] };
}
