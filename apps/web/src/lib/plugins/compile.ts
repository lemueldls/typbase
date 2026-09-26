import type { TypstState } from "@typbase/engine";

import { specString } from "~/lib/packages";
import { themeColorsFromPalette } from "~/lib/rendererPalette";

import type { PluginSurfaceInput, PluginSurfaceResult } from "./protocol";

const PLUGIN_SPACE = "plugin-host";
const CTX_PATH = "/typbase/plugin/ctx.json";
const WRAPPER_PATH = "/typbase/surface";

const styleKeys = new WeakMap<TypstState, string>();

function applyStyle(typstState: TypstState, input: PluginSurfaceInput): void {
  const key = JSON.stringify(input.style);
  if (styleKeys.get(typstState) === key) return;
  styleKeys.set(typstState, key);

  const configId = typstState.createSourceId("typbase/config", PLUGIN_SPACE);
  typstState.setFont(configId, input.style.font);
  typstState.setMathFont(configId, input.style.mathFont);
  typstState.setCodeFont(configId, input.style.codeFont);
  typstState.setTextSize(configId, input.style.textSize);
  typstState.setTheme(configId, themeColorsFromPalette(input.style.palette));
}

function wrapperSource(input: PluginSurfaceInput): string {
  // Surfaces return `(ui, state, view)`. The wrapper emits the patch holder as
  // a sibling of the UI and wraps the UI in a classed container: the HTML
  // renderer already wraps frames in an unnamed div, and `tb-surface` is what
  // the host stylesheet targets for spacing between top-level blocks.
  return [
    `#import "/typbase/plugin/${input.slug}/${input.entry}": ${input.fn}`,
    `#let ctx = json("${CTX_PATH}")`,
    `#let page = ${input.fn}(ctx)`,
    `#let ui = page.at("ui")`,
    `#let patch = (state: page.at("state", default: ()), view: page.at("view", default: ()))`,
    `#html.elem("div", attrs: ("hidden": "hidden", "data-tb-patch": json.encode(patch)))`,
    `#html.elem("div", attrs: (class: "tb-surface"), ui)`,
    "",
  ].join("\n");
}

export function compileSurface(
  typstState: TypstState,
  input: PluginSurfaceInput,
): PluginSurfaceResult {
  applyStyle(typstState, input);

  for (const source of input.sources) {
    typstState.insertSource(typstState.createFileId(source.path), source.text);
  }
  for (const file of input.files ?? []) {
    typstState.insertFile(typstState.createFileId(file.path), file.bytes);
  }
  for (const pkg of input.packages ?? []) {
    typstState.installPackage(specString(pkg.spec), pkg.bytes);
  }
  typstState.insertFile(
    typstState.createFileId(CTX_PATH),
    new TextEncoder().encode(JSON.stringify(input.ctx)),
  );

  const wrapper = wrapperSource(input);
  const file = typstState.createSourceId(WRAPPER_PATH, PLUGIN_SPACE);
  // The synth source must exist before the compile: sync replaces it in place
  // (same pattern as PageView and the publish worker).
  typstState.insertSource(file, wrapper);
  const result = typstState.compileHTML(file, wrapper, "");

  return {
    html: result.frames[0]?.render.html ?? "",
    diagnostics: result.diagnostics,
    requests: result.requests,
  };
}
