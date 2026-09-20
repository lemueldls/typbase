import type { EditorState, Range } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { FileId, SvgRangedFrame, TypstDiagnostic, TypstState } from "@typbase/wasm";

import { setDiagnostics } from "@codemirror/lint";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { LRUCache } from "lru-cache";

import type { NotebookOptions } from "./notebook";
import type { NotebookFrameStore } from "./notebook-widgets";
import type { TextRef, TypstRequestHandler } from "./types";

import { rememberDiagnostics, toLintDiagnostics } from "./diagnostics";
import { frameActiveDecorations, frameIsInactive, TypstWidget } from "./frames";
import { cellIndexAt, notebookRunEffect, notebookRefreshEffect } from "./notebook";
import { createNotebookFrameStore, decorateNotebook } from "./notebook-widgets";

export const compileCache = new LRUCache<
  string,
  {
    frames: SvgRangedFrame[];
    tooltips: SvgRangedFrame[];
    diagnostics: TypstDiagnostic[];
  }
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

interface BuildDecorationsArgs {
  state: EditorState;
  view: EditorView;
  frames: SvgRangedFrame[];
  locked: boolean;
  fileId: FileId;
  typstState: TypstState;
  /**
   * Measured source heights for the active blocks, keyed by line start. The
   * first pass runs while the blocks' widgets are still mounted, so the view
   * reports the render height for those lines; the remeasure pass fills this
   * from the source lines once they exist.
   */
  lineHeights?: Map<number, number>;
}

/**
 * Builds the decoration set for a compile result: rendered blocks become
 * replace widgets, the block the cursor is in shows its source and stretches
 * its last line to the render's height. Returns the frames that show source,
 * for the remeasure pass.
 */
function buildDecorations({
  state,
  view,
  frames,
  locked,
  fileId,
  typstState,
  lineHeights,
}: BuildDecorationsArgs): { decorations: DecorationSet; active: SvgRangedFrame[] } {
  const decorations: Range<Decoration>[] = [];
  const active: SvgRangedFrame[] = [];

  for (const frame of frames) {
    const { start, end } = frame.range;

    if (!frame.render) continue;

    if (frameIsInactive(view, state, start, end)) {
      const widget = new TypstWidget(view, frame, locked, fileId, typstState);
      decorations.push(Decoration.replace({ widget }).range(start, end));

      continue;
    }

    active.push(frame);
    decorations.push(...frameActiveDecorations(view, state, frame, lineHeights));
  }

  return { decorations: Decoration.set(decorations, true), active };
}

/**
 * Source line heights for the blocks whose widgets were just removed. Runs
 * inside the view's measure pass, after the source lines are in the DOM, so
 * the heights are the text's and not the widget's.
 */
function measureLineHeights(view: EditorView, frames: SvgRangedFrame[]): Map<number, number> {
  const heights = new Map<number, number>();
  const { state } = view;

  for (const frame of frames) {
    const { number: startLine } = state.doc.lineAt(frame.range.start);
    const { number: endLine } = state.doc.lineAt(frame.range.end);

    for (let currentLine = startLine; currentLine <= endLine; currentLine++) {
      const line = state.doc.line(currentLine);

      if (!heights.has(line.from)) {
        heights.set(line.from, view.lineBlockAt(line.from).height);
      }
    }
  }

  return heights;
}

