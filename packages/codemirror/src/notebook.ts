import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SvgRangedFrame, TypstDiagnostic } from "@typbase/engine";

import { Facet, Prec, StateEffect } from "@codemirror/state";
import { keymap } from "@codemirror/view";

/**
 * Notebook cells. A cell is a `// %%` marker comment plus the content under
 * it, up to the next marker or the end of the document. Offsets are UTF-16
 * and match the engine's `CellSpan`, so `extractCells` results pass through.
 */
export type NotebookCellType = "markup" | "code";

export interface NotebookCell {
  kind: NotebookCellType;
  marker_start: number;
  marker_end: number;
  content_start: number;
  content_end: number;
}

/** Per-cell state the host owns: run counters and visibility. */
export interface NotebookCellState {
  /** Execution counter shown as `[n]`; undefined until the cell is run. */
  count?: number;
  /** Output hidden until the next run. */
  cleared?: boolean;
  /** Source hidden behind the header. */
  collapsed?: boolean;
}

/** UI strings, injected by the app so the package stays i18n-free. */
export interface NotebookLabels {
  run: string;
  code: string;
  markup: string;
  moveUp: string;
  moveDown: string;
  duplicate: string;
  remove: string;
  clearOutput: string;
  toggleSource: string;
  noOutput: string;
  error: string;
}

export interface NotebookCompileResult {
  text: string;
  frames: SvgRangedFrame[];
  diagnostics: TypstDiagnostic[];
}

