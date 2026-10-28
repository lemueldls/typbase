import { describe, expect, it } from "vitest";

import { installRecordValue } from "../src/lib/installRecord";

describe("installation record", () => {
  it("keeps the first-seen time when the platform changes", () => {
    expect(
      installRecordValue(
        { platform: "web", createdAt: "2026-10-01T00:00:00.000Z" },
        "desktop",
        "2026-10-28T00:00:00.000Z",
      ),
    ).toEqual({
      $type: "at.typbase.install",
      platform: "desktop",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-28T00:00:00.000Z",
    });
  });

  it("does not write when the platform did not change", () => {
    expect(
      installRecordValue(
        { platform: "web", createdAt: "2026-10-01T00:00:00.000Z" },
        "web",
        "2026-10-28T00:00:00.000Z",
      ),
    ).toBeNull();
  });

  it("creates a record when none exists", () => {
    expect(installRecordValue(null, "web", "2026-10-28T00:00:00.000Z")).toEqual({
      $type: "at.typbase.install",
      platform: "web",
      createdAt: "2026-10-28T00:00:00.000Z",
      updatedAt: "2026-10-28T00:00:00.000Z",
    });
  });
});
