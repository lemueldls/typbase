import { describe, expect, it } from "vitest";

import { createNavStack } from "../src/lib/navStack";

const page = (id: string) => ({ page: id });

describe("navStack", () => {
  it("reports nothing to go back or forward to before the first entry", () => {
    const stack = createNavStack();

    expect(stack.current).toBeUndefined();
    expect(stack.canBack).toBe(false);
    expect(stack.canForward).toBe(false);
  });

  it("numbers entries from zero and grows on a push", () => {
    const stack = createNavStack();

    expect(stack.record(page("a"))).toBe(0);
    expect(stack.record(page("b"), { append: true })).toBe(1);

    expect(stack.canBack).toBe(true);
    expect(stack.canForward).toBe(false);
    expect(stack.previous?.query).toEqual(page("a"));
  });

  it("overwrites the current entry on a plain replace", () => {
    const stack = createNavStack();
    stack.record(page("a"));
    stack.record(page("b"), { append: true });

    expect(stack.record(page("b-closed"))).toBe(1);
    expect(stack.current?.query).toEqual(page("b-closed"));
    expect(stack.previous?.query).toEqual(page("a"));
  });

  it("appends after an overlay entry was replaced, so the step is kept", () => {
    const stack = createNavStack();
    stack.record(page("a"));

    // The overlay pushed a browser entry, so the navigation that replaced it
    // lands one position further along than a plain replace would.
    expect(stack.record(page("b"), { append: true })).toBe(1);
    expect(stack.canBack).toBe(true);
    expect(stack.previous?.query).toEqual(page("a"));
  });

  it("drops the forward entries when a new navigation pushes after a back", () => {
    const stack = createNavStack();
    stack.record(page("a"));
    stack.record(page("b"), { append: true });
    stack.record(page("c"), { append: true });

    stack.land(1, page("b"));
    expect(stack.canForward).toBe(true);
    expect(stack.next?.query).toEqual(page("c"));

    expect(stack.record(page("c2"), { append: true })).toBe(2);
    expect(stack.canForward).toBe(false);
    expect(stack.next).toBeUndefined();
  });

  it("places a traversal from the index the entry carries", () => {
    const stack = createNavStack();
    stack.record(page("a"));
    stack.record(page("b"), { append: true });
    stack.record(page("c"), { append: true });

    stack.land(0, page("a"));
    expect(stack.canBack).toBe(false);
    expect(stack.canForward).toBe(true);

    stack.land(2, page("c"));
    expect(stack.canBack).toBe(true);
    expect(stack.canForward).toBe(false);
    expect(stack.previous?.query).toEqual(page("b"));
  });

  it("restarts on an entry it never wrote", () => {
    const stack = createNavStack();
    stack.record(page("a"));
    stack.record(page("b"), { append: true });

    stack.land(undefined, page("elsewhere"));
    expect(stack.current?.index).toBe(0);
    expect(stack.canBack).toBe(false);
    expect(stack.canForward).toBe(false);

    // The stale index of an entry the app did write lands back in the mirror.
    stack.record(page("c"), { append: true });
    expect(stack.canBack).toBe(true);
  });

  it("resets for a new workspace", () => {
    const stack = createNavStack();
    stack.record(page("a"));
    stack.record(page("b"), { append: true });

    stack.reset(page("other"));
    expect(stack.canBack).toBe(false);
    expect(stack.canForward).toBe(false);
    expect(stack.current?.index).toBe(0);
    expect(stack.current?.query).toEqual(page("other"));
  });
});
