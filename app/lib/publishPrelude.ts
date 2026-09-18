import type { ThemePaletteTokens, WorkspaceSettings } from "@typbase/typing";

import { typstThemeDict } from "~/lib/palette";
import { resolveLightTheme, resolveTheme } from "~/lib/themes";

export interface PublishPreludeOptions {
  /**
   * "light" (the default) normalizes to a light palette so documents stay
   * readable on white and print well; "workspace" keeps the active palette and
   * fills pages with its surface, so a dark theme exports as a dark document.
   */
  theme?: "light" | "workspace";
  /** Page size for paged output. A4 unless set. */
  pageSize?: "a4" | "letter";
  /**
   * Emit `#set page(...)`. Paged targets (PDF, SVG, the project `.typ`) need
   * it; HTML export has no pages.
   */
  paged?: boolean;
}

const PAGE_WIDTHS = { a4: 595.28, letter: 612 } as const;

/** The palette an export will use, for styling the HTML artifact to match. */
export function publishThemePalette(
  settings: WorkspaceSettings,
  options: Pick<PublishPreludeOptions, "theme"> = {},
): ThemePaletteTokens {
  return (options.theme === "workspace" ? resolveTheme(settings) : resolveLightTheme(settings))
    .palette;
}

export function publishPrelude(
  settings: WorkspaceSettings,
  options: PublishPreludeOptions = {},
): string {
  // The same registry as the app chrome: named themes, custom overrides,
  // renderer colors derived from the token map. Build the Typst dictionary
  // from the tokens directly: a wasm ThemeColors has no enumerable fields, so
  // JSON.stringify of it produced "{}" and the published page lost its theme.
  const theme = typstThemeDict(publishThemePalette(settings, options));
  const font = settings.font;
  const mathFont = settings.mathFont ?? font;
  const codeFont = settings.codeFont ?? font;

  const page = options.paged
    ? [
        // Page geometry lives here rather than in the wasm prelude so the
        // exported `.typ` compiles to the same document outside the app.
        `#set page(width: ${PAGE_WIDTHS[options.pageSize ?? "a4"]}pt, height: auto, margin: 16pt, fill: theme.surface)`,
        "",
      ]
    : [];

  return [
    `#let theme = ${theme}`,
    `#set text(fill: theme.text, size: 12pt, font: "${font}")`,
    ...page,
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
    '#import "/typbase/lib.typ" as typbase',
    "",
    // The user's workspace prelude, same text the editor appends.
    settings.pagePrelude ?? "",
    "",
  ].join("\n");
}
