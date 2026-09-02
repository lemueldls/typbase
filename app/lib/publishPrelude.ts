import type { WorkspaceSettings } from "@typbase/typing";

import { rendererPaletteFor, resolveTheme } from "~/lib/themes";

/**
 * The prelude for published pages. It mirrors the editor prelude the wasm
 * crate generates (fonts, heading styles, link styles) but without page
 * geometry: the HTML render target has no fixed page box. The worker's
 * TypstState has no context for this page, so the prelude comes from JS.
 */
export function publishPrelude(settings: WorkspaceSettings): string {
  // The same registry as the app chrome: named themes, custom overrides,
  // renderer colors derived from the token map.
  const theme = rendererPaletteFor(resolveTheme(settings));
  const font = settings.font;
  const mathFont = settings.mathFont ?? font;
  const codeFont = settings.codeFont ?? font;

  return [
    `#let theme = ${JSON.stringify(theme)}`,
    `#set text(fill: theme.on-background, size: 12pt, font: "${font}")`,
    "",
    "#show heading.where(level:1): set text(fill: theme.primary, size: 32pt, weight: 400)",
    "#show heading.where(level:2): set text(fill: theme.secondary, size: 28pt, weight: 400)",
    "#show heading.where(level:3): set text(fill: theme.tertiary, size: 24pt, weight: 400)",
    "#show heading.where(level:4): set text(fill: theme.primary, size: 22pt, weight: 400)",
    "#show heading.where(level:5): set text(fill: theme.secondary, size: 16pt, weight: 500)",
    "#show heading.where(level:6): set text(fill: theme.tertiary, size: 14pt, weight: 500)",
    "",
    "#show link:set text(fill: theme.primary)",
    "#show link:underline",
    "",
    "#set line(stroke: theme.outline)",
    "#set table(stroke: theme.outline)",
    "#set rect(stroke: theme.outline)",
    "#set circle(stroke: theme.outline)",
    "#set ellipse(stroke: theme.outline)",
    "",
    `#show math.equation:set text(font: "${mathFont}")`,
    `#show raw:set text(font: "${codeFont}")`,
    "",
    '#import "/typbase.typ" as typbase',
    "",
    // The user's workspace prelude, same text the editor appends.
    settings.pagePrelude ?? "",
    "",
  ].join("\n");
}
