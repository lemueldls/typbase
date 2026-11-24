import type { WorkspaceStore } from "@typbase/storage";

import { describe, expect, it } from "vitest";

import { workspaceCompletionData } from "../src/lib/typstCompletions";

function storeWith(input: {
  pages: Array<{ id: string; path: string; title: string }>;
  categories?: Array<{ id: string; name: string }>;
  plugins?: Array<{ id: string; pluginId: string; title: string }>;
}): WorkspaceStore {
  return {
    listPages: () => input.pages,
    listCategories: () => input.categories ?? [],
    listPluginInstances: () => input.plugins ?? [],
  } as unknown as WorkspaceStore;
}

describe("workspace completion data", () => {
  it("shows page titles and inserts ids", () => {
    const data = workspaceCompletionData(
      storeWith({
        pages: [
          { id: "page-welcome", path: "pages/welcome.typ", title: "Welcome" },
          { id: "page-notes", path: "pages/notes.typ", title: "" },
        ],
      }),
    );

    expect(data.pages).toEqual([
      { label: "Welcome", value: "page-welcome", detail: "pages/welcome.typ" },
      { label: "pages/notes.typ", value: "page-notes", detail: "pages/notes.typ" },
    ]);
  });

  it("derives sorted months and dates from daily paths", () => {
    const data = workspaceCompletionData(
      storeWith({
        pages: [
          { id: "day-one", path: "daily/2026-10-05.typ", title: "October 5" },
          { id: "day-two", path: "daily/2026-11-23.typ", title: "November 23" },
          { id: "day-three", path: "daily/2026-11-01.typ", title: "November 1" },
          { id: "regular", path: "pages/welcome.typ", title: "Welcome" },
        ],
      }),
    );

    expect(data.months).toEqual([
      { label: "2026-11", value: "2026-11", detail: "2 daily notes" },
      { label: "2026-10", value: "2026-10", detail: "1 daily note" },
    ]);
    expect(data.dates.map((date) => date.value)).toEqual([
      "2026-11-23",
      "2026-11-01",
      "2026-10-05",
    ]);
  });

  it("lists categories and plugin instances by their display names", () => {
    const data = workspaceCompletionData(
      storeWith({
        pages: [],
        categories: [{ id: "cat-work", name: "Work" }],
        plugins: [{ id: "instance-calendar", pluginId: "calendar", title: "Team calendar" }],
      }),
    );

    expect(data.categories).toEqual([{ label: "Work", value: "cat-work" }]);
    expect(data.plugins).toEqual([
      { label: "Team calendar", value: "instance-calendar", detail: "calendar" },
    ]);
  });
});
