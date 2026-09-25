import { describe, expect, it } from "vitest";

import { downloadFraction, formatBytes } from "../src/lib/updates";

describe("formatBytes", () => {
  it("keeps small sizes in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("scales to the next unit", () => {
    expect(formatBytes(1536)).toBe("1.5 kB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatBytes(1536 * 1024 * 1024)).toBe("1.5 GB");
  });
});

describe("downloadFraction", () => {
  it("is null without a total", () => {
    expect(downloadFraction(null)).toBeNull();
    expect(downloadFraction({ downloaded: 10, total: 0 })).toBeNull();
  });

  it("clamps to one", () => {
    expect(downloadFraction({ downloaded: 25, total: 100 })).toBe(0.25);
    expect(downloadFraction({ downloaded: 150, total: 100 })).toBe(1);
  });
});
