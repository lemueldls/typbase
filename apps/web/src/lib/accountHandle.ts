/**
 * Handles are written "name.host". The OAuth client takes the bare handle or a
 * DID, so accept a pasted "@name.host", "name@host", or a full DID.
 */
export function normalizeAccountHandle(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("did:")) return value;

  const handle = value.replace(/^@/, "");
  const at = handle.indexOf("@");

  return at > 0 ? `${handle.slice(0, at)}.${handle.slice(at + 1)}` : handle;
}

/** DIDs are long, so show the method prefix and the tail. */
export function shortDid(did: string | null): string {
  if (!did) return "";

  return did.length > 18 ? `${did.slice(0, 10)}...${did.slice(-6)}` : did;
}
