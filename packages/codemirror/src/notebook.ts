import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SvgRangedFrame, TypstDiagnostic } from "@typbase/engine";

import { Facet, StateEffect } from "@codemirror/state";
import { keymap } from "@codemirror/view";

export type NotebookCellType = "prose" | "code" | "log" | "hidden";

/** Every type, in the order the menu lists them. */
export const NOTEBOOK_CELL_TYPES: readonly NotebookCellType[] = ["prose", "code", "log", "hidden"];

/** True when the cell renders in place rather than showing source plus output. */
export function rendersInPlace(kind: NotebookCellType): boolean {
  return kind === "prose";
}

/** True when the cell's source is not part of what the reader sees. */
export function hidesSource(kind: NotebookCellType): boolean {
  return kind === "log" || kind === "hidden";
}

/** True when the cell has an output area below its source. */
export function hasOutput(kind: NotebookCellType): boolean {
  return kind === "code" || kind === "log";
}

export interface NotebookCell {
  kind: NotebookCellType;
  /** `name=` from the attribute line, when it carries one. */
  name?: string | null;
  marker_start: number;
  marker_end: number;
  content_start: number;
  content_end: number;
}

export interface NotebookCellState {
  /** Source hidden behind the header. */
  collapsed?: boolean;
  /**
   * Keep the output this cell had when it was held. For the cells where a live
   * render is wrong or expensive: a heavy query, a non-deterministic one, one
   * with a side effect. See the note in `NotebookOptions.onCompile`.
   */
  held?: boolean;
  /** The held cell's last output, kept by the host. */
  frozen?: NotebookCellOutput;
  /** Output hidden until the cell is refreshed. */
  cleared?: boolean;
}

/** One cell's rendered output: its frames and the diagnostics inside it. */
export interface NotebookCellOutput {
  frames: SvgRangedFrame[];
  diagnostics: TypstDiagnostic[];
}

/** UI strings, injected by the app so the package stays i18n-free. */
export interface NotebookLabels {
  code: string;
  prose: string;
  log: string;
  hidden: string;
  menu: string;
  split: string;
  merge: string;
  moveUp: string;
  moveDown: string;
  duplicate: string;
  remove: string;
  copy: string;
  hold: string;
  release: string;
  clearOutput: string;
  toggleSource: string;
  noOutput: string;
  held: string;
}

export interface NotebookCompileResult {
  text: string;
  frames: SvgRangedFrame[];
  diagnostics: TypstDiagnostic[];
}

export interface NotebookOptions {
  /** Cells for a document text. The host reads them from the engine. */
  cells: (text: string) => NotebookCell[];
  /** Per-cell state. The host owns it. */
  state?: (index: number) => NotebookCellState | undefined;
  labels?: NotebookLabels;
  /** Fires whenever the extension re-extracts cells. */
  onCells?: (cells: NotebookCell[]) => void;
  /** Fires when the cursor moves to a different cell. */
  onActiveCell?: (index: number | null) => void;
  /**
   * Fires after a compile with the fresh frames and diagnostics.
   */
  onCompile?: (result: NotebookCompileResult) => void;
  /** A cell's state changed and the decorations need a rebuild. */
  onStateChange?: () => void;
  /** A command from the rail's overflow menu, so the app owns the actions. */
  onCommand?: (command: string, index: number) => void;
  /** Read-only pages show cells without source or chrome. */
  readOnly?: () => boolean;
}

/** The options of the notebook extension active in this state, if any. */
export const notebookOptionsFacet = Facet.define<NotebookOptions, NotebookOptions | undefined>({
  combine: (values) => values.at(-1),
});

export function notebookOptions(state: EditorState): NotebookOptions | undefined {
  return state.facet(notebookOptionsFacet);
}

/** Re-renders notebooks from cached frames without recompiling. */
export const notebookRefreshEffect = StateEffect.define();

/** First position that belongs to the cell (attribute line, or content). */
export function cellStart(cell: NotebookCell): number {
  return cell.marker_end > cell.marker_start ? cell.marker_start : cell.content_start;
}

/** True when the cell opened with an attribute line rather than a heading. */
export function hasAttribute(cell: NotebookCell): boolean {
  return cell.marker_end > cell.marker_start;
}

/** Index of the cell containing `pos`. Gaps belong to the cell above. */
export function cellIndexAt(cells: NotebookCell[], pos: number): number {
  let index = cells.length ? 0 : -1;

  for (let i = 0; i < cells.length; i++) {
    if (pos >= cellStart(cells[i]!)) index = i;
    else break;
  }

  return index;
}

export function cellsOf(state: EditorState): NotebookCell[] {
  const options = notebookOptions(state);

  return options ? options.cells(state.doc.toString()) : [];
}

