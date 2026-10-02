import type { PageMeta } from "@typbase/typing";

import { describe, expect, it } from "vitest";

import { resolveOpenPageId } from "../src/lib/openPage";

const page = (id: string): PageMeta => ({ id }) as PageMeta;

describe("resolveOpenPageId", () => {
  it("opens the home page while it exists", () => {
    expect(resolveOpenPageId({ homePageId: "b" }, [page("a"), page("b")])).toBe("b");
  });

  it("falls back to the first page when the home page is gone", () => {
    // What a deleted home page looks like: the setting still names it.
    expect(resolveOpenPageId({ homePageId: "gone" }, [page("a"), page("b")])).toBe("a");
  });

  it("uses the first page when no home page is set", () => {
    expect(resolveOpenPageId({ homePageId: null }, [page("a")])).toBe("a");
    expect(resolveOpenPageId({ homePageId: "" }, [page("a")])).toBe("a");
  });

  it("returns null for a workspace with no pages", () => {
    expect(resolveOpenPageId({ homePageId: null }, [])).toBeNull();
    expect(resolveOpenPageId({ homePageId: "gone" }, [])).toBeNull();
  });
});
