import { getPdsEndpoint } from "@atproto/common-web";
import { IdResolver } from "@atproto/identity";

/**
 * DID/PDS resolution. The alpha PDS URLs can move, so resolve per DID and
 * cache in the caller's storage; do not assume the user's PDS is fixed.
 */

export interface IdentityCache {
  getPdsUrl(did: string): string | undefined;
  setPdsUrl(did: string, pdsUrl: string): void;
}

export function createIdResolver(plcUrl = "https://plc.directory"): IdResolver {
  return new IdResolver({ plcUrl });
}

export async function resolvePds(
  did: string,
  resolver: IdResolver,
  cache: IdentityCache,
): Promise<string> {
  const cached = cache.getPdsUrl(did);
  if (cached) return cached;

  const doc = await resolver.did.resolve(did);
  if (!doc) throw new Error(`Could not resolve ${did}`);

  const pdsUrl = getPdsEndpoint(doc);
  if (!pdsUrl) throw new Error(`${did} has no PDS endpoint`);

  cache.setPdsUrl(did, pdsUrl);

  return pdsUrl;
}

/** Resolves a handle (or passes a DID through) to a DID. */
export async function resolveIdentifier(
  identifier: string,
  resolver: IdResolver,
): Promise<string> {
  if (identifier.startsWith("did:")) return identifier;

  const handle = identifier.replace(/^@/, "");
  const did = await resolver.handle.resolve(handle);
  if (!did) throw new Error(`Could not resolve @${handle}`);

  return did;
}
