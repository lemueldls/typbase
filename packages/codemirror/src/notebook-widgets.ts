import type { EditorState, Range } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { FileId, SvgRangedFrame, TypstDiagnostic, TypstState } from "@typbase/engine";

import { Decoration, WidgetType } from "@codemirror/view";

import type { NotebookCell, NotebookCellState, NotebookLabels, NotebookOptions } from "./notebook";

import {
  attachFrameInteractions,
  createFrameContainer,
  frameActiveDecorations,
  frameIsInactive,
  frameSize,
  TypstWidget,
} from "./frames";
import {
  cellIndexAt,
  cellStart,
  deleteCellAt,
  duplicateCellAt,
  focusCell,
  hasMarker,
  moveCellAt,
  notebookOptions,
  notebookRefreshEffect,
  runCell,
  toggleCellType,
} from "./notebook";

function iconSpan(name: string): HTMLSpanElement {
  const span = document.createElement("span");

  span.className = "ms-icon material-symbols-rounded";
  span.textContent = name;
  span.setAttribute("aria-hidden", "true");

  return span;
}

/** Fallback labels for consumers that enable cells without i18n strings. */
const FALLBACK_LABELS: NotebookLabels = {
  run: "Run cell",
  code: "Code",
  markup: "Text",
  moveUp: "Move cell up",
  moveDown: "Move cell down",
  duplicate: "Duplicate cell",
  remove: "Delete cell",
  clearOutput: "Clear output",
  toggleSource: "Collapse cell",
  noOutput: "No output",
  error: "Cell error",
};

/** Buttons must not hand the mousedown to CodeMirror's selection handling. */
function actionButton(
  icon: string,
  label: string,
  onClick: (event: MouseEvent) => void,
  className = "",
): HTMLButtonElement {
  const button = document.createElement("button");

  button.type = "button";
  button.className = `tb-cell-btn ${className}`.trim();
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(iconSpan(icon));
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });

  return button;
}

interface HeaderArgs {
  index: number;
  kind: NotebookCell["kind"];
  counter: boolean;
  count?: number;
  collapsed: boolean;
  labels: NotebookLabels;
}

class NotebookHeaderWidget extends WidgetType {
  public constructor(
    private readonly view: EditorView,
    private readonly args: HeaderArgs,
  ) {
    super();
  }

  public override eq(other: NotebookHeaderWidget) {
    const a = this.args;
    const b = other.args;

    return (
      a.index === b.index &&
      a.kind === b.kind &&
      a.counter === b.counter &&
      a.count === b.count &&
      a.collapsed === b.collapsed &&
      a.labels === b.labels
    );
  }

  public toDOM() {
    const { index, kind, labels } = this.args;
    const header = document.createElement("div");

    header.className = "tb-cell-header";
    header.dataset.kind = kind;
    header.dataset.cell = String(index);

    const run = actionButton("play_arrow", labels.run, () => runCell(this.view, index));
    run.classList.add("tb-cell-btn--run");
    header.append(run);

    if (this.args.counter) {
      const chip = document.createElement("span");
      chip.className = "tb-cell-counter";
      chip.textContent = this.args.count === undefined ? "[ ]" : `[${this.args.count}]`;
      header.append(chip);
    }

    header.append(
      actionButton(
        kind === "code" ? "code" : "notes",
        kind === "code" ? labels.code : labels.markup,
        () => toggleCellType(this.view, index),
        "tb-cell-btn--type",
      ),
    );

    const spacer = document.createElement("span");
    spacer.className = "tb-cell-spacer";
    header.append(spacer);

    const actions = document.createElement("span");
    actions.className = "tb-cell-actions";
    actions.append(
      actionButton("arrow_upward", labels.moveUp, () => moveCellAt(this.view, index, -1)),
      actionButton("arrow_downward", labels.moveDown, () => moveCellAt(this.view, index, 1)),
      actionButton("content_copy", labels.duplicate, () => duplicateCellAt(this.view, index)),
      actionButton(this.args.collapsed ? "unfold_more" : "unfold_less", labels.toggleSource, () => {
        notebookOptions(this.view.state)?.onToggleCollapse?.(index);
        this.view.dispatch({ effects: notebookRefreshEffect.of(null) });
      }),
      actionButton("delete_sweep", labels.clearOutput, () => {
        notebookOptions(this.view.state)?.onClearOutput?.(index);
        this.view.dispatch({ effects: notebookRefreshEffect.of(null) });
      }),
      actionButton("delete", labels.remove, () => deleteCellAt(this.view, index)),
    );
    header.append(actions);

    // Clicking the bar selects the cell without fighting the buttons.
    header.addEventListener("mousedown", (event) => {
      if ((event.target as Element | null)?.closest("button")) return;
      event.preventDefault();
      focusCell(this.view, index);
    });

    return header;
  }

  public override get estimatedHeight() {
    return 24;
  }
}

interface OutputArgs {
  index: number;
  frames: SvgRangedFrame[];
  diagnostics: TypstDiagnostic[];
  cleared: boolean;
  /** The cell has been run at least once; only then does "No output" show. */
  hasRun: boolean;
  labels: NotebookLabels;
}

class NotebookOutputWidget extends WidgetType {
  public constructor(
    private readonly view: EditorView,
    private readonly fileId: FileId,
    private readonly typstState: TypstState,
    private readonly args: OutputArgs,
  ) {
    super();
  }

