import type { DidString } from "@atproto/lex-schema";

import { defineCollections, defineSpace } from "airspace";

import lexicons from "./lexicons";

/**
 * One collection per record type, plus the space that contains them. The space
 * key is the workspace id, so each workspace syncs through its own space.
 */
export const collections = defineCollections(lexicons);

export function workspaceSpace(skey: string, ownerDid?: string) {
  return defineSpace(lexicons.workspace, {
    skey,
    ...(ownerDid ? { authority: ownerDid as DidString } : {}),
    collections: {
      update: collections.update,
      snapshot: collections.snapshot,
      post: collections.post,
      asset: collections.asset,
    },
  });
}
