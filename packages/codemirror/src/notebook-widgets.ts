import type { Range } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { FileId, SvgRangedFrame, TypstDiagnostic, TypstState } from "@typbase/engine";

import { Decoration, WidgetType } from "@codemirror/view";

import type { ExternalLinkOpener } from "./frames";
import type { NotebookCell } from "./notebook";
import type { NotebookCellState, NotebookLabels, NotebookOptions } from "./notebook";

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
  focusCell,
  hasAttribute,
  hasOutput,
  hidesSource,
  rendersInPlace,
} from "./notebook";

function icon(name: string, size?: number): HTMLElement {
  const span = document.createElement("span");
  span.className = "ms-icon material-symbols-rounded";
  span.setAttribute("aria-hidden", "true");
  if (size !== undefined) {
    span.style.fontSize = `calc(${size}px * var(--ui-size, 1))`;
  }
  span.textContent = name;

  return span;
}

/** A button that must not hand the mousedown to CodeMirror's selection. */
function button(
  name: string,
  label: string,
  onClick: () => void,
  className = "",
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `tb-cell-btn${className ? ` ${className}` : ""}`;
  element.title = label;
  element.setAttribute("aria-label", label);
  element.append(icon(name, RAIL_ICON_SIZE));
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return element;
}

/**
 * Icon size across the rail: the chip glyph, its overflow button, and the menu's
 * items, which is the same row and `UiMenuItem`'s default.
 */
const RAIL_ICON_SIZE = 20;

/** The glyph and label for a cell kind. */
const KIND_PRESENTATION: Record<NotebookCell["kind"], string> = {
  prose: "notes",
  code: "code",
  log: "terminal",
  hidden: "visibility_off",
};

class NotebookRailWidget extends WidgetType {
  private menu: HTMLElement | null = null;

  public constructor(
    private readonly view: EditorView,
    private readonly args: {
      index: number;
      kind: NotebookCell["kind"];
      name?: string | null;
      collapsed: boolean;
      held: boolean;
      labels: NotebookLabels;
      onCommand: (command: string, index: number) => void;
    },
  ) {
    super();
  }

  public override eq(other: NotebookRailWidget) {
    const a = this.args;
    const b = other.args;

    return (
      a.index === b.index &&
      a.kind === b.kind &&
      a.name === b.name &&
      a.collapsed === b.collapsed &&
      a.held === b.held &&
      a.labels === b.labels
    );
  }

  public override ignoreEvent(event: Event): boolean {
    return (
      event.type === "mousedown" && (event.target as HTMLElement).classList.contains("tb-cell-rail")
    );
  }

  public toDOM() {
    const { index, kind, name, labels } = this.args;
    const rail = document.createElement("div");
    rail.className = "tb-cell-rail";
    rail.dataset.kind = kind;
    rail.dataset.cell = String(index);

    const chip = document.createElement("span");
    chip.className = "tb-cell-chip";
    chip.append(icon(KIND_PRESENTATION[kind], RAIL_ICON_SIZE));
    chip.append(document.createTextNode(name || labels[kind]));
    rail.append(chip);

    if (this.args.held) {
      const held = document.createElement("span");
      held.className = "tb-cell-held";
      held.textContent = labels.held;
      rail.append(held);
    }

    const menu = button("more_vert", labels.menu, () => this.toggleMenu(rail), "tb-cell-btn--menu");
    rail.append(menu);

    rail.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      focusCell(this.view, index);
    });

    return rail;
  }

  private toggleMenu(anchor: HTMLElement): void {
    if (this.menu) {
      this.closeMenu();

      return;
    }

    const { labels, index, collapsed, held } = this.args;
    const items: Array<{ command: string; label: string; name: string }> = [
      {
        command: "toggleSource",
        label: labels.toggleSource,
        name: collapsed ? "unfold_more" : "unfold_less",
      },
      { command: "split", label: labels.split, name: "call_split" },
      { command: "merge", label: labels.merge, name: "merge_type" },
      {
        command: "moveUp",
        label: labels.moveUp,
        name: "keyboard_double_arrow_up",
      },
      {
        command: "moveDown",
        label: labels.moveDown,
        name: "keyboard_double_arrow_down",
      },
      { command: "duplicate", label: labels.duplicate, name: "content_copy" },
      { command: "copy", label: labels.copy, name: "content_paste" },
      {
        command: held ? "release" : "hold",
        label: held ? labels.release : labels.hold,
        name: held ? "play_arrow" : "pause",
      },
      {
        command: "clearOutput",
        label: labels.clearOutput,
        name: "delete_sweep",
      },
      { command: "remove", label: labels.remove, name: "delete" },
    ];

    const menu = document.createElement("div");
    menu.className = "menu tb-cell-menu";
    menu.setAttribute("role", "menu");

    for (const item of items) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = "menu__item";
      entry.setAttribute("role", "menuitem");
      entry.append(icon(item.name, RAIL_ICON_SIZE));
      entry.append(document.createTextNode(item.label));
      entry.addEventListener("click", () => {
        this.closeMenu();
        this.args.onCommand(item.command, index);
      });
      menu.append(entry);
    }

    document.body.append(menu);
    const box = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = `${Math.round(box.left)}px`;
    menu.style.top = `${Math.round(box.bottom + 4)}px`;
    this.menu = menu;

    const dismiss = (event: Event): void => {
      if (menu.contains(event.target as Node)) return;
      this.closeMenu();
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
    document.addEventListener("keyup", this.onEscape);
  }

  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.closeMenu();
  };

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
    document.removeEventListener("keyup", this.onEscape);
  }

  public override destroy(): void {
    this.closeMenu();
  }
}