  /** Hash of everything the DOM depends on; DOM identity is expensive. */
  private get key(): string {
    const frames = this.args.frames.map((frame) => frame.render.hash).join(",");
    const diagnostics = this.args.diagnostics.map((diagnostic) => diagnostic.message).join("|");

    return `${this.args.index}:${this.args.cleared}:${this.args.hasRun}:${frames}:${diagnostics}`;
  }

  public override eq(other: NotebookOutputWidget) {
    return this.key === other.key;
  }

  public toDOM() {
    const root = document.createElement("div");
    const { cleared, labels } = this.args;

    root.className = "tb-cell-output";
    if (cleared) {
      root.classList.add("tb-cell-output--cleared");

      return root;
    }

    const hasContent =
      this.args.frames.length > 0 || this.args.diagnostics.length > 0 || this.args.hasRun;
    if (!hasContent) {
      root.classList.add("tb-cell-output--empty");

      return root;
    }

    const body = document.createElement("div");
    body.className = "tb-cell-output-body";

    for (const diagnostic of this.args.diagnostics) {
      const item = document.createElement("div");
      item.className = `tb-cell-diagnostic tb-cell-diagnostic--${diagnostic.severity}`;
      item.textContent = diagnostic.message;
      if (diagnostic.hints.length) {
        const hints = document.createElement("ul");
        for (const hint of diagnostic.hints) {
          const entry = document.createElement("li");
          entry.textContent = hint;
          hints.append(entry);
        }
        item.append(hints);
      }
      body.append(item);
    }

    for (const frame of this.args.frames) {
      const holder = document.createElement("div");
      holder.className = "tb-cell-frame";

      const container = createFrameContainer(frame);
      attachFrameInteractions(container, this.view, frame, this.fileId, this.typstState);
      holder.append(container);
      body.append(holder);
    }

    if (!this.args.frames.length && !this.args.diagnostics.length && this.args.hasRun) {
      const empty = document.createElement("div");
      empty.className = "tb-cell-empty";
      empty.textContent = labels.noOutput;
      body.append(empty);
    }

    root.append(body);

    return root;
  }

  public override get estimatedHeight() {
    let height = 0;
    for (const frame of this.args.frames) height += frameSize(frame).height;

    return height + 16;
  }
}

export interface NotebookDecorateArgs {
  view: EditorView;
  state: EditorState;
  cells: NotebookCell[];
  frames: SvgRangedFrame[];
  diagnostics: TypstDiagnostic[];
  fileId: FileId;
  typstState: TypstState;
  locked: boolean;
  options: NotebookOptions;
}

export function decorateNotebook(args: NotebookDecorateArgs): Range<Decoration>[] {
  const { view, state, cells, frames, diagnostics, fileId, typstState, locked, options } = args;
  const decorations: Range<Decoration>[] = [];

  const byCell: SvgRangedFrame[][] = cells.map(() => []);
  for (const frame of frames) {
    const index = cellIndexAt(cells, frame.range.start);
    if (index >= 0) byCell[index]!.push(frame);
  }

  const counter = options.counters?.() ?? false;

  cells.forEach((cell, index) => {
    const cellState: NotebookCellState = options.state?.(index) ?? {};

    // The header rides the marker line as an inline widget, so it never
    // collides with an output block widget placed at the same position.
    const headerPos = state.doc.lineAt(cellStart(cell)).from;
    decorations.push(
      Decoration.widget({
        widget: new NotebookHeaderWidget(view, {
          index,
          kind: cell.kind,
          counter,
          count: cellState.count,
          collapsed: cellState.collapsed ?? false,
          labels: options.labels ?? FALLBACK_LABELS,
        }),
        side: -1,
      }).range(headerPos),
    );

    if (hasMarker(cell)) {
      decorations.push(
        Decoration.line({ class: "tb-cell-marker" }).range(
          state.doc.lineAt(cell.marker_start).from,
        ),
      );
    }

    // Collapse hides the source; a code cell keeps its output, a markup cell
    // has nothing else to show.
    const hideContent = cellState.collapsed && cell.content_end > cell.content_start;
    if (hideContent) {
      decorations.push(Decoration.replace({}).range(cell.content_start, cell.content_end));
    }

    if (cell.kind === "markup") {
      if (cellState.collapsed) return;

      for (const frame of byCell[index] ?? []) {
        const { start, end } = frame.range;
        if (!frame.render || end <= start) continue;

        if (frameIsInactive(view, state, start, end)) {
          decorations.push(
            Decoration.replace({
              widget: new TypstWidget(view, frame, locked, fileId, typstState),
            }).range(start, end),
          );
        } else {
          decorations.push(...frameActiveDecorations(view, state, frame));
        }
      }

      return;
    }

    // Code cells keep their source visible; the render moves below the cell.
    const outputPos =
      cell.content_end > cell.content_start
        ? state.doc.lineAt(cell.content_end).to
        : cell.content_start;
    const cellDiagnostics = diagnostics.filter(
      (diagnostic) =>
        diagnostic.range.start >= cell.content_start && diagnostic.range.start <= cell.content_end,
    );

    decorations.push(
      Decoration.widget({
        widget: new NotebookOutputWidget(view, fileId, typstState, {
          index,
          frames: byCell[index] ?? [],
          diagnostics: cellDiagnostics,
          cleared: cellState.cleared ?? false,
          hasRun: cellState.count !== undefined,
          labels: options.labels ?? FALLBACK_LABELS,
        }),
        block: true,
        side: 1,
      }).range(outputPos),
    );
  });

  return decorations;
}