export interface NotebookOptions {
  /** Cells for a document text; the host reads them from the engine. */
  cells: (text: string) => NotebookCell[];
  /** Run/visibility state per cell index. */
  state?: (index: number) => NotebookCellState | undefined;
  /** Show `[n]` execution counters. */
  counters?: () => boolean;
  labels?: NotebookLabels;
  /** Fires whenever the extension re-extracts cells. */
  onCells?: (cells: NotebookCell[]) => void;
  /** Fires when the cursor moves to a different cell. */
  onActiveCell?: (index: number | null) => void;
  /** Fires after every compile that ran; `run` carries the requested cell. */
  onRun?: (index: number | "all") => void;
  /** Fires after a compile with the fresh frames and diagnostics. */
  onCompile?: (result: NotebookCompileResult) => void;
  onClearOutput?: (index: number) => void;
  onToggleCollapse?: (index: number) => void;
  /** Escape: leave edit mode and select the current cell. */
  onCommandMode?: () => void;
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

/** Asks the plugin to recompile and report the result through `onRun`. */
export const notebookRunEffect = StateEffect.define<{
  index: number | "all";
}>();

/** First position that belongs to the cell (marker line, or content). */
export function cellStart(cell: NotebookCell): number {
  return cell.marker_end > cell.marker_start ? cell.marker_start : cell.content_start;
}

export function hasMarker(cell: NotebookCell): boolean {
  return cell.marker_end > cell.marker_start;
}

/** Index of the cell containing `pos`; gaps belong to the cell above. */
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

/** The marker line for a cell type. Markup is the unlabeled default. */
export function markerText(type: NotebookCellType): string {
  return type === "code" ? "// %% [code]" : "// %%";
}

/** A text replacement plus where the cursor should land after it. */
export interface CellEdit {
  changes: { from: number; to?: number; insert: string };
  anchor: number;
}

export function insertCellText(
  text: string,
  cells: NotebookCell[],
  index: number,
  where: "above" | "below" | "end",
  type: NotebookCellType,
  content = "",
): CellEdit {
  const marker = markerText(type);

  if (where === "end" || cells.length === 0) {
    const from = text.length;
    const prefix = from === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    const insert = `${prefix}${marker}\n${content ? `${content}\n` : ""}`;

    return { changes: { from, insert }, anchor: from + insert.length };
  }

  const cell = cells[index]!;
  const from = where === "above" ? cellStart(cell) : blockEnd(cells, index, text);
  // A blank line after the new cell keeps it a separate paragraph; the gap
  // before the following marker is already there when inserting above.
  const insert = `${marker}\n${content ? `${content}\n` : ""}\n`;

  return {
    changes: { from, insert },
    anchor: from + marker.length + 1 + content.length,
  };
}

export function duplicateCellText(text: string, cells: NotebookCell[], index: number): CellEdit {
  const cell = cells[index]!;

  return insertCellText(
    text,
    cells,
    index,
    "below",
    cell.kind,
    text.slice(cell.content_start, cell.content_end),
  );
}

export function deleteCellText(text: string, cells: NotebookCell[], index: number): CellEdit {
  const cell = cells[index]!;

  if (cells.length <= 1) {
    return { changes: { from: 0, to: text.length, insert: "" }, anchor: 0 };
  }

  const from = cellStart(cell);
  const to = blockEnd(cells, index, text);

  return { changes: { from, to, insert: "" }, anchor: from };
}

export function moveCellText(
  text: string,
  cells: NotebookCell[],
  index: number,
  delta: -1 | 1,
): CellEdit | null {
  const target = index + delta;
  if (target < 0 || target >= cells.length) return null;

  const aStart = cellStart(cells[index]!);
  const aEnd = blockEnd(cells, index, text);
  const bStart = cellStart(cells[target]!);
  const bEnd = blockEnd(cells, target, text);

  const from = Math.min(aStart, bStart);
  const to = Math.max(aEnd, bEnd);
  // Normalize the separation: cells need a blank line between them for the
  // compiler (and the reader), and the document keeps one trailing newline.
  const a = text.slice(aStart, aEnd).trimEnd();
  const b = text.slice(bStart, bEnd).trimEnd();
  const insert = delta < 0 ? `${a}\n\n${b}` : `${b}\n\n${a}`;

  return {
    changes: {
      from,
      to,
      insert: `${insert}${to < text.length ? "\n\n" : "\n"}`,
    },
    anchor: delta < 0 ? bStart : bStart + b.length + 2,
  };
}

export function splitCellText(
  text: string,
  cells: NotebookCell[],
  index: number,
  pos: number,
): CellEdit | null {
  const cell = cells[index]!;
  if (pos < cell.content_start || pos > cell.content_end) return null;

  const insert = `\n\n${markerText(cell.kind)}\n\n`;

  return { changes: { from: pos, insert }, anchor: pos };
}

export function mergeCellText(text: string, cells: NotebookCell[], index: number): CellEdit | null {
  const cell = cells[index]!;
  if (index === 0 || !hasMarker(cell)) return null;

  // Drop the marker line; the gap before it becomes the paragraph break.
  return {
    changes: { from: cell.marker_start, to: cell.content_start, insert: "" },
    anchor: cell.marker_start,
  };
}

export function setCellTypeText(
  text: string,
  cells: NotebookCell[],
  index: number,
  type: NotebookCellType,
): CellEdit {
  const cell = cells[index]!;
  const marker = markerText(type);

  if (hasMarker(cell)) {
    return {
      changes: { from: cell.marker_start, to: cell.marker_end, insert: marker },
      anchor: cell.content_start + (marker.length - (cell.marker_end - cell.marker_start)),
    };
  }

  // An implicit cell gets a marker line of its own.
  return {
    changes: { from: cellStart(cell), insert: `${marker}\n` },
    anchor: cell.content_start + marker.length + 1,
  };
}

/** Matches a whole cell marker line, indentation and newline included. */
const MARKER_LINE = /^[ \t]*\/\/[ \t]*%%(?:[ \t]*\[(?:code|markup|text)\])?[ \t]*\r?\n?/gm;

/**
 * Removes `// %%` cell markers. Notebooks are comments-plus-content, so a
 * cleaned file is the same document for anyone who does not know the
 * convention.
 */
export function stripCellMarkers(text: string): string {
  return text.replace(MARKER_LINE, "");
}

function dispatchEdit(view: EditorView, edit: CellEdit): boolean {
  view.dispatch({
    changes: edit.changes,
    selection: { anchor: edit.anchor },
    scrollIntoView: true,
  });

  return true;
}

/** Compiles and reports through `onRun`; does not move the cursor. */
export function runCell(view: EditorView, index: number): boolean {
  if (!notebookOptions(view.state) || index < 0) return false;

  view.dispatch({ effects: notebookRunEffect.of({ index }) });

  return true;
}

export function runAllCells(view: EditorView): boolean {
  if (!notebookOptions(view.state)) return false;

  view.dispatch({ effects: notebookRunEffect.of({ index: "all" }) });

  return true;
}

export function focusCell(
  view: EditorView,
  index: number,
  edge: "start" | "end" = "start",
): boolean {
  const cells = cellsOf(view.state);
  const cell = cells[index];
  if (!cell) return false;

  view.dispatch({
    selection: {
      anchor: edge === "start" ? cell.content_start : cell.content_end,
    },
    scrollIntoView: true,
  });
  view.focus();

  return true;
}

function currentCell(view: EditorView): number {
  return cellIndexAt(cellsOf(view.state), view.state.selection.main.head);
}

export function insertCell(view: EditorView, where: "above" | "below" | "end"): boolean {
  return insertCellAt(view, currentCell(view), where);
}

export function insertCellAt(
  view: EditorView,
  index: number,
  where: "above" | "below" | "end",
): boolean {
  const cells = cellsOf(view.state);
  if (index < 0 || !cells[index]) return false;

  const type = cells[index]?.kind ?? "markup";
  const edit = insertCellText(view.state.doc.toString(), cells, index, where, type);

  return dispatchEdit(view, edit);
}

export function duplicateCell(view: EditorView): boolean {
  return duplicateCellAt(view, currentCell(view));
}

export function duplicateCellAt(view: EditorView, index: number): boolean {
  const cells = cellsOf(view.state);
  if (index < 0 || !cells[index]) return false;

  return dispatchEdit(view, duplicateCellText(view.state.doc.toString(), cells, index));
}

export function deleteCell(view: EditorView): boolean {
  return deleteCellAt(view, currentCell(view));
}

export function deleteCellAt(view: EditorView, index: number): boolean {
  const cells = cellsOf(view.state);
  if (index < 0 || !cells[index]) return false;

  return dispatchEdit(view, deleteCellText(view.state.doc.toString(), cells, index));
}

export function moveCell(view: EditorView, delta: -1 | 1): boolean {
  return moveCellAt(view, currentCell(view), delta);
}

export function moveCellAt(view: EditorView, index: number, delta: -1 | 1): boolean {
  const cells = cellsOf(view.state);
  if (index < 0 || !cells[index]) return false;

  const edit = moveCellText(view.state.doc.toString(), cells, index, delta);
  if (!edit) return false;

  return dispatchEdit(view, edit);
}

export function splitCell(view: EditorView): boolean {
  const cells = cellsOf(view.state);
  const index = currentCell(view);
  if (index < 0) return false;

  const edit = splitCellText(
    view.state.doc.toString(),
    cells,
    index,
    view.state.selection.main.head,
  );
  if (!edit) return false;

  return dispatchEdit(view, edit);
}

export function mergeCell(view: EditorView): boolean {
  const cells = cellsOf(view.state);
  const index = currentCell(view);
  if (index < 0) return false;

  const edit = mergeCellText(view.state.doc.toString(), cells, index);
  if (!edit) return false;

  return dispatchEdit(view, edit);
}

export function toggleCellType(view: EditorView, index: number): boolean {
  const cells = cellsOf(view.state);
  const cell = cells[index];
  if (!cell) return false;

  const next: NotebookCellType = cell.kind === "code" ? "markup" : "code";
  const edit = setCellTypeText(view.state.doc.toString(), cells, index, next);

  return dispatchEdit(view, edit);
}

export function setCellType(view: EditorView, index: number, type: NotebookCellType): boolean {
  const cells = cellsOf(view.state);
  if (!cells[index]) return false;

  return dispatchEdit(view, setCellTypeText(view.state.doc.toString(), cells, index, type));
}

function runAndAdvance(view: EditorView): boolean {
  const cells = cellsOf(view.state);
  const index = currentCell(view);
  if (index < 0) return false;

  runCell(view, index);

  const next = cells[index + 1];
  if (next) {
    focusCell(view, index + 1);
  } else {
    const edit = insertCellText(
      view.state.doc.toString(),
      cells,
      index,
      "below",
      cells[index]?.kind ?? "markup",
    );
    dispatchEdit(view, edit);
  }

  return true;
}

function runAndInsert(view: EditorView): boolean {
  const cells = cellsOf(view.state);
  const index = currentCell(view);
  if (index < 0) return false;

  runCell(view, index);

  const edit = insertCellText(
    view.state.doc.toString(),
    cells,
    index,
    "below",
    cells[index]?.kind ?? "markup",
  );

  return dispatchEdit(view, edit);
}

function runCurrent(view: EditorView): boolean {
  const index = currentCell(view);

  return index < 0 ? false : runCell(view, index);
}

/** Arrow keys at a cell's first or last line move between cells. */
function boundaryMove(view: EditorView, direction: -1 | 1): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;

