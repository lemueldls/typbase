import { bytesToBase64, decodeRecordBytes, encodeRecordBytes } from "@typbase/spaces";
import { describe, expect, it } from "vitest";

describe("sync record wire format", () => {
  it("leaves small payloads as plain base64", async () => {
    const bytes = new TextEncoder().encode("hello");
    const encoded = await encodeRecordBytes(bytes);

    expect(encoded).toBe(bytesToBase64(bytes));
    await expect(decodeRecordBytes(encoded)).resolves.toEqual(bytes);
  });

  it("gzips a payload near the atproto string cap", async () => {
    const bytes = new Uint8Array(90_000).fill(0x61);
    const encoded = await encodeRecordBytes(bytes);

    expect(encoded.startsWith("gzip:")).toBe(true);
    expect(encoded.length).toBeLessThan(bytesToBase64(bytes).length);
    await expect(decodeRecordBytes(encoded)).resolves.toEqual(bytes);
  });
});
