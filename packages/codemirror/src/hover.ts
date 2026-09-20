import type { FileId, TypstState } from "@typbase/wasm";

import { hoverTooltip } from "@codemirror/view";

import { parseBackticks } from "./highlight";

export const typstHoverTooltip = (fileId: FileId, typstState: TypstState) =>
  hoverTooltip((_, pos, side) => {
    let tooltip: ReturnType<TypstState["hover"]>;
    try {
      tooltip = typstState.hover(fileId, pos, side);
    } catch (error) {
      console.error("[typst] hover panicked:", error);

      return null;
    }

    if (tooltip) {
      return {
        pos,
        create() {
          const div = document.createElement("div");

          if (tooltip.startsWith("<code>")) {
            div.innerHTML =
              "<pre>" +
              tooltip.replace(
                /span data-tag=(\w+)/g,
                (_match, tag) => `span class="${"typ-" + tag}"`,
              ) +
              "</pre>";
          } else parseBackticks(tooltip, div);

          return { dom: div };
        },
      };
    }

    return null;
  });
