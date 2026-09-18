/**
 * Local media store. Blobs are content-addressed under
 * `workspaces/<id>/blobs/<sha256>`; nothing here talks to atproto, it is the
 * cache and the only copy until a page is published to a space.
 */

export interface BlobEntry {
  hash: string;
  size: number;
  modifiedAt?: number;
}

export function blobPath(workspaceId: string, hash: string): string {
  return `workspaces/${workspaceId}/blobs/${hash}`;
}

/** Content addresses are lowercase SHA-256 hex; never trust a request path. */
export function isBlobHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function startsWith(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (bytes[index] !== text.charCodeAt(index)) return false;
  }

  return true;
}

function bytesAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }

  return true;
}

/** Magic-byte sniffing for the media the app and Typst can actually use. */
export function sniffMime(bytes: Uint8Array): string {
  if (bytes.length === 0) return "application/octet-stream";

  if (startsWith(bytes, "\x89PNG\r\n\x1a\n")) return "image/png";
  if (startsWith(bytes, "\xff\xd8\xff")) return "image/jpeg";
  if (startsWith(bytes, "GIF87a") || startsWith(bytes, "GIF89a")) return "image/gif";
  if (startsWith(bytes, "RIFF") && bytesAt(bytes, 8, "WEBP")) return "image/webp";
  if (startsWith(bytes, "RIFF") && bytesAt(bytes, 8, "WAVE")) return "audio/wav";
  if (startsWith(bytes, "OggS")) return "audio/ogg";
  if (startsWith(bytes, "ID3") || startsWith(bytes, "\xff\xfb")) return "audio/mpeg";
  if (startsWith(bytes, "%PDF")) return "application/pdf";
  if (bytesAt(bytes, 4, "ftyp")) return "video/mp4";
  if (startsWith(bytes, "\x1aE\xdf\xa3")) return "video/webm";
  if (startsWith(bytes, "wOF2")) return "font/woff2";
  if (startsWith(bytes, "wOFF")) return "font/woff";
  if (startsWith(bytes, "OTTO") || startsWith(bytes, "\x00\x01\x00\x00")) return "font/ttf";

  // SVG is text; decode a bounded prefix so a huge file cannot stall.
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
};

/** File extension Typst uses to pick an image decoder. */
export function mimeExtension(mime: string): string {
  return EXTENSIONS[mime] ?? "bin";
}

/** Virtual path a page can hand to `#image(...)` or `#link(...)`. */
export function blobReference(hash: string, mime: string): string {
  return `/typbase/blob/${hash}.${mimeExtension(mime)}`;
}
