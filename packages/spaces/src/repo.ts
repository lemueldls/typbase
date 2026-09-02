import type { Client } from "@atproto/lex-client";

import { asStringFormat } from "@atproto/lex-schema";

import { com } from "./lexicons";

/**
 * Record writes and oplog reads inside a space. Everything here goes through
 * a credential client; nothing here touches Loro or workspaces.
 */

export interface RecordInput {
  space: string;
  /** Author DID: normally the signed-in user, always the caller's own repo. */
  repoDid: string;
  collection: `${string}.${string}.${string}`;
  rkey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record: Record<string, any>;
}

export async function createSpaceRecord(
  client: Client,
  input: RecordInput,
): Promise<{ uri: string; cid: string | null }> {
  const result = await client.call(com.atproto.space.createRecord, {
    space: asStringFormat(input.space, "space-ref"),
    repo: asStringFormat(input.repoDid, "did"),
    collection: input.collection,
    validate: false,
    record: { $type: input.collection, ...input.record },
  });

  return { uri: result.uri, cid: result.cid };
}

export async function putSpaceRecord(
  client: Client,
  input: RecordInput,
): Promise<{ uri: string; cid: string | null }> {
  const result = await client.call(com.atproto.space.putRecord, {
    space: asStringFormat(input.space, "space-ref"),
    repo: asStringFormat(input.repoDid, "did"),
    collection: input.collection,
    rkey: input.rkey,
    validate: false,
    record: { $type: input.collection, ...input.record },
  });

  return { uri: result.uri, cid: result.cid };
}

export async function deleteSpaceRecord(
  client: Client,
  input: Omit<RecordInput, "record">,
): Promise<void> {
  await client.call(com.atproto.space.deleteRecord, {
    space: asStringFormat(input.space, "space-ref"),
    repo: asStringFormat(input.repoDid, "did"),
    collection: input.collection,
    rkey: input.rkey,
  });
}

export interface RepoOp {
  rev: string;
  collection: string;
  rkey: string;
  cid: string | null;
  prev: string | null;
  value: unknown;
}

export interface RepoOpsPage {
  ops: RepoOp[];
  /** Present when the page reaches the head of the oplog. */
  commit: { rev: string; hash: Uint8Array } | null;
  cursor: string | null;
}

export async function listRepoOpsPage(
  client: Client,
  input: {
    space: string;
    repoDid: string;
    since?: string | null;
    cursor?: string | null;
    limit?: number;
  },
): Promise<RepoOpsPage> {
  const result = await client.call(com.atproto.space.listRepoOps, {
    space: asStringFormat(input.space, "space-ref"),
    repo: asStringFormat(input.repoDid, "did"),
    ...(input.since ? { since: input.since } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit: input.limit ?? 1000,
  });

  return {
    ops: result.ops.map((op) => ({
      rev: op.rev,
      collection: op.collection,
      rkey: op.rkey,
      cid: op.cid,
      prev: op.prev,
      value: op.value ?? null,
    })),
    commit: result.commit ? { rev: result.commit.rev, hash: result.commit.hash } : null,
    cursor: result.cursor ?? null,
  };
}

const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";

/**
 * atproto TIDs: base32 timestamp (10 chars) plus 3 random chars. The alpha
 * @atproto/syntax dropped the TID constructor, so this is the 15-line spec
 * implementation. TIDs sort chronologically, which is all the sync engine
 * needs from them.
 */
export function nextTid(): string {
  let time = BigInt(Date.now()).toString(32).padStart(10, "2");
  if (time.length > 10) time = time.slice(time.length - 10);

  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);

  let random = "";
  for (const byte of bytes) random += TID_ALPHABET[byte & 31];

  return time + random;
}
