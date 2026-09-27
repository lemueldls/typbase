import { describe, expect, it } from "vitest";

import { dailyDate, dailyNeighbors } from "../src/lib/dailyNav";

function daily(id: string, date: string) {
  return { id, path: `daily/${date}.typ` };
}

describe("dailyNeighbors", () => {
  const pages = [
    daily("thu", "2026-09-24"),
    daily("sat", "2026-09-26"),
    daily("fri", "2026-09-25"),
    daily("sun", "2026-09-27"),
  ];

  it("finds the nearest notes on both sides", () => {
    expect(dailyNeighbors(pages, "2026-09-26")).toEqual({ previous: "fri", next: "sun" });
  });

  it("returns null past the ends of the chain", () => {
    expect(dailyNeighbors(pages, "2026-09-24")).toEqual({ previous: null, next: "fri" });
    expect(dailyNeighbors(pages, "2026-09-27")).toEqual({ previous: "sat", next: null });
  });

  it("skips gaps and ignores non-daily pages", () => {
    const sparse = [
      daily("a", "2026-09-20"),
      { id: "home", path: "home.typ" },
      daily("b", "2026-09-30"),
    ];

    expect(dailyNeighbors(sparse, "2026-09-25")).toEqual({ previous: "a", next: "b" });
  });

  it("ignores daily paths that are not ISO dates", () => {
    const odd = [daily("a", "2026-09-20"), { id: "x", path: "daily/notes.typ" }];

    expect(dailyNeighbors(odd, "2026-09-21")).toEqual({ previous: "a", next: null });
  });
});

describe("dailyDate", () => {
  it("reads ISO dates out of daily paths", () => {
    expect(dailyDate("daily/2026-09-27.typ")).toBe("2026-09-27");
    expect(dailyDate("daily/notes.typ")).toBeNull();
    expect(dailyDate("pages/2026-09-27.typ")).toBeNull();
  });
});
