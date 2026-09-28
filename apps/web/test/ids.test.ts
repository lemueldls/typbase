import { createId } from "@typbase/storage";
import { describe, expect, it } from "vitest";

describe("createId", () => {
  it("draws eight-character ids", () => {
    expect(createId()).toMatch(/^[a-z][a-z0-9]{7}$/);
  });

  it("redraws when the scope already holds the id", () => {
    let draws = 0;
    const id = createId(() => {
      draws += 1;

      return draws === 1;
    });

    expect(draws).toBe(2);
    expect(id).toMatch(/^[a-z][a-z0-9]{7}$/);
  });
});