/** Position just past a cell's block, including the gap before the next one. */
function blockEnd(cells: NotebookCell[], index: number, text: string): number {
  const next = cells[index + 1];

  return next ? cellStart(next) : text.length;
}

/**
 * The attribute line for a cell type. Prose needs no `kind=`, so a plain cell is
 * three characters.
 */
export function attributeText(type: NotebookCellType, name?: string | null): string {
  const fields = [name ? `name=${name}` : "", type === "prose" ? "" : `kind=${type}`].filter(
    Boolean,
  );

  return fields.length ? `//% ${fields.join(" ")}` : "//%";
}

/**
 * Matches a whole attribute line, indentation and newline included. The rest of
 * the line is taken whole rather than field by field, because this is a text
 * cleaner for exports and the engine already decided what is an attribute.
 */
const ATTRIBUTE_LINE = /^[ \t]*\/\/%[^\r\n]*\r?\n?/gm;

/**
 * Removes cell attribute lines. Notebooks are comments-plus-content, so a
 * cleaned file is the same document for anyone who does not know the
 * convention. Only `//%` goes: any other comment is left as written.
 */
export function stripCellAttributes(text: string): string {
  return text.replace(ATTRIBUTE_LINE, "");
}

/** A text replacement plus where the cursor should land after it. */
export interface CellEdit {
  changes: { from: number; to?: number; insert: string };
  anchor: number;
}

/**
 * Splits a cell at `pos` inside its content. The new cell takes the text from
 * `pos` and inherits the old cell's kind, because a split is a continuation.
 */
export function splitCellText(
  text: string,
  cells: NotebookCell[],
  index: number,
  pos: number,
): CellEdit | null {
  const cell = cells[index];
  if (!cell || pos < cell.content_start || pos > cell.content_end) return null;

  const tail = text.slice(pos, cell.content_end);
  // Collapse the paragraph break the caret sits after, or the new cell opens
  // with a blank line.
  const trimmed = tail.replace(/^\n+/, "");
  const insert = `\n\n${attributeText(cell.kind, cell.name)}\n\n${trimmed}`;

  return {
    changes: { from: pos, to: cell.content_end, insert },
    anchor: pos + 2 + attributeText(cell.kind, cell.name).length + 2,
  };
}

/**
 * Merges a cell into the one above. The result takes the lower cell's kind,
 * since that is the one the reader was last looking at.
 */
export function mergeCellText(cells: NotebookCell[], index: number): CellEdit | null {
  const cell = cells[index];
  const above = cells[index - 1];
  if (!cell || !above) return null;

  // Drop the lower cell's attribute line and join the two bodies.
  const from = cellStart(cell);
  const head = above.content_end > above.content_start ? above.content_end : from;
  const gap = text_between_gap(head, cell.content_start);

  return {
    changes: { from: head, to: cell.content_start, insert: gap },
    anchor: head,
  };
}

/** The whitespace between two offsets, which a merge keeps as a separator. */
function text_between_gap(from: number, to: number): string {
  return from < to ? "\n\n" : "";
}

/**
 * Rewrites a cell's attribute line. A cell that began at a heading has no line
 * to rewrite, so one is inserted.
 */
export function setCellTypeText(
  text: string,
  cells: NotebookCell[],
  index: number,
  type: NotebookCellType,
): CellEdit | null {
  const cell = cells[index];
  if (!cell) return null;
  if (cell.kind === type) return null;

  const attribute = attributeText(type, cell.name);

  if (hasAttribute(cell)) {
    return {
      changes: {
        from: cell.marker_start,
        to: cell.marker_end,
        insert: attribute,
      },
      anchor: cell.content_start + (attribute.length - (cell.marker_end - cell.marker_start)),
    };
  }

  return {
    changes: { from: cellStart(cell), insert: `${attribute}\n` },
    anchor: cell.content_start + attribute.length + 1,
  };
}

/** Appends a cell of `type` after `index` (or at the end of the document). */
export function insertCellText(
  text: string,
  cells: NotebookCell[],
  index: number,
  type: NotebookCellType,
  content = "",
): CellEdit | null {
  const attribute = attributeText(type);
  const at = blockEnd(cells, index, text);
  const prefix = text.slice(Math.max(0, at - 2), at).includes("\n\n") || at === 0 ? "" : "\n\n";
  const insert = `${prefix}${attribute}\n${content}\n\n`;

  return {
    changes: { from: at, insert },
    anchor: at + prefix.length + attribute.length + 1 + content.length,
  };
}

export function deleteCellText(
  cells: NotebookCell[],
  index: number,
  docLength: number,
): CellEdit | null {
  const cell = cells[index];
  if (!cell) return null;

  const next = cells[index + 1];
  const nextStart = next
    ? cellStart(next)
    : // No next cell: take the trailing blank lines with the body so the
      // document does not keep a gap that belonged to this cell.
      docLength;
  const from = hasAttribute(cell) ? cell.marker_start : cell.content_start;

  if (!cells.length || (index === 0 && !next && from === 0)) {
    return { changes: { from: 0, to: docLength, insert: "" }, anchor: 0 };
  }

  return { changes: { from, to: nextStart, insert: "" }, anchor: from };
}

