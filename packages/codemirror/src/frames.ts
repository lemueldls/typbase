import type { EditorState, Range } from "@codemirror/state";
import type { FileId, SvgRangedFrame, TypstState } from "@typbase/wasm";

import { Decoration } from "@codemirror/view";
import { EditorView, WidgetType } from "@codemirror/view";
import { LRUCache } from "lru-cache";

// Frame geometry comes back in the app's display units: one Typst point per
// CSS pixel, so pt values are used as px directly. Converting px <-> true pt
// (96/72) would make frames render 4/3 larger than the editor's own text.

const containerCache = new LRUCache<number, HTMLElement>({ max: 128 });

/**
 * The compiled size of an SVG frame, from the markup's viewBox. The viewBox
 * is the page width the engine laid out at (pt), and the app renders one
 * Typst point per CSS pixel, so the numbers map to px directly.
 *
 * `frame.render.width` is the chunk's bounding-box width, which does not
 * change with the pane for fixed-size blocks (images, boxes) — the viewBox
 * width is the correct resize key, and the size to pin: a render laid out
 * for a wider pane must keep its size, not be stretched by CSS while a
 * resize is in flight.
 */
export function frameSize(frame: SvgRangedFrame): { width: number; height: number } {
  const match = frame.render.svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);

  return {
    width: match ? Number(match[1]) : frame.render.width,
    height: match ? Number(match[2]) : frame.render.height,
  };
}

/**
 * Pins a container's SVG to the compiled frame size (via CSS variables). The
 * container keeps max-width: 100% so it never exceeds the line — an explicit
 * container width would make CodeMirror's flex layout grow the content width
 * forever (resize -> wider widget -> wider content). The pinned SVG overflows
 * the clamped container while the pane is narrower than the compiled width;
 * the scroller clips it, so the render stays its size instead of scaling.
 */
export function syncFrameContainer(container: HTMLElement, frame: SvgRangedFrame): void {
  const size = frameSize(frame);
  const widthKey = Math.round(size.width).toString();

  if (container.dataset.renderWidth === widthKey) return;

  container.dataset.renderWidth = widthKey;
  container.style.setProperty("--render-w", size.width + "px");
  container.style.setProperty("--render-h", size.height + "px");
  container.style.height = size.height + "px";
  container.setHTMLUnsafe(frame.render.svg);
}

/** Fresh frame container for widgets that own their DOM (notebook outputs). */
export function createFrameContainer(frame: SvgRangedFrame): HTMLElement {
  const container = document.createElement("div");

  container.dataset.hash = frame.render.hash.toString();
  container.classList.add("typst-render");
  syncFrameContainer(container, frame);

  return container;
}

/**
 * Click handling shared by inline widgets and notebook outputs: typbase://
 * links are left for the host's anchor router, external links confirm first,
 * anything else maps back into the compiled document and moves the cursor.
 * Alt-click edits the link instead of following it.
 */
export function attachFrameInteractions(
  container: HTMLElement,
  view: EditorView,
  frame: SvgRangedFrame,
  fileId: FileId,
  typstState: TypstState,
): void {
  const handle = (event: MouseEvent) => {
    event.preventDefault();

    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;

    if (anchor && !event.altKey) {
      if (event.type !== "click") return;

      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("typbase://")) return;

      if (window.confirm(`Open external link?\n\n${href}\n\nIt opens in a new tab.`)) {
        window.open(href, "_blank", "noopener,noreferrer");
      }

      return;
    }

    const { top, left } = container.getBoundingClientRect();

    // App pt == screen px, so the click lands in document points as is.
    const x = event.clientX - left;
    const y = event.clientY - top + frame.render.yOffset;

    const jump = typstState.jumpPaged(fileId, x, y);
    const position = jump ? jump.position : frame.range.end;

    view.focus();
    view.dispatch({ selection: { anchor: position } });
  };

  container.addEventListener("click", handle);
  container.addEventListener("mousedown", handle);
}

/**
 * True when the selection does not touch `start..end`, so the frame can render
 * as a widget instead of showing source. Shared by the inline WYSIWYG pass and
 * the notebook markup cells.
 */
export function frameIsInactive(
  view: EditorView,
  state: EditorState,
  start: number,
  end: number,
): boolean {
  return (
    !view.hasFocus ||
    state.selection.ranges.every(
      (range) =>
        (range.from < start || range.from > end) &&
        (range.to < start || range.to > end) &&
        (start < range.from || start > range.to) &&
        (end < range.from || end > range.to),
    )
  );
}

/**
 * Line decorations that stand in for a frame while the cursor is inside it:
 * the source stays visible with the frame's height reserved, so the pane does
 * not jump between render and source. Matches the inline WYSIWYG behavior.
 *
 * `lineHeights` carries measured source heights from the remeasure pass; when
 * it is absent the view still reports the widget's height for those lines.
 */
export function frameActiveDecorations(
  view: EditorView,
  state: EditorState,
  frame: SvgRangedFrame,
  lineHeights?: Map<number, number>,
): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  let lineHeight = 0;

  const { number: startLine } = state.doc.lineAt(frame.range.start);
  const { number: endLine } = state.doc.lineAt(frame.range.end);

  for (let currentLine = startLine; currentLine <= endLine; currentLine++) {
    const line = state.doc.line(currentLine);
    let style = "";
    if (currentLine == startLine)
      style += "border-top-left-radius:0.25rem;border-top-right-radius:0.25rem;";
    if (currentLine == endLine)
      style += `border-bottom-left-radius:0.25rem;border-bottom-right-radius:0.25rem;min-height:${Math.max(0, frame.render.height - lineHeight)}px`;
    else lineHeight += lineHeights?.get(line.from) ?? view.lineBlockAt(line.from).height;

    decorations.push(
      Decoration.line({
        class: "cm-activeLine",
        attributes: { style },
      }).range(line.from),
    );
  }

  return decorations;
}

export class TypstWidget extends WidgetType {
  private container: HTMLElement;
  private readonly size: { width: number; height: number };

  public constructor(
    private readonly view: EditorView,
    private readonly frame: SvgRangedFrame,
    private readonly locked: boolean,
    private readonly fileId: FileId,
    private readonly typstState: TypstState,
  ) {
    super();

    this.size = frameSize(frame);

    const cached = containerCache.get(frame.render.hash);

    // The content hash does not include pane width; a reused container may
    // hold a frame laid out for a wider pane. Refresh its markup when the
    // geometry differs, so resizing the editor reflows the inline preview.
    if (cached?.isConnected) {
      this.container = cached;
      syncFrameContainer(cached, frame);
    } else {
      const container = document.createElement("div");

      container.dataset.hash = frame.render.hash.toString();
      container.classList.add("typst-render");
      if (!locked) attachFrameInteractions(container, view, frame, fileId, typstState);

      containerCache.set(frame.render.hash, container);
      this.container = container;
      syncFrameContainer(container, frame);
    }
  }

  public override eq(other: TypstWidget) {
    return (
      other.frame.render.hash === this.frame.render.hash &&
      other.size.width === this.size.width &&
      other.size.height === this.size.height
    );
  }

  public toDOM() {
    return this.container;
  }

  public override get estimatedHeight() {
    return this.frame.render.height;
  }
}
