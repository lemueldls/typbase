import type { Range } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { FileId, SvgRangedFrame, TypstDiagnostic, TypstState } from "@typbase/engine";

import { Decoration, WidgetType } from "@codemirror/view";

import type { ExternalLinkOpener } from "./frames";
import type {
  NotebookCell,
  NotebookCellState,
  NotebookCellType,
  NotebookLabels,
  NotebookOptions,
} from "./notebook";

import {
  attachFrameInteractions,
  createFrameContainer,
  frameActiveDecorations,
  frameIsInactive,
  frameSize,
  TypstWidget,
} from "./frames";
import {
  NOTEBOOK_CELL_TYPES,
  cellIndexAt,
  cellStart,
  focusCell,
  hasAttribute,
  hasOutput,
  hidesSource,
  notebookRefreshEffect,
  rendersInPlace,
} from "./notebook";

/**
 * Open cell action menus. The editor's focus leaves the rail while one is open
 * (the menu takes focus), and a focus-driven re-decorate would rebuild the
 * rail and remove the menu under the pointer. The plugin holds still while a
 * menu is open; closing one asks for the pass it skipped.
 */
const openRailMenus = new Set<HTMLElement>();

export function notebookRailMenuOpen(): boolean {
  return openRailMenus.size > 0;
}

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

interface RailMenuItem {
  label: string;
  name: string;
  command?: string;
  type?: NotebookCellType;
  checked?: boolean;
  danger?: boolean;
}

class NotebookRailWidget extends WidgetType {
  private menu: HTMLElement | null = null;
  private menuKind: "actions" | "type" | null = null;
  private menuTrigger: HTMLElement | null = null;
  private chip: HTMLButtonElement | null = null;
  private actionsTrigger: HTMLButtonElement | null = null;
  private dismiss: ((event: Event) => void) | null = null;

  public constructor(
    private readonly view: EditorView,
    private readonly args: {
      index: number;
      kind: NotebookCell["kind"];
      name?: string | null;
      collapsed: boolean;
      held: boolean;
      active: boolean;
      labels: NotebookLabels;
      onCommand: (command: string, index: number) => void;
      onSetType?: (index: number, type: NotebookCellType) => void;
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
      a.active === b.active &&
      a.labels === b.labels
    );
  }

  public override ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;

