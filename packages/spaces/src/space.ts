import type { OAuthSession } from "@atproto/oauth-client-browser";

import { Client } from "@atproto/lex-client";
import { asStringFormat } from "@atproto/lex-schema";

import { APP_SPACE_TYPE } from "./constants";
import { com } from "./lexicons";

/**
 * Space lifecycle. Spaces are access control, not confidentiality: every
 * member's records are plaintext in their permissioned repo. The UI says so;
 * this package just does what the protocol says.
 *
 * Policy per the plan: simplespace with member-list user policy and #open
 * app access, so other atproto apps can read typed data without attestation.
 */

export interface CreateSpaceInput {
  /** Workspace id; becomes the space skey. */
  skey: string;
}

export interface JoinSpaceInput {
  uri: string;
}

export async function createWorkspaceSpace(
  session: OAuthSession,
  { skey }: CreateSpaceInput,
): Promise<string> {
  const client = new Client(session);
  const result = await client.call(com.atproto.simplespace.createSpace, {
    type: APP_SPACE_TYPE,
    skey,
    policy: {
      $type: "com.atproto.simplespace.defs#memberListPolicy",
    },
    appAccess: {
      $type: "com.atproto.simplespace.defs#open",
    },
  });

  return result.uri;
}

export interface SpaceInfo {
  uri: string;
  policy: { $type: string } & Record<string, unknown>;
  appAccess: { $type: string } & Record<string, unknown>;
  ownerDid: string;
}

/** Reads a space's policy/access. Pass either a session (own authority) or a credential (member). */
export async function getSpace(
  client: Client,
  space: string,
  callerDid: string,
): Promise<SpaceInfo> {
  const result = await client.call(com.atproto.simplespace.getSpace, {
    space: asStringFormat(space, "space-ref"),
  });
  const ownerDid = /^at:\/\/(did:[^/]+)\/space\//.exec(result.uri)?.[1] ?? callerDid;

  return {
    uri: result.uri,
    policy: result.policy as SpaceInfo["policy"],
    appAccess: result.appAccess as SpaceInfo["appAccess"],
    ownerDid,
  };
}

export interface Member {
  did: string;
  /** Handles are resolved by the caller through the profile lexicon; the repo list has no handles. */
  handle: string | null;
}

export async function listMembers(credentialClient: Client, space: string): Promise<Member[]> {
  const result = await credentialClient.call(com.atproto.space.listRepos, {
    space: asStringFormat(space, "space-ref"),
    limit: 1000,
  });

  return result.repos.map((repo) => ({ did: repo.did, handle: null }));
}
