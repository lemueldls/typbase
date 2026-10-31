import type { EditorState, Extension } from "@codemirror/state";
import type { ReplacedFrame } from "@typbase/codemirror";

import { StateEffect } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { replacedFrames } from "@typbase/codemirror";

export interface PresencePeer {
  persona: { name: string; color: string };
  cursor: { docId: string; from: number; to: number } | null;
}

interface PresenceLabel {
  name: string;
  color: string;
}

export const presenceRefreshEffect = StateEffect.define<void>();

export function refreshPresence(view: EditorView): void {
  view.dispatch({ effects: presenceRefreshEffect.of(undefined) });
}

export function presenceCursors(
  docId: string,
  getPeers: () => Map<string, PresencePeer>,
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.decorations = buildPresenceDecorations(view.state, docId, getPeers());
      }

      update(update: ViewUpdate) {
        // The typst pass replaces inactive blocks with widgets after a
        // selection or focus change, so the anchors must rebuild with it.
        this.decorations = buildPresenceDecorations(update.state, docId, getPeers());
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

export function buildPresenceDecorations(
  state: EditorState,
  docId: string,
  peers: Map<string, PresencePeer>,
  frames: readonly ReplacedFrame[] = replacedFrames(state),
): DecorationSet {
  const decorations = [];
  const blockPeers = new Map<number, PresenceLabel[]>();

  for (const [peer, data] of peers) {
    if (!data.cursor || data.cursor.docId !== docId) continue;
    const { from, to } = data.cursor;
    if (from < 0 || to > state.doc.length || from > to) continue;

    const color = data.persona.color;
    const label = { name: data.persona.name, color };
    const frame = frames.find((range) => to >= range.from && to <= range.to);

    if (frame) {
      const labels = blockPeers.get(frame.from) ?? [];
      labels.push(label);
      blockPeers.set(frame.from, labels);
      continue;
    }

    // A collapsed selection is a cursor, not a mark. CodeMirror rejects
    // zero-length marks, which is what a peer's unfocused caret sends.
    if (to > from) {
      decorations.push(
        Decoration.mark({
          class: "typbase-remote-cursor",
          attributes: { style: `--cursor-color: ${color}`, "data-peer": peer },
        }).range(from, to),
      );
    }

    decorations.push(
      Decoration.widget({
        widget: new CursorFlagWidget([label]),
        side: 1,
      }).range(to, to),
    );
  }

  // A peer inside a rendered block has no source text to sit in. Point the
  // flag at the start of the block instead of letting the inline widget land
  // at the hidden source end, which is the far right edge of the render.
  for (const [pos, labels] of blockPeers) {
    decorations.push(
      Decoration.widget({
        widget: new CursorFlagWidget(labels, true),
        side: -1,
      }).range(pos, pos),
    );
  }

  return Decoration.set(decorations, true);
}

class CursorFlagWidget extends WidgetType {
  constructor(
    private readonly labels: readonly PresenceLabel[],
    private readonly block = false,
  ) {
    super();
  }

  toDOM() {
    const anchor = document.createElement("span");
    anchor.className = "typbase-remote-cursor-anchor";
    if (this.block) anchor.classList.add("typbase-remote-cursor-anchor--block");

    this.labels.forEach((label, index) => {
      const flag = document.createElement("span");
      flag.className = "typbase-remote-cursor-flag";
      flag.style.setProperty("--cursor-color", label.color);
      if (this.block) flag.style.top = `${index * 1.15}em`;
      flag.textContent = label.name;
      anchor.append(flag);
    });

    return anchor;
  }

  override eq(other: CursorFlagWidget) {
    return (
      other.block === this.block &&
      other.labels.length === this.labels.length &&
      other.labels.every(
        (label, index) =>
          label.name === this.labels[index]?.name && label.color === this.labels[index]?.color,
      )
    );
  }

  override ignoreEvent() {
    return true;
  }
}
