import type { EditorView } from "@codemirror/view";
import type {
  NotebookCell,
  NotebookCellState,
  NotebookLabels,
  NotebookOptions,
} from "@typbase/codemirror";
import type { WorkspaceStore } from "@typbase/storage";
import type { TypstState } from "@typbase/wasm";

import { notebookRefreshEffect, typstRecompileEffect } from "@typbase/codemirror";
import { reactive } from "vue";

/**
 * Notebook session state. Everything here is per open page and per session:
 * execution counters, output visibility, collapse, and the active cell.
 * Counters and cleared flags are keyed by cell index, so a structural edit
 * shifts them; closing the page resets them the way a Jupyter restart does.
 *
 * Outputs are always live: the editor recompiles as the text changes, and a
 * run only records the counter and clears any explicitly cleared output.
 */
export interface NotebookSession {
  cells: NotebookCell[];
  counts: Record<number, number>;
  cleared: Record<number, boolean>;
  collapsed: Record<number, boolean>;
  active: number | null;
  running: number | "all" | null;
}

export function createNotebookSession(): NotebookSession {
  return reactive({
    cells: [] as NotebookCell[],
    counts: {} as Record<number, number>,
    cleared: {} as Record<number, boolean>,
    collapsed: {} as Record<number, boolean>,
    active: null,
    running: null,
  }) as NotebookSession;
}

/** Engine cells are UTF-16 spans; the package's shape matches field for field. */
export function extractNotebookCells(typstState: TypstState, text: string): NotebookCell[] {
  return typstState.extractCells(text) as NotebookCell[];
}

export interface NotebookController {
  options: NotebookOptions;
  /** Clears counters and output visibility, then recompiles. */
  restart(view: EditorView | undefined): void;
  clearOutput(view: EditorView | undefined, index: number): void;
  toggleCollapse(view: EditorView | undefined, index: number): void;
  /** A wasm panic killed the compile a run was waiting on. */
  cancelRun(): void;
}

export function createNotebookController(args: {
  store: WorkspaceStore;
  typstState: TypstState;
  session: NotebookSession;
  labels: NotebookLabels;
  onCommandMode?: () => void;
}): NotebookController {
  const { store, typstState, session, labels, onCommandMode } = args;

  /** Run request waiting for its compile; set by onRun, consumed by onCompile. */
  let pendingRun: number | "all" | null = null;

  const refresh = (view: EditorView | undefined): void => {
    if (!view) return;
    view.dispatch({ effects: notebookRefreshEffect.of(null) });
  };

  const nextCount = (): number => {
    let max = 0;
    for (const value of Object.values(session.counts)) max = Math.max(max, value);

    return max + 1;
  };

  const applyRun = (run: number | "all"): void => {
    if (run === "all") {
      let count = nextCount();
      for (let index = 0; index < session.cells.length; index++) {
        session.counts[index] = count++;
        delete session.cleared[index];
      }

      return;
    }

    // Running cell N also clears the outputs of the cells above it.
    session.counts[run] = nextCount();
    for (let index = 0; index <= run; index++) delete session.cleared[index];
  };

  const options: NotebookOptions = {
    cells: (text) => extractNotebookCells(typstState, text),
    state: (index): NotebookCellState => ({
      count: session.counts[index],
      cleared: session.cleared[index] ?? false,
      collapsed: session.collapsed[index] ?? false,
    }),
    counters: () => store.getSettings().notebook.showCounters,
    labels,
    onCells: (cells) => {
      // Structural changes invalidate output visibility; counters survive,
      // the way Jupyter keeps execution counts across cell moves.
      if (cells.length !== session.cells.length) session.cleared = {};
      session.cells = cells;
    },
    onActiveCell: (index) => {
      session.active = index;
    },
    onRun: (index) => {
      pendingRun = index;
      session.running = index;
    },
    onCompile: () => {
      if (pendingRun !== null) {
        applyRun(pendingRun);
        pendingRun = null;
      }
      session.running = null;
    },
    onClearOutput: (index) => {
      session.cleared[index] = true;
    },
    onToggleCollapse: (index) => {
      session.collapsed[index] = !session.collapsed[index];
    },
    onCommandMode,
  };

  return {
    options,
    restart(view) {
      session.counts = {};
      session.cleared = {};
      pendingRun = null;
      session.running = null;
      // A forced compile repopulates every output.
      view?.dispatch({ effects: typstRecompileEffect.of(null) });
    },
    clearOutput(view, index) {
      session.cleared[index] = true;
      refresh(view);
    },
    toggleCollapse(view, index) {
      session.collapsed[index] = !session.collapsed[index];
      refresh(view);
    },
    cancelRun() {
      pendingRun = null;
      session.running = null;
    },
  };
}
