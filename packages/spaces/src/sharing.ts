import type { DidString, RecordKeyString } from "@atproto/lex-schema";
import type { SpaceRefString } from "@atproto/lex-space";
import type { OAuthSession } from "@atproto/oauth-client-browser";

import { createDidResolver } from "@atproto-labs/did-resolver";
import { buildAgent } from "@atproto/lex-client";
import { l } from "@atproto/lex-schema";
import { SpaceClient } from "@atproto/lex-space";
import { SpaceRef } from "@atproto/syntax";

import { WORKSPACE_SPACE_TYPE } from "./client";
import { collections } from "./collections";

/**
 * A workspace space owned by someone else. The URI is the full
 * `at://ownerdid/space/at.typbase.workspace/skey`, so the skey alone is not a
 * workspace identity once sharing exists.
 */
export interface WorkspaceSpaceRef {
  uri: SpaceRefString;
  ownerDid: DidString;
  skey: string;
}

export function workspaceSpaceRef(ownerDid: string, skey: string): WorkspaceSpaceRef {
  const ref = new SpaceRef(ownerDid as DidString, WORKSPACE_SPACE_TYPE, skey as RecordKeyString);

  return { uri: ref.toString(), ownerDid: ref.spaceDid, skey: ref.skey };
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

  return SpaceClient.openSpace(workspaceSpaceSchema, ref.uri, {
    agent,
    didResolver,
    fetch,
  });
}
