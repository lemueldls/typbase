import type { AtIdentifierString, Client, NsidString } from "@atproto/lex-client";

import { com } from "./lexicons";

/**
 * Public-repo record operations: publish, unpublish, and public reads. These
 * go to the author's own repo through their PDS with an OAuth session (writes)
 * or a bare client (reads). The public profile page uses the read half.
 */

export interface PublicRecordInput {
  repoDid: AtIdentifierString;
  collection: NsidString;
  rkey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record: Record<string, any>;
}

export async function putPublicRecord(
  client: Client,
  input: PublicRecordInput,
): Promise<{ uri: string; cid: string | null }> {
  const result = await client.call(com.atproto.repo.putRecord, {
    repo: input.repoDid,
    collection: input.collection,
    rkey: input.rkey,
    validate: false,
    record: { $type: input.collection, ...input.record },
  });

  return { uri: result.uri, cid: result.cid };
}

export async function deletePublicRecord(
  client: Client,
  input: Pick<PublicRecordInput, "repoDid" | "collection" | "rkey">,
): Promise<void> {
  await client.call(com.atproto.repo.deleteRecord, {
    repo: input.repoDid,
    collection: input.collection,
    rkey: input.rkey,
  });
}

export interface PublicRecord<T = Record<string, unknown>> {
  uri: string;
  cid: string | null;
  value: T;
}

export async function listPublicRecords<T = Record<string, unknown>>(
  client: Client,
  input: {
    repoDid: string;
    collection: string;
    limit?: number;
    cursor?: string | null;
  },
): Promise<{ records: PublicRecord<T>[]; cursor: string | null }> {
  const result = await client.call(com.atproto.repo.listRecords, {
    repo: input.repoDid as AtIdentifierString,
    collection: input.collection as NsidString,
    ...(input.limit ? { limit: input.limit } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  });

  return {
    records: result.records.map((record) => ({
      uri: record.uri,
      cid: record.cid,
      value: record.value as T,
    })),
    cursor: result.cursor ?? null,
  };
}
