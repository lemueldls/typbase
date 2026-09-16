import { defineCollections, defineSpace } from "airspace";

import lexicons from "./lexicons";

/**
 * One collection per record type, plus the space that holds them. The space
 * key is the workspace id, so each workspace syncs through its own space.
 */
export const collections = defineCollections(lexicons);

export function workspaceSpace(skey: string) {
  return defineSpace(lexicons.workspace, {
    skey,
    collections: {
      update: collections.update,
      snapshot: collections.snapshot,
      post: collections.post,
    },
  });
}
