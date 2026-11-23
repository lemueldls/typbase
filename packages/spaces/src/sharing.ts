import type { DidString, NsidString, RecordKeyString } from "@atproto/lex-schema";
import type { SpaceRefString } from "@atproto/lex-space";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import type { WorkspaceInvite, WorkspaceSpaceRef } from "@typbase/typing";

import { createDidResolver } from "@atproto-labs/did-resolver";
import { buildAgent } from "@atproto/lex-client";
import { l } from "@atproto/lex-schema";
import { SpaceClient } from "@atproto/lex-space";
import { SpaceRef } from "@atproto/syntax";

import type { SyncSnapshot, SyncTransport, SyncUpdate } from "./sync";

import { WORKSPACE_SPACE_TYPE } from "./client";
import { collections } from "./collections";

export type { WorkspaceSpaceRef };

export function workspaceSpaceRef(ownerDid: string, skey: string): WorkspaceSpaceRef {
  const ref = new SpaceRef(ownerDid as DidString, WORKSPACE_SPACE_TYPE, skey as RecordKeyString);

  return { uri: ref.toString(), ownerDid: ref.spaceDid, skey: ref.skey };
}

/** Adds the role hint to the share URI. The fragment is not part of the space. */
export function workspaceInviteUri(ref: WorkspaceSpaceRef, role: WorkspaceInvite["role"]): string {
  return `${ref.uri}#${role}`;
}

/** Reads a share URI. A bare space URI joins as a viewer. */
export function parseWorkspaceInvite(value: string): WorkspaceInvite | null {
  const [uri, fragment = ""] = value.trim().split("#", 2);
  const ref = parseWorkspaceSpaceRef(uri ?? "");
  if (!ref) return null;

  return { ...ref, role: fragment === "editor" ? "editor" : "viewer" };
}

/** Parses a pasted space URI, or returns `null` for another type or malformed input. */
export function parseWorkspaceSpaceRef(uri: string): WorkspaceSpaceRef | null {
  try {
    const ref = SpaceRef.parse(uri);
    if (ref.spaceType !== WORKSPACE_SPACE_TYPE) return null;

    return { uri: ref.toString(), ownerDid: ref.spaceDid, skey: ref.skey };
  } catch {
    return null;
  }
}

/** Reads raw update and snapshot records from every active writer. */
export function createSharedTransport(space: SharedWorkspaceSpace): SyncTransport {
  const list = async (
    repo: string,
    collection: NsidString,
    cursor: string | null,
  ): Promise<{ records: Array<{ rkey: string; value: unknown }>; cursor: string | null }> => {
    const page = await space.listRecords({
      repo: repo as DidString,
      collection,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });

    return {
      records: page.body.records.map((record) => ({
        rkey: record.rkey,
        value: record.value,
      })),
      cursor: page.body.cursor ?? null,
    };
  };

  const listUpdates = async (cursor: string | null, repo?: string) => {
    if (!repo) return { records: [] as SyncUpdate[], cursor: null };
    const page = await list(repo, collections.update.nsid, cursor);
    const records: SyncUpdate[] = [];
    for (const record of page.records) {
      const value = record.value as Partial<SyncUpdate> | undefined;
      if (
        value &&
        typeof value.docId === "string" &&
        typeof value.update === "string" &&
        typeof value.version === "string"
      ) {
        records.push({
          rkey: record.rkey,
          docId: value.docId,
          update: value.update,
          version: value.version,
          ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
        });
      }
    }

    return { records, cursor: page.cursor };
  };

  const listSnapshots = async (cursor: string | null, repo?: string) => {
    if (!repo) return { records: [] as SyncSnapshot[], cursor: null };
    const page = await list(repo, collections.snapshot.nsid, cursor);
    const records: SyncSnapshot[] = [];
    for (const record of page.records) {
      const value = record.value as Partial<SyncSnapshot> | undefined;
      if (
        value &&
        typeof value.docId === "string" &&
        typeof value.snapshot === "string" &&
        typeof value.version === "string"
      ) {
        records.push({
          rkey: record.rkey,
          docId: value.docId,
          snapshot: value.snapshot,
          version: value.version,
          ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
        });
      }
    }

    return { records, cursor: page.cursor };
  };

  return {
    async listRepos() {
      const repos = new Set<string>();
      for await (const writer of space.writers()) {
        if (!("repoRev" in writer)) continue;
        repos.add(writer.repo);
      }

      return [...repos];
    },
    listUpdates,
    listSnapshots,
    async createUpdate(record) {
      const response = await space.createRecord({
        $type: collections.update.nsid,
        docId: record.docId,
        update: record.update,
        version: record.version,
        createdAt: record.createdAt,
      });

      return response.body.uri.split("/").pop()!;
    },
    async createSnapshot(record) {
      const response = await space.createRecord({
        $type: collections.snapshot.nsid,
        docId: record.docId,
        snapshot: record.snapshot,
        version: record.version,
        createdAt: record.createdAt,
      });

      return response.body.uri.split("/").pop()!;
    },
    async deleteUpdates(rkeys) {
      for (const rkey of rkeys) await space.deleteRecord(collections.update.nsid, rkey);
    },
    async deleteSnapshots(rkeys) {
      for (const rkey of rkeys) await space.deleteRecord(collections.snapshot.nsid, rkey);
    },
  };
}

/**
 * The workspace collections as a lex-schema space. The credential client uses
 * them for routing and does not validate records; callers validate with the
 * airspace collections.
 */
const workspaceSpaceSchema = l.space("any", WORKSPACE_SPACE_TYPE, [
  collections.update.nsid,
  collections.snapshot.nsid,
  collections.post.nsid,
  collections.asset.nsid,
]);

/** The raw cross-repo methods of a space client. Typed collection helpers are left out. */
export type SharedWorkspaceSpace = Pick<
  SpaceClient,
  | "uri"
  | "listWriters"
  | "writers"
  | "listRecords"
  | "getRecord"
  | "getLatestCommit"
  | "listRepoOps"
  | "getRepo"
  | "createRecord"
  | "putRecord"
  | "deleteRecord"
  | "listBlobs"
  | "getBlob"
>;

export interface SharedWorkspaceOptions {
  session: OAuthSession;
  ref: WorkspaceSpaceRef;
  /** Development PDSes use a local PLC directory. Production uses plc.directory. */
  plcDirectoryUrl?: string | URL;
  /** Shared fetch for DID and cross-repo requests. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Opens a workspace space owned by any account. Reads against the signed-in
 * member's own repo use their OAuth session; reads against another repo use a
 * space credential obtained from the space authority.
 *
 * Writing still targets the signed-in member's repo. A space credential cannot
 * write to the authority's or another member's repo.
 */
export function openSharedWorkspaceSpace(options: SharedWorkspaceOptions): SharedWorkspaceSpace {
  const { session, ref } = options;
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const agent = buildAgent({
    did: session.did as DidString,
    service: session.serverMetadata.issuer,
    fetch: (input, init) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      return session.fetchHandler(`${url.pathname}${url.search}` as `/${string}`, init);
    },
  });

  const didResolver = createDidResolver({
    fetch,
    plcDirectoryUrl: options.plcDirectoryUrl,
  });

  return SpaceClient.openSpace(workspaceSpaceSchema, ref.uri as SpaceRefString, {
    agent,
    didResolver,
    fetch,
  });
}
