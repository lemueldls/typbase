import type { EditorState } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { FileId, SvgRangedFrame, TypstDiagnostic, TypstState } from "@typbase/wasm";

import { setDiagnostics } from "@codemirror/lint";
import { type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { LRUCache } from "lru-cache";

import type { TextRef, TypstRequestHandler } from "./types";

import { rememberDiagnostics, toLintDiagnostics } from "./diagnostics";

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
function frameSize(frame: SvgRangedFrame): { width: number; height: number } {
  const match = frame.render.svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);

  return {
    width: match ? Number(match[1]) : frame.render.width,
    height: match ? Number(match[2]) : frame.render.height,
  };
}

class TypstWidget extends WidgetType {
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
      this.syncRenderInfo(cached);
    } else {
      const container = document.createElement("div");

      container.dataset.hash = frame.render.hash.toString();
      container.classList.add("typst-render");

      if (!locked) {
        container.addEventListener("click", this.handleMouseEvent.bind(this));
        container.addEventListener("mousedown", this.handleMouseEvent.bind(this));
      }

      containerCache.set(frame.render.hash, container);
      this.container = container;
      this.syncRenderInfo(container);
    }
  }

  private syncRenderInfo(container: HTMLElement) {
    const widthKey = Math.round(this.size.width).toString();

    if (container.dataset.renderWidth !== widthKey) {
      container.dataset.renderWidth = widthKey;
      // Pin the SVG to the compiled frame size (via CSS variables). The
      // container keeps max-width: 100% so it never exceeds the line — an
      // explicit container width would make CodeMirror's flex layout grow
      // the content width forever (resize -> wider widget -> wider content).
      // The pinned SVG overflows the clamped container while the pane is
      // narrower than the compiled width; the scroller clips it, so the
      // render stays its size instead of scaling with the pane.
      container.style.setProperty("--render-w", this.size.width + "px");
      container.style.setProperty("--render-h", this.size.height + "px");
      container.style.height = this.size.height + "px";
      container.setHTMLUnsafe(this.frame.render.svg);
    }
  }

  private handleMouseEvent(event: MouseEvent) {
    event.preventDefault();

    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (anchor) {
      if (event.type !== "click") return;

      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("typbase://")) return;

      if (window.confirm(`Open external link?\n\n${href}\n\nIt opens in a new tab.`)) {
        window.open(href, "_blank", "noopener,noreferrer");
      }

      return;
    }

    const { clientX, clientY } = event;
    this.handleJump(clientX, clientY);
  }

  private handleJump(clientX: number, clientY: number) {
    const { typstState, frame, view } = this;
    const { top, left } = this.container.getBoundingClientRect();

    // App pt == screen px, so the click lands in document points as is.
    const x = clientX - left;
    const y = clientY - top + frame.render.yOffset;

    const jump = typstState.jumpPaged(this.fileId, x, y);
    const position = jump ? jump.position : frame.range.end;

    view.focus();
    view.dispatch({ selection: { anchor: position } });
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

export const compileCache = new LRUCache<
  string,
  { frames: SvgRangedFrame[]; tooltips: SvgRangedFrame[] }
>({ max: 8 });

const updateFlagStore = new Set<string>();

/**
 * Dispatch this to recompile even when the document did not change. Used when
 * app data changed (fonts installed, workspace data, query results).
 */
export const typstRecompileEffect = StateEffect.define({});

/** Compile cache keys include the wasm revision so new fonts re-render. */
function compileCacheKey(
  path: string,
  typstState: TypstState,
  revision?: () => string | number | undefined,
): string {
  return `${path}:${typstState.revision()}:${revision?.() ?? ""}`;
}

const SCROLLBAR_ALLOWANCE = 12;

function editorRenderWidth(scrollDOM: HTMLElement, contentDOM: HTMLElement): number {
  const pane = scrollDOM.getBoundingClientRect();
  const gutters = scrollDOM.querySelector<HTMLElement>(".cm-gutters");
  const style = getComputedStyle(contentDOM);

  return Math.max(
    0,
    pane.width -
      (gutters?.getBoundingClientRect().width ?? 0) -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) -
      SCROLLBAR_ALLOWANCE,
  );
}

