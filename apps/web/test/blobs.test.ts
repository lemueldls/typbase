import { blobId, isBlobHash } from "@typbase/storage";
import { describe, expect, it } from "vitest";

describe("blob addresses", () => {
  it("accepts truncated and full digests", () => {
    expect(isBlobHash("a".repeat(16))).toBe(true);
    expect(isBlobHash("a".repeat(64))).toBe(true);
    expect(isBlobHash("a".repeat(15))).toBe(false);
    expect(isBlobHash("a".repeat(65))).toBe(false);
    expect(isBlobHash("g".repeat(16))).toBe(false);
  });

  it("truncates a full digest to the address length", () => {
    expect(blobId("0123456789abcdef".repeat(4))).toBe("0123456789abcdef");
  });
});