interface DecorateResult {
  decorations: DecorationSet;
  tooltips: SvgRangedFrame[];
  frames: SvgRangedFrame[];
  active: SvgRangedFrame[];
}

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
  notebook?: NotebookOptions;
  /** See NotebookDecorateArgs#runIndex. */
  runIndex?: number | "all";
  frameStore: NotebookFrameStore;
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
  notebook,
  runIndex,
  frameStore,
}: DecorateArgs): DecorateResult {
  const text = update.state.doc.toString();
  const isFlaggedForUpdate = updateFlagStore.has(path);
  const cacheKey = compileCacheKey(path, typstState, revision);

  let frames: SvgRangedFrame[];
  let tooltips: SvgRangedFrame[];
  let diagnostics: TypstDiagnostic[];

  // Manual-run notebooks only compile when a run (or a settings change) asks
  // for it; everything else reuses the last compile so outputs stay put while
  // the source changes under them.
  const live = notebook?.live?.() ?? true;
  const mustCompile =
    forced ||
    ((!notebook || live) && (update.docChanged || widthChanged)) ||
    !compileCache.has(cacheKey);

  if (mustCompile) {
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

      return { decorations: Decoration.none, tooltips: [], frames: [], active: [] };
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
    diagnostics = compileResult.diagnostics;
    compileCache.set(cacheKey, { frames, tooltips, diagnostics });

    notebook?.onCompile?.({ text, frames, diagnostics });
  } else {
    const cached = compileCache.get(cacheKey)!;
    ({ frames, tooltips, diagnostics } = cached);
  }

  const { view, state } = update;

  if (notebook) {
    const cells = notebook.cells(text);
    notebook.onCells?.(cells);
    notebook.onActiveCell?.(cells.length ? cellIndexAt(cells, state.selection.main.head) : null);

    return {
      decorations: Decoration.set(
        decorateNotebook({
          view,
          state,
          cells,
          frames,
          diagnostics,
          fileId,
          typstState,
          locked,
          options: notebook,
          runIndex,
          frameStore,
        }),
        true,
      ),
      tooltips,
      frames,
      // Notebook cells do their own source-height handling; there is no
      // around-the-widget remeasure to schedule.
      active: [],
    };
  }

  const built = buildDecorations({ state, view, frames, locked, fileId, typstState });

  return { decorations: built.decorations, tooltips, frames, active: built.active };
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
  /** Cell rendering, run effects, and cell commands for notebook mode. */
  notebook?: NotebookOptions;
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
    const frameStore = createNotebookFrameStore();

    // Dedupes remeasure requests for this view; the latest one wins.
    const remeasureKey = {};

    /**
     * A pass that shows a block's source runs while the block's widget is still
     * mounted, so the view reports the widget's height for those lines and the
     * min-height that should keep the render's height comes out as zero. Once
     * the source lines are in the DOM and measured, rebuild the active
     * decorations with the real text heights. The measure pass runs before
     * paint, so the rebuild is not visible.
     */
    const remeasureActive = (update: ViewUpdate, result: DecorateResult) => {
      if (result.active.length === 0) return;

      const { view, state } = update;
      const focused = view.hasFocus;
      const stale = () =>
        view.state.doc !== state.doc ||
        !view.state.selection.eq(state.selection) ||
        view.hasFocus !== focused;

      view.requestMeasure({
        key: remeasureKey,
        read: (readView) => (stale() ? null : measureLineHeights(readView, result.active)),
        write: (heights) => {
          if (!heights) return;

          queueMicrotask(() => {
            // Another update changed the inputs; that pass schedules its own
            // remeasure.
            if (stale()) return;

            const rebuilt = buildDecorations({
              state: view.state,
              view,
              frames: result.frames,
              locked,
              fileId,
              typstState,
              lineHeights: heights,
            });

            view.dispatch({
              effects: typstStateEffect.of({ decorations: rebuilt.decorations }),
            });
          });
        },
      });
    };

    return {
      update(update: ViewUpdate) {
        let widthChanged = false;
        const effects = update.transactions.flatMap((transaction) => transaction.effects);
        const run = effects.find((effect) => effect.is(notebookRunEffect));
        const refresh = effects.some((effect) => effect.is(notebookRefreshEffect));
        const forced =
          firstUpdate ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(typstRecompileEffect)),
          );
        firstUpdate = false;

        if (run) options.notebook?.onRun?.(run.value.index);
        if (update.docChanged && options.notebook?.onChange) {
          let first = Number.POSITIVE_INFINITY;
          update.changes.iterChangedRanges((fromA) => {
            if (fromA < first) first = fromA;
          });
          if (Number.isFinite(first)) options.notebook.onChange(first);
        }

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

        if (
          update.docChanged ||
          update.selectionSet ||
          update.focusChanged ||
          forced ||
          run ||
          refresh
        ) {
          queueMicrotask(() => {
            const result = decorate({
              fileId,
              spaceId,
              path,
              prelude: prelude.value,
              locked,
              update,
              updateInWidget: false,
              widthChanged,
              forced: forced || Boolean(run),
              typstState,
              revision: options.revision,
              onRequests: options.onRequests,
              onPanic: options.onPanic,
              notebook: options.notebook,
              runIndex: run?.value.index,
              frameStore,
            });

            if (result) {
              const stateEffects = [
                typstStateEffect.of({ decorations: result.decorations }),
                tooltipsStateEffect.of(result.tooltips),
              ];
              update.view.dispatch({ effects: stateEffects });

              remeasureActive(update, result);
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
