import { afterEach, describe, expect, it, vi } from "vitest";

import { matchesShortcut, shortcutLabel } from "../src/lib/keybindings";

function press(init: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? "",
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  } as KeyboardEvent;
}

afterEach(() => vi.unstubAllGlobals());

describe("keybindings", () => {
  it("uses Alt-Arrow for back and forward outside macOS", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });

    expect(matchesShortcut(press({ key: "ArrowLeft", altKey: true }), "back")).toBe(true);
    expect(matchesShortcut(press({ key: "ArrowRight", altKey: true }), "forward")).toBe(true);
    expect(matchesShortcut(press({ key: "[", code: "BracketLeft", metaKey: true }), "back")).toBe(
      false,
    );
    expect(shortcutLabel("back")).toBe("Alt+←");
  });

  it("uses Mod-Bracket on macOS", () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });

    expect(matchesShortcut(press({ key: "[", code: "BracketLeft", metaKey: true }), "back")).toBe(
      true,
    );
    expect(matchesShortcut(press({ key: "ArrowLeft", altKey: true }), "back")).toBe(false);
    expect(shortcutLabel("back")).toBe("⌘[");
  });

  it("matches modifier chords and rejects extra modifiers", () => {
    vi.stubGlobal("navigator", { userAgent: "Linux" });

    expect(matchesShortcut(press({ key: "s", code: "KeyS", ctrlKey: true }), "save")).toBe(true);
    expect(matchesShortcut(press({ key: "s", code: "KeyS" }), "save")).toBe(false);
    expect(
      matchesShortcut(press({ key: "S", code: "KeyS", ctrlKey: true, shiftKey: true }), "save"),
    ).toBe(false);
    expect(matchesShortcut(press({ key: "?", shiftKey: true }), "shortcuts")).toBe(true);
  });
});
