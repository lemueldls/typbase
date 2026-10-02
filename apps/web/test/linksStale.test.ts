import { MemoryBackend, WorkspaceStore } from "@typbase/storage";
import { describe, expect, it } from "vitest";

import { LinkIndex, type LinkSpan } from "../src/lib/links";

/** A source whose only link is the dynamic call the resolver serves. */
const DYNAMIC_SOURCE = "#typbase.page-link(page.id)\n";

function dynamicSpans(text: string): LinkSpan[] {
  return [
    {
      kind: "page-link",
      target: "",
      from: 0,
      to: text.trimEnd().length,
      target_from: "#typbase.page-link(".length,
      target_to: text.trimEnd().length - 1,
      dynamic: true,
    },
  ];
}

/**
 * An index over a real store, with the resolver's answer under the test's
 * control: `setTargets` is what the next resolve returns, so a stale-then-fresh
 * transition is one assignment away.
 */
async function indexWith(targets: string[]): Promise<{
  index: LinkIndex;
  store: WorkspaceStore;
  pageId: string;
  setTargets: (next: string[]) => void;
}> {
  const store = await WorkspaceStore.open(new MemoryBackend(), "links-stale");
  const page = await store.createPage({ title: "Source", content: DYNAMIC_SOURCE });
  await store.flush();

  let answer = targets;
  const index = new LinkIndex(store, dynamicSpans, async () => answer);

  await index.start();
  index.setWanted(Symbol("test"));
  // The first flush and the resolve behind it have debounces of their own, so
  // wait on the index's own state rather than guessing at a delay.
  await expect
    .poll(() => index.recordsFor(page.id).map((record) => record.targetId), { timeout: 5_000 })
    .toEqual([targets[0]]);

  return {
    index,
    store,
    pageId: page.id,
    setTargets: (next) => {
      answer = next;
    },
  };
}

/** Edits the source, so the page is re-extracted before the resolver catches up. */
async function edit(store: WorkspaceStore, pageId: string): Promise<void> {
  await store.setPageText(pageId, `${DYNAMIC_SOURCE}\n#let x = 1\n`);
  await store.flush();
}

const targetsOf = (index: LinkIndex, pageId: string): Array<string | null> =>
  index.recordsFor(pageId).map((record) => record.targetId);

describe("a dynamic link whose page is edited", () => {
  it(
    "keeps its row and marks it pending while the re-resolve is in flight",
    { timeout: 20_000 },
    async () => {
      const { index, store, pageId, setTargets } = await indexWith(["target-a"]);
      expect(index.recordsFor(pageId).every((record) => record.pending)).toBe(false);

      // The resolver will answer differently, and the edit lands first.
      setTargets(["target-b"]);
      await edit(store, pageId);
      await expect
        .poll(() => index.recordsFor(pageId).every((record) => record.pending), { timeout: 5_000 })
        .toBe(true);

      // The row is still there with the target it had, rather than gone. The panel
      // is what stops blanking and refilling on every keystroke.
      expect(targetsOf(index, pageId)).toEqual(["target-a"]);

      index.stop();
    },
  );

  it("settles on the fresh targets and clears the pending flag", { timeout: 20_000 }, async () => {
    const { index, store, pageId, setTargets } = await indexWith(["target-a"]);
    setTargets(["target-b"]);
    await edit(store, pageId);

    await expect.poll(() => targetsOf(index, pageId), { timeout: 5_000 }).toEqual(["target-b"]);
    expect(index.recordsFor(pageId).every((record) => record.pending)).toBe(false);

    index.stop();
  });

  it("never exposes a dynamic record without a target", { timeout: 20_000 }, async () => {
    const { index, store, pageId, setTargets } = await indexWith(["target-a"]);

    setTargets(["target-b"]);
    await edit(store, pageId);
    await expect
      .poll(() => index.recordsFor(pageId).every((record) => record.pending), { timeout: 5_000 })
      .toBe(true);

    // The panel shows one row: the unresolved span stays hidden, and the stale
    // target it falls back to is a real one. Backlinks and the graph read
    // `allRecords`, which resolves dynamic records before answering.
    expect(index.recordsFor(pageId)).toHaveLength(1);
    expect(index.allRecords().every((record) => !record.dynamic || record.targetId)).toBe(true);

    index.stop();
  });
});
