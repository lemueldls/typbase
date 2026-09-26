import { describe, expect, it } from "vitest";

import { formatDocumentTitle } from "../src/lib/documentTitle";

describe("formatDocumentTitle", () => {
  it("joins the page and workspace", () => {
    expect(formatDocumentTitle("Meeting notes", "Personal")).toBe("Meeting notes · Personal");
  });

  it("drops missing parts instead of leaving a separator", () => {
    expect(formatDocumentTitle("Meeting notes", null)).toBe("Meeting notes");
    expect(formatDocumentTitle(undefined, "Personal")).toBe("Personal");
  });

  it("trims and collapses repeats", () => {
    expect(formatDocumentTitle(" Personal ", "Personal")).toBe("Personal");
    expect(formatDocumentTitle("Personal", "")).toBe("Personal");
  });

  it("falls back to the app name", () => {
    expect(formatDocumentTitle()).toBe("Typbase");
    expect(formatDocumentTitle(null, "  ")).toBe("Typbase");
  });
});