export const tooltipsStateEffect = StateEffect.define<SvgRangedFrame[]>();

export const tooltipsStateField = StateField.define<SvgRangedFrame[]>({
  create() {
    return [];
  },
  update(frames, transaction) {
    const effect = transaction.effects.find((e) => e.is(tooltipsStateEffect));

    return effect ? effect.value : frames;
  },
});

interface DecorateArgs {
  fileId: FileId;
  spaceId: string;
  path: string;
  prelude: string;
  locked: boolean;
  update: ViewUpdate;
  updateInWidget: boolean;
  widthChanged: boolean;
  forced: boolean;
  typstState: TypstState;
  revision?: () => string | number | undefined;
  onRequests?: TypstRequestHandler;
  onPanic?: (fileId: FileId) => void;
}

function decorate({
  fileId,
  spaceId,
  path,
  prelude,
  locked,
  update,
  updateInWidget: _updateInWidget,
  widthChanged,
  forced,
  typstState,
  revision,
  onRequests,
  onPanic,
}: DecorateArgs) {
  const text = update.state.doc.toString();
  const isFlaggedForUpdate = updateFlagStore.has(path);
  const cacheKey = compileCacheKey(path, typstState, revision);

  let frames: SvgRangedFrame[];
  let tooltips: SvgRangedFrame[];

  if (forced || update.docChanged || widthChanged || !compileCache.has(cacheKey)) {
    if (isFlaggedForUpdate) updateFlagStore.delete(path);
    else updateFlagStore.add(path);

    let compileResult: ReturnType<TypstState["compilePaged"]>;
    try {
      compileResult = typstState.compilePaged(fileId, text, prelude);
    } catch (error) {
      // A wasm panic aborts the instance: the host recreates it and remounts
      // the editor through onPanic. Until then, render nothing rather than
      // letting the trap break CodeMirror's update loop.
      console.error("[typst] compile panicked:", error);
      onPanic?.(fileId);
      return { decorations: Decoration.none, tooltips: [] };
    }
    dispatchDiagnostics(compileResult.diagnostics, update.state, update.view);
    rememberDiagnostics(path, text, compileResult.diagnostics);

    if (compileResult.requests.length > 0 && onRequests) {
      void Promise.resolve(onRequests(compileResult.requests, spaceId)).then((wasUpdated) => {
        if (wasUpdated) {
          const doc = update.view.state.doc.toString();
          update.view.dispatch({
            changes: { from: 0, to: doc.length, insert: doc },
            // The cached result was compiled before the request was resolved;
            // force a recompile instead of trusting it.
            effects: typstRecompileEffect.of(null),
          });
        }
      });
    }

    ({ frames, tooltips } = compileResult);
    compileCache.set(cacheKey, { frames, tooltips });
  } else ({ frames, tooltips } = compileCache.get(cacheKey)!);

  const { view, state } = update;

  const decorations: Range<Decoration>[] = [];

  for (const frame of frames) {
    const { start, end } = frame.range;

    if (frame.render) {
      const inactive =
        !view.hasFocus ||
        state.selection.ranges.every(
          (range) =>
            (range.from < start || range.from > end) &&
            (range.to < start || range.to > end) &&
            (start < range.from || start > range.to) &&
            (end < range.from || end > range.to),
        );

      if (inactive) {
        const widget = new TypstWidget(view, frame, locked, fileId, typstState);

        decorations.push(Decoration.replace({ widget }).range(start, end));
      } else {
        let lineHeight = 0;

        const { number: startLine } = state.doc.lineAt(start);
        const { number: endLine } = state.doc.lineAt(end);

        for (let currentLine = startLine; currentLine <= endLine; currentLine++) {
          const line = state.doc.line(currentLine);
          let style = "";
          if (currentLine == startLine)
            style += "border-top-left-radius:0.25rem;border-top-right-radius:0.25rem;";
          if (currentLine == endLine)
            style += `border-bottom-left-radius:0.25rem;border-bottom-right-radius:0.25rem;min-height:${frame.render.height - lineHeight}px`;
          else lineHeight += view.lineBlockAt(line.from).height;

          decorations.push(
            Decoration.line({
              class: "cm-activeLine",
              attributes: { style },
            }).range(line.from),
          );
        }
      }
    }
  }

  return {
    decorations: Decoration.set(decorations, true),
    tooltips,
  };
}

