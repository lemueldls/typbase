import type { EditorView } from "@codemirror/view";
import type {
  NotebookCell,
  NotebookCellOutput,
  NotebookCellState,
  NotebookCellType,
  NotebookLabels,
  NotebookOptions,
} from "@typbase/codemirror";
import type { FileId, SvgRangedFrame, TypstDiagnostic, TypstState } from "@typbase/engine";

import { cellIndexAt, notebookRefreshEffect, typstRecompileEffect } from "@typbase/codemirror";
import { reactive } from "vue";

import { noteCompileSuccess } from "~/lib/engineHealth";
import { cellsOf } from "~/lib/engineSyntax";

export type { NotebookCellType, NotebookLabels };

/**
 * Notebook session state.
 */
export interface NotebookSession {
  cells: NotebookCell[];
  /** Cells whose source is hidden. */
  collapsed: Record<number, boolean>;
  /**
   * Cells whose output is frozen at its last render. For the cells where a live
   * render is wrong or expensive: a heavy query, a non-deterministic one, or one
   * with a side effect.
   */
  held: Record<number, boolean>;
  /** The held cell's output, kept so releasing it does not blank the cell. */
  frozen: Record<number, NotebookCellOutput>;
  /** The cell the caret is in. */
  active: number | null;
}

export function createNotebookSession(): NotebookSession {
  return reactive({
    cells: [] as NotebookCell[],
    collapsed: {} as Record<number, boolean>,
    held: {} as Record<number, boolean>,
    frozen: {} as Record<number, NotebookCellOutput>,
    active: null,
  }) as NotebookSession;
}

/**
 * Splits one compile's output per cell, the same way the widget does: a frame
 * belongs to the cell holding its start, a diagnostic to the cell whose content
 * range its span falls in.
 */
export function splitCellOutputs(
  cells: NotebookCell[],
  frames: SvgRangedFrame[],
  diagnostics: TypstDiagnostic[],
): NotebookCellOutput[] {
  const outputs: NotebookCellOutput[] = cells.map(() => ({
    frames: [],
    diagnostics: [],
  }));

  for (const frame of frames) {
    const index = cellIndexAt(cells, frame.range.start);
    if (index >= 0) outputs[index]?.frames.push(frame);
  }

  for (const diagnostic of diagnostics) {
    const at = diagnostic.range.start;
    const index = cells.findIndex((cell) => at >= cell.content_start && at <= cell.content_end);
    if (index >= 0) outputs[index]?.diagnostics.push(diagnostic);
  }

  return outputs;
}

/**
 * Engine cells are UTF-16 spans. The package's shape matches field for field.
 */
export function extractNotebookCells(
  typstState: TypstState,
  fileId: FileId,
  text: string,
): NotebookCell[] {
  return cellsOf(typstState, fileId, text);
}

export interface NotebookController {
  options: NotebookOptions;
  /** Re-renders from cached frames, without recompiling. */
  refresh(view: EditorView | undefined): void;
  /** Releases every held cell and recompiles. */
  releaseAll(view: EditorView | undefined): void;
}

export function createNotebookController(args: {
  typstState: TypstState;
  /** The open note's source id, so cell extraction shares its parse tree. */
  fileId: () => FileId;
  session: NotebookSession;
  labels: NotebookLabels;
  readOnly: () => boolean;
  /** Runs a cell command from the rail's overflow menu. */
  onCommand: (command: string, index: number) => void;
}): NotebookController {
  const { typstState, fileId, session, labels, readOnly, onCommand } = args;

  const refresh = (view: EditorView | undefined): void => {
    view?.dispatch({ effects: notebookRefreshEffect.of(null) });
  };

  const options: NotebookOptions = {
    cells: (text) => extractNotebookCells(typstState, fileId(), text),
    state: (index): NotebookCellState => ({
      collapsed: session.collapsed[index] ?? false,
      held: session.held[index] ?? false,
      frozen: session.frozen[index],
    }),
    labels,
    readOnly,
    onCells: (cells) => {
      if (cells.length !== session.cells.length) {
        session.collapsed = {};
        session.held = {};
        session.frozen = {};
      }
      session.cells = cells;
    },
    onActiveCell: (index) => {
      session.active = index;
    },
    onCompile: (result) => {
      // The compile that a cell waits on is also the one that proves the engine
      // recovered. Report it so a notebook that was mid-render when the engine
      // died does not leave the failure breaker set.
      noteCompileSuccess();

      // Snapshot every cell that is not held. The whole page is one compile, so
      // holding cannot stop the next one: this is what a held cell falls back to
      // until it is released.
      const outputs = splitCellOutputs(session.cells, result.frames, result.diagnostics);
      for (let index = 0; index < outputs.length; index++) {
        if (session.held[index]) continue;
        session.frozen[index] = outputs[index]!;
      }
    },
    onStateChange: () => {
      // Nothing to do here yet. The session is reactive, so the widget layer
      // picks the change up through `state()` on the next decoration pass.
    },
    onCommand,
  };

  return {
    options,
    refresh,
    releaseAll(view) {
      session.held = {};
      session.frozen = {};
      // A forced compile repopulates every output from the fresh render.
      view?.dispatch({ effects: typstRecompileEffect.of(null) });
      refresh(view);
    },
  };
}