interface OutputArgs {
  index: number;
  frames: SvgRangedFrame[];
  diagnostics: TypstDiagnostic[];
  cleared: boolean;
  /** The cell is held, so what is shown is its last output. */
  held: boolean;
  labels: NotebookLabels;
}

/**
 * A cell's output: its frames and the diagnostics whose span falls inside it.
 */
class NotebookOutputWidget extends WidgetType {
  public constructor(
    private readonly view: EditorView,
    private readonly fileId: FileId,
    private readonly typstState: TypstState,
    private readonly args: OutputArgs,
    private readonly openExternal?: ExternalLinkOpener,
  ) {
    super();
  }

  private get key() {
    const frames = this.args.frames
      .map((frame) => {
        const size = frameSize(frame);

        return `${frame.render.hash}:${Math.round(size.width)}x${Math.round(size.height)}`;
      })
      .join(",");
    const diagnostics = this.args.diagnostics.map((diagnostic) => diagnostic.message).join("|");

    return `${this.args.index}:${this.args.cleared}:${this.args.held}:${frames}:${diagnostics}`;
  }

  public override eq(other: NotebookOutputWidget) {
    return this.key === other.key;
  }

  public toDOM() {
    const root = document.createElement("div");
    const { cleared, held, labels } = this.args;

    root.className = "tb-cell-output";
    if (cleared) {
      root.classList.add("tb-cell-output--cleared");

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
      attachFrameInteractions(
        container,
        this.view,
        frame,
        this.fileId,
        this.typstState,
        this.openExternal,
      );
      holder.append(container);
      body.append(holder);
    }

    if (held) {
      const note = document.createElement("div");
      note.className = "tb-cell-stale";
      note.textContent = labels.held;
      body.append(note);
    } else if (!this.args.frames.length && !this.args.diagnostics.length) {
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

/**
 * The height an off-screen cell's output reserves, without building any of it.
 */
class NotebookOutputSpacer extends WidgetType {
  public constructor(private readonly height: number) {
    super();
  }

  public override eq(other: NotebookOutputSpacer) {
    return this.height === other.height;
  }

  public toDOM() {
    const root = document.createElement("div");
    root.className = "tb-cell-output tb-cell-output--offscreen";

    return root;
  }

  public override get estimatedHeight() {
    return this.height;
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
  readOnly: boolean;
  /**
   * Draw the frames. Source mode keeps the cells, the rails, and the attribute
   * lines but shows the text unrendered, which is what makes it different from
   * write mode for a notebook.
   */
  renderFrames: boolean;
  /** The cell the reader is in, which gets an accent rule down its side. */
  activeIndex: number | null;
  /** A command from the rail's overflow menu. */
  onCommand: (command: string, index: number) => void;
  onExternalLink?: ExternalLinkOpener;
  options: NotebookOptions;
}

export function decorateNotebook(args: NotebookDecorateArgs): Range<Decoration>[] {
  const {
    view,
    state,
    cells,
    frames,
    diagnostics,
    fileId,
    typstState,
    locked,
    readOnly,
    renderFrames,
    activeIndex,
    onCommand,
    onExternalLink,
    options,
  } = args;
  const decorations: Range<Decoration>[] = [];

  const byCell: SvgRangedFrame[][] = cells.map(() => []);
  for (const frame of frames) {
    const index = cellIndexAt(cells, frame.range.start);
    if (index >= 0) byCell[index]!.push(frame);
  }

  const labels = options.labels ?? FALLBACK_LABELS;
  const cellState = (index: number): NotebookCellState => options.state?.(index) ?? {};

  // Only cells near the viewport get a real output widget. One screen of margin
  // covers a fast scroll landing between two frames.
  const visible = new Set<number>();
  for (const range of view.visibleRanges) {
    const from = cellIndexAt(cells, range.from);
    const to = cellIndexAt(cells, range.to);
    for (let index = Math.max(0, from); index <= Math.min(cells.length - 1, to); index++) {
      visible.add(index);
    }
  }

  cells.forEach((cell, index) => {
    const own = cellState(index);
    const firstLine = state.doc.lineAt(cellStart(cell)).from;

    if (index === activeIndex) {
      decorations.push(Decoration.line({ class: "tb-cell-active" }).range(firstLine));
    }

    if (!readOnly) {
      decorations.push(
        Decoration.widget({
          widget: new NotebookRailWidget(view, {
            index,
            kind: cell.kind,
            name: cell.name,
            collapsed: own.collapsed ?? false,
            held: own.held ?? false,
            labels,
            onCommand,
          }),
          block: !hasAttribute(cell),
          side: -1,
        }).range(firstLine),
      );

      if (hasAttribute(cell)) {
        decorations.push(
          Decoration.line({ class: "tb-cell-attribute" }).range(
            state.doc.lineAt(cell.marker_start).from,
          ),
        );
      }
    }

    const contentStart = cell.content_start;
    const contentEnd = cell.content_end;
    const hideSource = (own.collapsed ?? false) || hidesSource(cell.kind);
    if (hideSource && contentEnd > contentStart) {
      decorations.push(Decoration.replace({}).range(contentStart, contentEnd));
    }

    if (hideSource) {
      if (renderFrames) pushDiagnostics(decorations, state, cell, diagnostics);

      return;
    }

    if (rendersInPlace(cell.kind)) {
      if (!renderFrames) return;

      for (const frame of byCell[index] ?? []) {
        const { start, end } = frame.range;
        if (!frame.render || end <= start) continue;

        if (frameIsInactive(view, state, start, end)) {
          decorations.push(
            Decoration.replace({
              widget: new TypstWidget(view, frame, locked, fileId, typstState, onExternalLink),
            }).range(start, end),
          );
        } else {
          decorations.push(...frameActiveDecorations(view, state, frame));
        }
      }

      if (renderFrames) pushDiagnostics(decorations, state, cell, diagnostics);

      return;
    }

    if (!hasOutput(cell.kind)) return;
    if (!renderFrames) return;

    const outputPos = contentEnd > contentStart ? state.doc.lineAt(contentEnd).to : contentStart;
    const held = own.held ?? false;
    const output = held
      ? (own.frozen ?? { frames: [], diagnostics: [] })
      : {
          frames: byCell[index] ?? [],
          diagnostics: cellDiagnosticsFor(cell, diagnostics),
        };

    if (!visible.has(index)) {
      decorations.push(
        Decoration.widget({
          widget: new NotebookOutputSpacer(outputHeight(output.frames)),
          block: true,
          side: 1,
        }).range(outputPos),
      );

      return;
    }

    decorations.push(
      Decoration.widget({
        widget: new NotebookOutputWidget(
          view,
          fileId,
          typstState,
          {
            index,
            frames: output.frames,
            diagnostics: output.diagnostics,
            cleared: own.cleared ?? false,
            held,
            labels,
          },
          onExternalLink,
        ),
        block: true,
        side: 1,
      }).range(outputPos),
    );
  });

  return decorations;
}

function outputHeight(frames: SvgRangedFrame[]): number {
  let height = 0;
  for (const frame of frames) height += frameSize(frame).height;

  return height + 16;
}

/** The diagnostics whose span starts inside a cell's content. */
function cellDiagnosticsFor(cell: NotebookCell, diagnostics: TypstDiagnostic[]): TypstDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.range.start >= cell.content_start && diagnostic.range.start <= cell.content_end,
  );
}

/**
 * A cell's diagnostics as a block under its content, so an error is locatable
 * by cell rather than only in the lint panel.
 */
function pushDiagnostics(
  decorations: Range<Decoration>[],
  state: EditorState,
  cell: NotebookCell,
  diagnostics: TypstDiagnostic[],
): void {
  const own = cellDiagnosticsFor(cell, diagnostics);
  if (!own.length) return;

  const pos =
    cell.content_end > cell.content_start
      ? state.doc.lineAt(cell.content_end).to
      : cell.content_start;

  decorations.push(
    Decoration.widget({
      widget: new NotebookDiagnosticsWidget(own),
      block: true,
      side: 1,
    }).range(pos),
  );
}

class NotebookDiagnosticsWidget extends WidgetType {
  public constructor(private readonly diagnostics: TypstDiagnostic[]) {
    super();
  }

  public override eq(other: NotebookDiagnosticsWidget) {
    return (
      this.diagnostics.length === other.diagnostics.length &&
      this.diagnostics.every(
        (diagnostic, index) => diagnostic.message === other.diagnostics[index]?.message,
      )
    );
  }

  public toDOM() {
    const root = document.createElement("div");
    root.className = "tb-cell-diagnostics";

    for (const diagnostic of this.diagnostics) {
      const item = document.createElement("div");
      item.className = `tb-cell-diagnostic tb-cell-diagnostic--${diagnostic.severity}`;
      item.textContent = diagnostic.message;
      root.append(item);
    }

    return root;
  }

  public override get estimatedHeight() {
    return this.diagnostics.length * 22 + 8;
  }
}

const FALLBACK_LABELS: NotebookLabels = {
  code: "Code",
  prose: "Text",
  log: "Log",
  hidden: "Hidden",
  menu: "Cell actions",
  split: "Split cell",
  merge: "Merge with the cell above",
  moveUp: "Move cell up",
  moveDown: "Move cell down",
  duplicate: "Duplicate cell",
  remove: "Delete cell",
  copy: "Copy cell",
  hold: "Hold output",
  release: "Release output",
  clearOutput: "Clear output",
  toggleSource: "Collapse cell",
  noOutput: "No output",
  held: "Held",
};