/** Copies a cell's kind, name, and body below it. */
export function duplicateCellText(
  text: string,
  cells: NotebookCell[],
  index: number,
): CellEdit | null {
  const cell = cells[index];
  if (!cell) return null;

  const body = text.slice(cell.content_start, cell.content_end);

  return insertCellText(text, cells, index, cell.kind, body);
}

function dispatchEdit(view: EditorView, edit: CellEdit): boolean {
  view.dispatch({
    changes: edit.changes,
    selection: { anchor: edit.anchor },
    scrollIntoView: true,
  });

  return true;
}

/** Selects a cell's content so the keyboard commands act on it. */
export function focusCell(
  view: EditorView,
  index: number,
  edge: "start" | "end" = "start",
): boolean {
  const cells = cellsOf(view.state);
  const cell = cells[index];
  if (!cell) return false;

  const pos = edge === "start" ? cell.content_start : cell.content_end;
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  view.focus();

  return true;
}

export function currentCell(view: EditorView): number {
  return cellIndexAt(cellsOf(view.state), view.state.selection.main.head);
}

/** Inserts a cell below `index`, or at the end of the document. */
export function insertCell(
  view: EditorView,
  type: NotebookCellType,
  content = "",
  index = -1,
): boolean {
  const cells = cellsOf(view.state);
  const text = view.state.doc.toString();
  const at = index >= 0 ? index : cells.length ? currentCell(view) : -1;
  const edit = insertCellText(text, cells, at, type, content);

  return edit ? dispatchEdit(view, edit) : false;
}

export function duplicateCell(view: EditorView, index = -1): boolean {
  const cells = cellsOf(view.state);
  const at = index >= 0 ? index : currentCell(view);
  const edit = duplicateCellText(view.state.doc.toString(), cells, at);

  return edit ? dispatchEdit(view, edit) : false;
}

export function deleteCell(view: EditorView, index = -1): boolean {
  const cells = cellsOf(view.state);
  const at = index >= 0 ? index : currentCell(view);
  const edit = deleteCellText(cells, at, view.state.doc.length);

  return edit ? dispatchEdit(view, edit) : false;
}

/** Moves the active cell up or down. */
export function moveCell(view: EditorView, delta: number): boolean {
  const cells = cellsOf(view.state);
  const index = currentCell(view);
  const next = index + delta;
  if (next < 0 || next >= cells.length || index < 0) return false;

  const text = view.state.doc.toString();
  const first = cells[index]!;
  const second = cells[next]!;
  const from = cellStart(first);
  const to = cellStart(second);
  const firstEnd = blockEnd(cells, index, text);
  const secondEnd = blockEnd(cells, next, text);

  // Two changes rather than one splice, so the gap between the two cells keeps
  // its place and only the bodies trade positions.
  view.dispatch({
    changes: [
      { from, to: firstEnd, insert: text.slice(to, secondEnd) },
      { from: to, to: secondEnd, insert: text.slice(from, firstEnd) },
    ],
    selection: { anchor: from },
    scrollIntoView: true,
  });

  return true;
}

export function setCellType(view: EditorView, index: number, type: NotebookCellType): boolean {
  const cells = cellsOf(view.state);
  const edit = setCellTypeText(view.state.doc.toString(), cells, index, type);

  return edit ? dispatchEdit(view, edit) : false;
}

export function splitCell(view: EditorView): boolean {
  const cells = cellsOf(view.state);
  const index = currentCell(view);
  const edit = splitCellText(
    view.state.doc.toString(),
    cells,
    index,
    view.state.selection.main.from,
  );

  return edit ? dispatchEdit(view, edit) : false;
}

export function mergeCell(view: EditorView): boolean {
  const cells = cellsOf(view.state);
  const edit = mergeCellText(cells, currentCell(view));

  return edit ? dispatchEdit(view, edit) : false;
}

/**
 * The editor's cell commands. Everything here is also in the cell menu, and
 * every one of them is a text edit, so the undo stack covers them all.
 */
export const notebookKeymap = keymap.of([
  {
    key: "Mod-Enter",
    preventDefault: true,
    run: (view) => focusCell(view, currentCell(view), "end"),
  },
  {
    key: "Mod-Shift-Enter",
    preventDefault: true,
    run: (view) => splitCell(view),
  },
  {
    key: "Mod-Shift-ArrowUp",
    preventDefault: true,
    run: (view) => moveCell(view, -1),
  },
  {
    key: "Mod-Shift-ArrowDown",
    preventDefault: true,
    run: (view) => moveCell(view, 1),
  },
]);
