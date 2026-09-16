import type { WorkspaceSettings } from "@typbase/typing";

import { typstThemeDict } from "~/lib/palette";
import { resolveTheme } from "~/lib/themes";

export function publishPrelude(settings: WorkspaceSettings): string {
  // The same registry as the app chrome: named themes, custom overrides,
  // renderer colors derived from the token map. Build the Typst dictionary
  // from the tokens directly: a wasm ThemeColors has no enumerable fields, so
  // JSON.stringify of it produced "{}" and the published page lost its theme.
  const theme = typstThemeDict(resolveTheme(settings).palette);
  const font = settings.font;
  const mathFont = settings.mathFont ?? font;
  const codeFont = settings.codeFont ?? font;

  return [
    `#let theme = ${theme}`,
    `#set text(fill: theme.text, size: 12pt, font: "${font}")`,
    "",
    "#show heading.where(level:1): set text(fill: theme.accent, size: 32pt, weight: 400)",
    "#show heading.where(level:2): set text(fill: theme.text, size: 28pt, weight: 400)",
    "#show heading.where(level:3): set text(fill: theme.text-secondary, size: 24pt, weight: 400)",
    "#show heading.where(level:4): set text(fill: theme.accent, size: 22pt, weight: 400)",
    "#show heading.where(level:5): set text(fill: theme.text, size: 16pt, weight: 500)",
    "#show heading.where(level:6): set text(fill: theme.text-secondary, size: 14pt, weight: 500)",
    "",
    "#show link:set text(fill: theme.accent)",
    "#show link:underline",
    "",
    "#set line(stroke: theme.border)",
    "#set table(stroke: theme.border)",
    "#set rect(stroke: theme.border)",
    "#set circle(stroke: theme.border)",
    "#set ellipse(stroke: theme.border)",
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