    return event.type === "mousedown" && !!target?.closest(".tb-cell-rail");
  }

  public toDOM() {
    const { index, kind, name, labels, active } = this.args;
    const rail = document.createElement("div");
    rail.className = "tb-cell-rail";
    rail.dataset.kind = kind;
    rail.dataset.cell = String(index);
    rail.classList.toggle("tb-cell-rail--active", active);

    // const number = document.createElement("span");
    // number.className = "tb-cell-number";
    // number.textContent = String(index + 1);
    // rail.append(number);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tb-cell-chip";
    chip.setAttribute("aria-haspopup", "menu");
    chip.setAttribute("aria-expanded", "false");
    chip.setAttribute(
      "aria-label",
      name ? `${labels.cellType}: ${labels[kind]}, ${name}` : `${labels.cellType}: ${labels[kind]}`,
    );
    chip.title = labels.cellType;
    chip.append(icon(KIND_PRESENTATION[kind], RAIL_ICON_SIZE));

    const kindLabel = document.createElement("span");
    kindLabel.className = "tb-cell-kind";
    kindLabel.textContent = labels[kind];
    chip.append(kindLabel);

    if (name) {
      const nameLabel = document.createElement("span");
      nameLabel.className = "tb-cell-name";
      nameLabel.textContent = name;
      chip.append(nameLabel);
    }

    const chevron = icon("arrow_drop_down", 16);
    chevron.classList.add("tb-cell-chevron");
    chip.append(chevron);
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleMenu(chip, "type");
    });
    this.chip = chip;
    rail.append(chip);

    if (this.args.held) {
      const held = document.createElement("span");
      held.className = "tb-cell-held";
      held.textContent = labels.held;
      rail.append(held);
    }

    const actions = button(
      "more_vert",
      labels.menu,
      () => this.toggleMenu(actions, "actions"),
      "tb-cell-btn--menu",
    );
    actions.setAttribute("aria-haspopup", "menu");
    actions.setAttribute("aria-expanded", "false");
    this.actionsTrigger = actions;
    rail.append(actions);

    rail.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      focusCell(this.view, index);
    });

    return rail;
  }

  private toggleMenu(trigger: HTMLElement, kind: "actions" | "type"): void {
    if (this.menu) {
      if (this.menuKind === kind) {
        this.closeMenu();
        this.view.focus();

        return;
      }

      // Another rail menu was open. Replace it without scheduling the focus
      // refresh the close path would normally ask for.
      this.closeMenu(false);
    }

    const { labels, index, collapsed, held } = this.args;
    const groups: RailMenuItem[][] =
      kind === "type"
        ? [
            NOTEBOOK_CELL_TYPES.map((type) => ({
              label: labels[type],
              name: KIND_PRESENTATION[type],
              type,
              checked: type === this.args.kind,
            })),
          ]
        : [
            [
              {
                command: "toggleSource",
                label: labels.toggleSource,
                name: collapsed ? "unfold_more" : "unfold_less",
              },
              { command: "split", label: labels.split, name: "call_split" },
              { command: "merge", label: labels.merge, name: "merge_type" },
            ],
            [
              { command: "moveUp", label: labels.moveUp, name: "keyboard_double_arrow_up" },
              { command: "moveDown", label: labels.moveDown, name: "keyboard_double_arrow_down" },
            ],
            [
              { command: "duplicate", label: labels.duplicate, name: "content_copy" },
              { command: "copy", label: labels.copy, name: "content_paste" },
            ],
            [
              {
                command: held ? "release" : "hold",
                label: held ? labels.release : labels.hold,
                name: held ? "play_arrow" : "pause",
              },
              { command: "clearOutput", label: labels.clearOutput, name: "delete_sweep" },
            ],
            [{ command: "remove", label: labels.remove, name: "delete", danger: true }],
          ];

    const menu = document.createElement("div");
    menu.className = "menu tb-cell-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", kind === "type" ? labels.cellType : labels.menu);

    const entries: HTMLButtonElement[] = [];
    for (const [groupIndex, group] of groups.entries()) {
      if (groupIndex > 0) {
        const separator = document.createElement("div");
        separator.className = "menu__separator";
        separator.setAttribute("role", "separator");
        menu.append(separator);
      }

      for (const item of group) {
        const entry = document.createElement("button");
        entry.type = "button";
        entry.className = item.danger ? "menu__item menu__danger" : "menu__item";
        entry.setAttribute("role", "menuitem");
        entry.append(icon(item.name, RAIL_ICON_SIZE));
        entry.append(document.createTextNode(item.label));
        if (item.checked) {
          const check = icon("check", RAIL_ICON_SIZE);
          check.classList.add("tb-cell-menu-check");
          entry.append(check);
        }
        // Keep the editor's focus and selection while the menu is clicked. A
        // focus change here used to rebuild the decorations and take the menu
        // out from under the pointer before the click landed.
        entry.addEventListener("mousedown", (event) => event.preventDefault());
        entry.addEventListener("click", () => {
          this.closeMenu();
          if (item.type) this.args.onSetType?.(index, item.type);
          else if (item.command) this.args.onCommand(item.command, index);
          this.view.focus();
        });
        entries.push(entry);
        menu.append(entry);
      }
    }

    menu.addEventListener("keydown", (event) => {
      const current = entries.indexOf(document.activeElement as HTMLButtonElement);
      let next: HTMLButtonElement | undefined;
      if (event.key === "ArrowDown")
        next = entries[current < 0 ? 0 : (current + 1) % entries.length];
      else if (event.key === "ArrowUp")
        next =
          entries[
            current < 0 ? entries.length - 1 : (current - 1 + entries.length) % entries.length
          ];
      else if (event.key === "Home") next = entries[0];
      else if (event.key === "End") next = entries.at(-1);
      if (next) {
        event.preventDefault();
        next.focus({ preventScroll: true });
      }
    });

    document.body.append(menu);
    menu.style.position = "fixed";

    const box = trigger.getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, document.documentElement.clientWidth - rect.width - margin);
    let top = box.bottom + 4;
    if (top + rect.height > window.innerHeight - margin) {
      const above = box.top - rect.height - 4;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - rect.height - margin);
    }

    menu.style.left = `${Math.round(Math.min(Math.max(box.left, margin), maxLeft))}px`;
    menu.style.top = `${Math.round(top)}px`;
    this.menu = menu;
    this.menuKind = kind;
    this.menuTrigger = trigger;
    openRailMenus.add(menu);
    trigger.setAttribute("aria-expanded", "true");
    entries[0]?.focus({ preventScroll: true });

    const dismiss = (event: Event): void => {
      const target = event.target as Node;
      if (
        menu.contains(target) ||
        this.chip?.contains(target) ||
        this.actionsTrigger?.contains(target)
      ) {
        return;
      }
      this.closeMenu();
    };
    this.dismiss = dismiss;
    setTimeout(() => {
      if (this.menu === menu && this.dismiss === dismiss) {
        document.addEventListener("mousedown", dismiss);
      }
    }, 0);
    document.addEventListener("keyup", this.onEscape);
    this.view.scrollDOM.addEventListener("scroll", this.onScroll);
    window.addEventListener("resize", this.onResize);
  }

  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    this.closeMenu();
    this.view.focus();
  };

  private readonly onScroll = (): void => {
    this.closeMenu();
  };

  private readonly onResize = (): void => {
    this.closeMenu();
  };

  private closeMenu(refresh = true): void {
    const menu = this.menu;
    if (menu) openRailMenus.delete(menu);
    if (this.dismiss) {
      document.removeEventListener("mousedown", this.dismiss);
      this.dismiss = null;
    }
    this.menuTrigger?.setAttribute("aria-expanded", "false");
    menu?.remove();
    this.menu = null;
    this.menuKind = null;
    this.menuTrigger = null;
    document.removeEventListener("keyup", this.onEscape);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onResize);

    // Focus moved while the menu held the editor, and the plugin skipped that
    // pass. Run it now that the menu is gone.
    if (menu && refresh && openRailMenus.size === 0 && this.view.dom.isConnected) {
      this.view.dispatch({ effects: notebookRefreshEffect.of(null) });
    }
  }

  public override destroy(): void {
    this.closeMenu(false);
  }
}

