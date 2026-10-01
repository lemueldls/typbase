import type { Tooltip } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

import { StateEffect, StateField } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { showTooltip } from "@codemirror/view";

import { tooltipsStateField, typstRecompileEffect } from "./widgets";

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
      if (!update.selectionSet && !update.docChanged && !update.focusChanged) return;

      queueMicrotask(() => {
        if (!view.hasFocus) {
          view.dispatch({ effects: tooltipStateEffect.of(null) });

          return;
        }

        const state = view.state;
        const pos = state.selection.main.from;
        const { tooltips, ranges } = state.field(tooltipsStateField);

        // The render only builds the overlay for the equation the cursor was in
        // when it ran, so moving the cursor into another equation finds no
        // overlay. Ask for a render before showing nothing. The equation ranges
        // come back with every render, so this does not need its own scan.
        if (!tooltips.some(({ range }) => pos >= range.start && pos <= range.end)) {
          const inMath = ranges.some(([start, end]) => pos >= start && pos <= end);

          if (inMath) {
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
                    const startCoords = tooltipView.coordsAtPos(start)!;
                    const endCoords = tooltipView.coordsAtPos(end)!;

                    return {
                      left: startCoords.left,
                      right: endCoords.right,
                      top: startCoords.top,
                      bottom: endCoords.bottom,
                    };
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
