import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { buildPresenceDecorations, type PresencePeer } from "../src/lib/presenceCursor";

function peers(cursor: PresencePeer["cursor"]): Map<string, PresencePeer> {
  return new Map([
    [
      "peer",
      {
        persona: { name: "Peer", color: "#4f9ddb" },
        cursor,
      },
    ],
  ]);
}

describe("presenceCursors", () => {
  it("renders a collapsed peer selection as a cursor widget", () => {
    const state = EditorState.create({ doc: "Hello" });
    const decorations = buildPresenceDecorations(
      state,
      "doc",
      peers({ docId: "doc", from: 2, to: 2 }),
    );

    expect(decorations.size).toBe(1);
  });

  it("renders a non-empty peer selection as a mark and a cursor widget", () => {
    const state = EditorState.create({ doc: "Hello" });
    const decorations = buildPresenceDecorations(
      state,
      "doc",
      peers({ docId: "doc", from: 1, to: 3 }),
    );

    expect(decorations.size).toBe(2);
  });
});