  const cells = cellsOf(state);
  const index = cellIndexAt(cells, range.head);
  const cell = cells[index];
  if (!cell) return false;

  if (direction === -1) {
    const first = state.doc.lineAt(cell.content_start);
    if (range.head < first.from || range.head > first.to || index === 0) return false;

    return focusCell(view, index - 1, "end");
  }

  const last = state.doc.lineAt(cell.content_end);
  if (range.head < last.from || range.head > last.to || index >= cells.length - 1) return false;

  return focusCell(view, index + 1);
}

/**
 * Notebook keymap. Mounted with high precedence so Alt-ArrowUp/Down move
 * cells instead of lines and Escape reaches command mode.
 */
export const notebookKeymap = Prec.high(
  keymap.of([
    { key: "Shift-Enter", run: runAndAdvance },
    { key: "Mod-Enter", run: runCurrent },
    { key: "Alt-Enter", run: runAndInsert },
    { key: "Alt-ArrowUp", run: (view) => moveCell(view, -1) },
    { key: "Alt-ArrowDown", run: (view) => moveCell(view, 1) },
    {
      key: "Escape",
      run: (view) => {
        notebookOptions(view.state)?.onCommandMode?.();

        return true;
      },
    },
    { key: "ArrowUp", run: (view) => boundaryMove(view, -1) },
    { key: "ArrowDown", run: (view) => boundaryMove(view, 1) },
  ]),
);
