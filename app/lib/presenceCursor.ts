import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/**
 * Renders remote cursors/selections for the current page. Presence data
 * arrives through the relay as a map of peer -> { persona, cursor }; the
 * owning component watches that map and dispatches `presenceRefreshEffect`
 * whenever it changes.
 *
 * Positions are raw source offsets; the editor doc is the raw source, so no
 * coordinate mapping is needed here.
 */

export interface PresencePeer {
  persona: { name: string; color: string };
  cursor: { docId: string; from: number; to: number } | null;
}

export const presenceRefreshEffect = StateEffect.define<void>();

export function refreshPresence(view: EditorView): void {
  view.dispatch({ effects: presenceRefreshEffect.of(undefined) });
}

export function presenceCursors(
  docId: string,
  getPeers: () => Map<string, PresencePeer>,
): Extension {
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    // The field update receives one Transaction, not a ViewUpdate: no
    // viewport info here. Remote cursors are doc-wide raw offsets, so they
    // only need rebuilding when peers change or the doc changes length.
    update(decorations, transaction) {
      const peersChanged = transaction.effects.some((effect) => effect.is(presenceRefreshEffect));
      if (!peersChanged && !transaction.docChanged) return decorations;

      return buildDecorations(transaction.state, docId, getPeers());
    },
    provide: (decorationsField) => EditorView.decorations.from(decorationsField),
  });

  return field;
}

function buildDecorations(
  state: EditorState,
  docId: string,
  peers: Map<string, PresencePeer>,
): DecorationSet {
  const decorations = [];
  for (const [peer, data] of peers) {
    if (!data.cursor || data.cursor.docId !== docId) continue;
    const { from, to } = data.cursor;
    if (from < 0 || to > state.doc.length || from > to) continue;

    const color = data.persona.color;
    decorations.push(
      Decoration.mark({
        class: "typbase-remote-cursor",
        attributes: { style: `--cursor-color: ${color}`, "data-peer": peer },
      }).range(from, to || from),
    );

    decorations.push(
      Decoration.widget({
        widget: new CursorFlagWidget(data.persona.name, color),
        side: 1,
      }).range(to, to),
    );
  }

  return Decoration.set(decorations, true);
}

class CursorFlagWidget extends WidgetType {
  constructor(
    private readonly name: string,
    private readonly color: string,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "typbase-remote-cursor-flag";
    span.style.setProperty("--cursor-color", this.color);
    span.textContent = this.name;

    return span;
  }

  override ignoreEvent() {
    return true;
  }
}
