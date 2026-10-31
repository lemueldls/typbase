import type { Tooltip } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

import { StateEffect, StateField } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { showTooltip } from "@codemirror/view";

import {
  replacedFrameAt,
  tooltipsStateEffect,
  tooltipsStateField,
  typstRecompileEffect,
} from "./widgets";

const tooltipStateEffect = StateEffect.define<Tooltip | null>();

export const tooltipStateField = StateField.define<Tooltip | null>({
  create() {
    return null;
  },
  update(tooltip, transaction) {
    const effect = transaction.effects.find((e) => e.is(tooltipStateEffect));
    if (effect) return effect.value;

    return tooltip;
  },
  provide: (field) => showTooltip.from(field),
});

export const tooltipViewPlugin = () =>
  ViewPlugin.define((view) => ({
    update(update: ViewUpdate) {
      const tooltipsChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(tooltipsStateEffect)),
      );
      if (!update.selectionSet && !update.docChanged && !update.focusChanged && !tooltipsChanged) {
        return;
      }

      if (!view.hasFocus) {
        if (view.state.field(tooltipStateField)) {
          view.dispatch({ effects: tooltipStateEffect.of(null) });
        }

        return;
      }

      queueMicrotask(() => {
        if (!view.hasFocus) {
          if (view.state.field(tooltipStateField)) {
            view.dispatch({ effects: tooltipStateEffect.of(null) });
          }

          return;
        }

        const state = view.state;
        const pos = state.selection.main.from;

        // A replaced frame has no source text to anchor to. The equation is
        // not visible, so a popup would only land at the frame's right edge.
        if (replacedFrameAt(state, pos)) {
          if (state.field(tooltipStateField)) {
            view.dispatch({ effects: tooltipStateEffect.of(null) });
          }

          return;
        }

        const { tooltips, ranges } = state.field(tooltipsStateField);

        if (!tooltips.some(({ range }) => pos >= range.start && pos <= range.end)) {
          const inMath = ranges.some(([start, end]) => pos >= start && pos <= end);

          if (inMath && !tooltipsChanged) {
            view.dispatch({ effects: typstRecompileEffect.of(null) });

            return;
          }
        }

        let tooltip: Tooltip | null = null;

        // Find which frame contains the cursor
        for (const { render, range } of tooltips) {
          const { start, end } = range;

          if (pos >= start && pos <= end && render) {
            const container = document.createElement("div");
            container.classList.add("typst-popup-render");

            const svg = document.createElement("div");
            svg.style.width = render.width + "px";
            svg.style.height = render.height + "px";
            svg.style.transform = `translateX(-${render.xOffset}px)`;
            svg.setHTMLUnsafe(render.svg);

            container.append(svg);

            tooltip = {
              pos: start,
              end,
              create(tooltipView) {
                return {
                  dom: container,
                  getCoords(_pos) {
                    const content = tooltipView.contentDOM.getBoundingClientRect();
                    const startCoords = tooltipView.coordsAtPos(start);
                    const endCoords = tooltipView.coordsAtPos(end);
                    const top = Math.max(
                      content.top,
                      Math.min(content.bottom, startCoords?.top ?? content.top),
                    );
                    const bottom = Math.max(
                      top,
                      Math.min(content.bottom, startCoords?.bottom ?? top),
                    );
                    const left = Math.max(
                      content.left,
                      Math.min(content.right, startCoords?.left ?? content.left),
                    );
                    const right = Math.max(left, Math.min(content.right, endCoords?.right ?? left));

                    return { left, right, top, bottom };
                  },
                };
              },
            };

            break;
          }
        }

        view.dispatch({ effects: tooltipStateEffect.of(tooltip) });
      });
    },
  }));
