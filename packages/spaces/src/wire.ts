import { base64ToBytes, bytesToBase64 } from "./base64";

/**
 * Record payloads are base64 strings capped at 100,000 graphemes by the
 * atproto lexicon. Loro updates are often much smaller after gzip, especially
 * for text edits, so oversized payloads use a compressed wire format. The
 * prefix is outside the base64 alphabet, which keeps old records readable.
 */
export const COMPRESSED_RECORD_PREFIX = "gzip:";

/** Base64 length above which a record payload is compressed. */
export const RECORD_COMPRESS_ABOVE = 75_000;

/** Compress record bytes when their base64 form would approach the cap. */
export async function encodeRecordBytes(bytes: Uint8Array): Promise<string> {
  const raw = bytesToBase64(bytes);
  if (raw.length <= RECORD_COMPRESS_ABOVE) return raw;

  const compressed = await gzip(bytes);
  if (!compressed) return raw;

  const packed = COMPRESSED_RECORD_PREFIX + bytesToBase64(compressed);

  // Keep the smaller payload. A compressed value that still exceeds the cap
  // cannot help, so the raw value is the more useful failure.
  return packed.length < raw.length ? packed : raw;
}

/** Decode a raw or compressed update/snapshot payload. */
export async function decodeRecordBytes(value: string): Promise<Uint8Array> {
  if (!value.startsWith(COMPRESSED_RECORD_PREFIX)) return base64ToBytes(value);

  const bytes = base64ToBytes(value.slice(COMPRESSED_RECORD_PREFIX.length));

  return gunzip(bytes);
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;

  try {
    return await transform(bytes, new CompressionStream("gzip"));
  } catch {
    return null;
  }
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("compressed sync records are not supported on this device");
  }

  return transform(bytes, new DecompressionStream("gzip"));
}

async function transform(bytes: Uint8Array, stream: TransformStream): Promise<Uint8Array> {
  // Copy into a fresh buffer so TypeScript sees an ArrayBuffer-backed view,
  // which is what Blob accepts.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const compressed = new Blob([copy]).stream().pipeThrough(stream);

  return new Uint8Array(await new Response(compressed).arrayBuffer());
}
