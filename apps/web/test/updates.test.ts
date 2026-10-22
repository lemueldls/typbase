import { afterEach, describe, expect, it, vi } from "vitest";

import { checkForUpdate, downloadFraction, formatBytes, isNewerVersion } from "../src/lib/updates";

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

describe("isNewerVersion", () => {
  it("compares each numeric segment", () => {
    expect(isNewerVersion("0.5.0", "0.4.1")).toBe(true);
    expect(isNewerVersion("0.4.2", "0.4.1")).toBe(true);
    expect(isNewerVersion("0.4.1", "0.4.1")).toBe(false);
    expect(isNewerVersion("0.4.1", "0.4.2")).toBe(false);
    expect(isNewerVersion("1.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("typbase-v0.5.0", "0.4.1")).toBe(true);
  });

  it("orders prereleases before the release", () => {
    expect(isNewerVersion("0.5.0", "0.5.0-beta.1")).toBe(true);
    expect(isNewerVersion("0.5.0-beta.2", "0.5.0-beta.1")).toBe(true);
    expect(isNewerVersion("0.5.0-beta.1", "0.5.0")).toBe(false);
  });
});

describe("checkForUpdate for package-managed installs", () => {
  afterEach(() => vi.unstubAllGlobals());

  const manager = { id: "pacman", command: "sudo pacman -Syu typbase" };

  function release(version: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          tag_name: `typbase-v${version}`,
          body: "Fixes.",
          published_at: "2026-10-22T00:00:00Z",
        }),
      })),
    );
  }

  it("returns instructions instead of an installer", async () => {
    release("0.5.0");

    const update = await checkForUpdate("desktop-package-managed", {
      manager,
      currentVersion: "0.4.1",
    });

    expect(update?.info).toMatchObject({
      version: "0.5.0",
      currentVersion: "0.4.1",
      managed: true,
      manager,
    });
    expect(update?.start).toBeUndefined();
  });

  it("is current when the installed version matches", async () => {
    release("0.4.1");

    const update = await checkForUpdate("desktop-package-managed", {
      manager,
      currentVersion: "0.4.1",
    });

    expect(update).toBeNull();
  });
});
