import type { DidString, NsidString, RecordKeyString } from "@atproto/lex-schema";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import type { WorkspaceInvite, WorkspaceSpaceRef } from "@typbase/typing";
import type { SpaceReader } from "airspace";

import { createDidResolver } from "@atproto-labs/did-resolver";
import { SpaceRef } from "@atproto/syntax";

import type { WorkspaceClient, WorkspaceSpace } from "./client";
import type { SyncSnapshot, SyncTransport, SyncUpdate } from "./sync";

import { createAirspaceTransport, createWorkspaceClient, WORKSPACE_SPACE_TYPE } from "./client";
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
  const own = createAirspaceTransport(space.own);
  const list = async (
    repo: string,
    collection: NsidString,
    cursor: string | null,
  ): Promise<{ records: Array<{ rkey: string; value: unknown }>; cursor: string | null }> => {
    const page = await space.reader.listRecords({
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
      for await (const writer of space.reader.writers()) {
        if (!("repoRev" in writer)) continue;
        repos.add(writer.repo);
      }

      return [...repos];
    },
    listUpdates,
    listSnapshots,
    createUpdate: own.createUpdate,
    createSnapshot: own.createSnapshot,
    deleteUpdates: own.deleteUpdates,
    deleteSnapshots: own.deleteSnapshots,
  };
}

/** A shared space's reader and the signed-in member's own repo in it. */
export interface SharedWorkspaceSpace {
  /** Reads writers and repos across the space with a space credential. */
  reader: SpaceReader;
  /** Writes updates, snapshots, and settings to the member's own repo. */
  own: WorkspaceSpace;
  /** The member's client for the shared space. */
  client: WorkspaceClient;
}

export interface SharedWorkspaceOptions {
  session: OAuthSession;
  ref: WorkspaceSpaceRef;
  /** Development PDSes use a local PLC directory. Production uses plc.directory. */
  plcDirectoryUrl?: string | URL;
  /** Shared fetch for DID and cross-repo requests. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Opens a workspace space owned by any account. Reads use a space credential;
 * writes stay on the signed-in member's own repo.
 */
export async function openSharedWorkspaceSpace(
  options: SharedWorkspaceOptions,
): Promise<SharedWorkspaceSpace> {
  const { session, ref } = options;
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const client = createWorkspaceClient({
    session,
    did: session.did,
    service: session.serverMetadata.issuer,
    workspaceId: ref.skey,
    skey: ref.skey,
    ownerDid: ref.ownerDid,
  });

  const reader = await client.workspace.reader({
    fetch,
    ...(options.plcDirectoryUrl
      ? { didResolver: createDidResolver({ fetch, plcDirectoryUrl: options.plcDirectoryUrl }) }
      : {}),
  });

  return { reader, own: client.workspace, client };
}
