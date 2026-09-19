import type { OAuthSession } from "@atproto/oauth-client-browser";
import type { DidString, RecordOf } from "airspace";

import { createAirspace, spaceUri } from "airspace";

import type { SyncTransport } from "./sync";

import { collections, workspaceSpace } from "./collections";

/** The NSID of the workspace space type. */
export const WORKSPACE_SPACE_TYPE = "at.typbase.workspace";

/** `com.atproto.repo.applyWrites`-style batch limit; keep deletes in chunks of this size. */
const MAX_BATCH = 200;

export interface WorkspaceClientOptions {
  /** OAuth session for the signed-in account. */
  session: OAuthSession;
  /** Signed-in account DID. */
  did: string;
  /** Workspace id, used as the space key. */
  workspaceId: string;
  /** PDS base URL, when it has already been resolved. */
  service?: string;
}

/**
 * The airspace client for one workspace: reads and writes records in the
 * signed-in account's repo inside the workspace space, and in the public repo
 * for `post`. Everything depends on the PDS lookup, so construction is
 * synchronous and network calls wait on `identity()` internally.
 */
export function createWorkspaceClient(options: WorkspaceClientOptions) {
  const did = options.did as DidString;

  return createAirspace({
    identity: options.service ? { did, service: options.service } : { did },
    spaces: { workspace: workspaceSpace(options.workspaceId) },
    session: options.session,
  });
}

/**
 * Read-only client for one account's public posts. `identity` is a handle or
 * a DID; the PDS lookup happens on first use.
 */
export function createPublicPostsClient(identity: string | { did: string; service: string }) {
  return createAirspace({
    identity:
      typeof identity === "string"
        ? identity
        : { did: identity.did as DidString, service: identity.service },
    collections: { post: collections.post },
  });
}

export function workspaceSpaceUri(did: string, workspaceId: string): string {
  return spaceUri(did as DidString, WORKSPACE_SPACE_TYPE, workspaceId);
}

export type WorkspaceClient = ReturnType<typeof createWorkspaceClient>;
export type WorkspaceSpace = WorkspaceClient["workspace"];
export type PublicPostsClient = ReturnType<typeof createPublicPostsClient>;
export type PostRecord = RecordOf<typeof collections.post>;
export type PostValue = PostRecord["value"];

/**
 * The sync engine's transport over the space's update and snapshot
 * collections. Records come back newest first; the engine stops at the last
 * rkey it saw, which is why updates are keyed by TID.
 */
export function createAirspaceTransport(space: WorkspaceSpace): SyncTransport {
  const { update, snapshot } = space;

  return {
    async listUpdates(cursor) {
      const page = await update.page({ limit: 100, cursor: cursor ?? undefined });

      return {
        records: page.records.map((record) => ({
          rkey: String(record.rkey),
          docId: record.value.docId,
          update: record.value.update,
          version: record.value.version,
          createdAt: record.value.createdAt,
        })),
        cursor: page.cursor ?? null,
      };
    },

    async listSnapshots(cursor) {
      const page = await snapshot.page({ limit: 100, cursor: cursor ?? undefined });

      return {
        records: page.records.map((record) => ({
          rkey: String(record.rkey),
          docId: record.value.docId,
          snapshot: record.value.snapshot,
          version: record.value.version,
          createdAt: record.value.createdAt,
        })),
        cursor: page.cursor ?? null,
      };
    },

    async createUpdate(record) {
      const result = await update.create(record);

      return result.rkey;
    },

    async createSnapshot(record) {
      const result = await snapshot.create(record);

      return result.rkey;
    },

    async deleteUpdates(rkeys) {
      for (let index = 0; index < rkeys.length; index += MAX_BATCH) {
        const chunk = rkeys.slice(index, index + MAX_BATCH);
        await space.batch((batch) => {
          for (const rkey of chunk) batch.update.delete(rkey);
        });
      }
    },

    async deleteSnapshots(rkeys) {
      for (let index = 0; index < rkeys.length; index += MAX_BATCH) {
        const chunk = rkeys.slice(index, index + MAX_BATCH);
        await space.batch((batch) => {
          for (const rkey of chunk) batch.snapshot.delete(rkey);
        });
      }
    },
  };
}
