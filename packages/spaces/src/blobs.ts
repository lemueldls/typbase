import type { OAuthSession } from "@atproto/oauth-client-browser";

import { Client } from "@atproto/lex-client";
import { getBlobCidString, getBlobMime, getBlobSize, type BlobRef } from "@atproto/lex-data";

import { SpaceCredential } from "./credentials";
import { com } from "./lexicons";

/**
 * Blob plumbing. Space blobs carry media referenced by pages; uploads go
 * through the session (com.atproto.repo.uploadBlob) the same way Bulletin
 * posts note images, and reads go through the space credential so members on
 * other PDSes can fetch.
 */
export type { BlobRef };

export async function uploadBlob(
  session: OAuthSession,
  bytes: Uint8Array,
  mimeType: string,
): Promise<BlobRef> {
  const client = new Client(session);
  const result = await client.call(com.atproto.repo.uploadBlob, bytes, {
    encoding: mimeType as `${string}/${string}`,
  });
  if (!result.blob || getBlobMime(result.blob) !== mimeType) {
    throw new Error("PDS returned an invalid blob reference");
  }

  return result.blob as BlobRef;
}

export function blobRefCid(blob: BlobRef): string {
  return getBlobCidString(blob);
}

export function blobRefMime(blob: BlobRef): string {
  return getBlobMime(blob) ?? "application/octet-stream";
}

export function blobRefSize(blob: BlobRef): number {
  return getBlobSize(blob) ?? 0;
}

export async function fetchSpaceBlob(
  credential: SpaceCredential,
  pdsUrl: string,
  input: { space: string; repoDid: string; cid: string },
): Promise<Uint8Array> {
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.space.getBlob`);
  url.searchParams.set("space", input.space);
  url.searchParams.set("repo", input.repoDid);
  url.searchParams.set("cid", input.cid);

  const response = await credential.fetch(url);
  if (!response.ok) {
    throw new Error(`Blob fetch failed (${response.status})`);
  }

  return new Uint8Array(await response.arrayBuffer());
}