interface OutputArgs {
  index: number;
  frames: SvgRangedFrame[];
  diagnostics: TypstDiagnostic[];
  cleared: boolean;
  /** The cell is held, so what is shown is its last output. */
  held: boolean;
  /** Read-only cells have no rail to carry the held badge. */
  readOnly: boolean;
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

    return `${this.args.index}:${this.args.cleared}:${this.args.held}:${this.args.readOnly}:${frames}:${diagnostics}`;
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

    if (held && this.args.readOnly) {
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

/** The horizontal rule that separates one cell from the next. */
class NotebookSeparatorWidget extends WidgetType {
  public override eq(_other: NotebookSeparatorWidget) {
    return true;
  }

  public toDOM() {
    const root = document.createElement("div");
    root.className = "tb-cell-separator";
    root.setAttribute("role", "separator");

    return root;
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

    if (index > 0) {
      decorations.push(
        Decoration.widget({
          widget: new NotebookSeparatorWidget(),
          block: true,
          side: -1,
        }).range(firstLine),
      );
    }

    if (index === activeIndex) {
      // The rail chip carries the visible state. The line class stays as the
      // stable hook for tests and anything that needs the active cell's start.
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
            active: index === activeIndex,
            labels,
            onCommand,
            onSetType: options.onSetType,
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

    if (!renderFrames) {
      // Source and split editing still get the cell's diagnostics under it,
      // because there is no lint gutter in a notebook.
      pushDiagnostics(decorations, state, cell, diagnostics);

      return;
    }

    if (hideSource) {
      pushDiagnostics(decorations, state, cell, diagnostics);

      return;
    }

    if (rendersInPlace(cell.kind)) {
      for (const frame of byCell[index] ?? []) {
        const { start, end } = frame.range;
        if (!frame.render || end <= start) continue;

        if (frameIsInactive(view, state, start, end)) {
          decorations.push(
            Decoration.replace({
              widget: new TypstWidget(view, frame, locked, fileId, typstState, onExternalLink),
              typstFrame: true,
            }).range(start, end),
          );
        } else {
          decorations.push(...frameActiveDecorations(view, state, frame));
        }
      }

      pushDiagnostics(decorations, state, cell, diagnostics);

      return;
    }

    if (!hasOutput(cell.kind)) return;

    // The output sits at the cell's block end, after any trailing blank lines.
    // Typing in that gap then stays above it instead of pushing it down.
    const next = cells[index + 1];
    const outputPos = next ? cellStart(next) : state.doc.length;
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
          side: -2,
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
            readOnly,
            labels,
          },
          onExternalLink,
        ),
        block: true,
        side: -2,
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
      this.diagnostics.every((diagnostic, index) => {
        const previous = other.diagnostics[index];

        return (
          diagnostic.message === previous?.message &&
          diagnostic.hints.join("\n") === previous?.hints.join("\n")
        );
      })
    );
  }

  public toDOM() {
    const root = document.createElement("div");
    root.className = "tb-cell-diagnostics";

    for (const diagnostic of this.diagnostics) {
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
      root.append(item);
    }

    return root;
  }

  public override get estimatedHeight() {
    let height = 8;
    for (const diagnostic of this.diagnostics) height += 22 + diagnostic.hints.length * 18;

    return height;
  }
}

const FALLBACK_LABELS: NotebookLabels = {
  code: "Code",
  prose: "Text",
  log: "Log",
  hidden: "Hidden",
  cellType: "Cell type",
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