const typstStateEffect = StateEffect.define<{ decorations: DecorationSet }>({});

export const typstStateField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    const effect = transaction.effects.find((e) => e.is(typstStateEffect));

    if (effect) return effect.value.decorations;

    return decorations.map(transaction.changes);
  },
  provide: (field) => [EditorView.decorations.from(field)],
});

export interface TypstViewPluginOptions {
  onRequests?: TypstRequestHandler;
  /** Extra component of the compile cache key: app data revisions. */
  revision?: () => string | number | undefined;
  /** See TypstPluginOptions#onPanic. */
  onPanic?: (fileId: FileId) => void;
}

export const typstViewPlugin = (
  fileId: FileId,
  spaceId: string,
  path: string,
  text: TextRef,
  prelude: TextRef,
  locked: boolean,
  typstState: TypstState,
  options: TypstViewPluginOptions = {},
) =>
  ViewPlugin.define((_view) => {
    // A freshly created view's first update never carries doc/selection/focus
    // changes, and resize() reports false when the pane width already matches
    // the stored one. That happens whenever the view is rebuilt for a mode
    // switch (write -> source -> write): without this flag the render never
    // runs until the user clicks or types.
    let firstUpdate = true;
    let resizeTimer: number | undefined;

    return {
      update(update: ViewUpdate) {
        let widthChanged = false;
        const forced =
          firstUpdate ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(typstRecompileEffect)),
          );
        firstUpdate = false;

        if (update.geometryChanged) {
          const { scrollDOM, contentDOM } = update.view;

          widthChanged = typstState.resize(
            fileId,
            editorRenderWidth(scrollDOM, contentDOM),
            locked ? scrollDOM.clientHeight : undefined,
          );
        }

        if (widthChanged) {
          // Reflow once the pane width settles instead of on every resize
          // tick: recompiling per pointermove swaps the widget size mid-drag
          // and blocks the main thread. Until the recompile lands, widgets
          // keep their compiled size (see TypstWidget), so the render stays
          // consistent while the pane moves.
          clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            update.view.dispatch({ effects: typstRecompileEffect.of(null) });
          }, 150);
        }

        if (update.docChanged || update.selectionSet || update.focusChanged || forced) {
          const { state } = update;
          const currentDecorations = state.field(typstStateField);

          let updateInWidget = false;

          // Stop at the first frame that intersects the selection; the widget
          // update path wants to know whether any active frame exists.
          const cursor = currentDecorations.iter();
          while (cursor.value) {
            const from = cursor.from;
            const to = cursor.to;

            if (to > state.doc.length) break;

            const { from: start } = state.doc.lineAt(from);
            const { to: end } = state.doc.lineAt(to);

            const active = state.selection.ranges.some(
              (range) =>
                (range.from >= start && range.from <= end) ||
                (range.to >= start && range.to <= end) ||
                (start >= range.from && start <= range.to) ||
                (end >= range.from && end <= range.to),
            );

            if (active) {
              updateInWidget = true;
              break;
            }

            cursor.next();
          }

          queueMicrotask(() => {
            const result = decorate({
              fileId,
              spaceId,
              path,
              prelude: prelude.value,
              locked,
              update,
              updateInWidget,
              widthChanged,
              forced,
              typstState,
              revision: options.revision,
              onRequests: options.onRequests,
              onPanic: options.onPanic,
            });

            if (result) {
              const effects = [
                typstStateEffect.of({ decorations: result.decorations }),
                tooltipsStateEffect.of(result.tooltips),
              ];
              update.view.dispatch({ effects });
            }
          });

          if (update.docChanged) text.value = update.state.doc.toString();
        }
      },
      destroy() {
        clearTimeout(resizeTimer);
      },
    };
  });

function dispatchDiagnostics(
  typstDiagnostics: TypstDiagnostic[],
  state: EditorState,
  view: EditorView,
) {
  view.dispatch(setDiagnostics(state, toLintDiagnostics(typstDiagnostics)));
}
