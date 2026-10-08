import type { ThemePaletteTokens, WorkspaceSettings } from "@typbase/typing";

import { TypstState } from "@typbase/engine";

import { useTypst } from "~/composables/typst";
import { themeColorsFromPalette } from "~/lib/rendererPalette";
import { resolveLightTheme, resolveTheme } from "~/lib/themes";

/**
 * How much the body text shrinks when a document leaves the editor.
 */
export const EXPORT_TEXT_SCALE = 0.5;

export interface PublishPreludeOptions {
  /**
   * "light" (the default) normalizes to a light palette so documents stay
   * readable on white and print well. "workspace" keeps the active palette and
   * fills pages with its surface, so a dark theme exports as a dark document.
   */
  theme?: "light" | "workspace";
  /** Page size for paged output. A4 unless set. */
  pageSize?: "a4" | "letter";
  /**
   * Emit `#set page(...)`. Paged targets (PDF, SVG, the project `.typ`) need
   * it. HTML export has no pages.
   */
  paged?: boolean;
  /** Body text size in pt, before `textScale`. Defaults to the workspace's size. */
  textSize?: number;
  /**
   * Multiplier on the body text size. Leave it at 1 for anything standing in
   * for the editor pane (chat rendering, link resolution) and pass
   * `EXPORT_TEXT_SCALE` for output that lands on a real page.
   */
  textScale?: number;
  /**
   * The `note` binding for the page being compiled, built by
   * `pageContextBinding`. Inlined per entry so a bundle stays self-contained.
   */
  context?: string;
}

const PAGE_WIDTHS = { a4: 595.28, letter: 612 } as const;

/** The palette an export will use, for styling the HTML artifact to match. */
export function publishThemePalette(
  settings: WorkspaceSettings,
  options: Pick<PublishPreludeOptions, "theme"> = {},
): ThemePaletteTokens {
  const theme =
    options.theme === "workspace" ? resolveTheme(settings) : resolveLightTheme(settings);
  return theme.palette;
}

/**
 * The code-block theme for an export palette: the generated tmTheme plus the
 * virtual path the prelude references. Project bundles write it next to
 * `lib.typ`. The render worker inserts it into its own world.
 */
export async function publishSyntaxTheme(
  settings: WorkspaceSettings,
  options: Pick<PublishPreludeOptions, "theme"> = {},
): Promise<{ path: string; text: string }> {
  await useTypst();
  const colors = themeColorsFromPalette(publishThemePalette(settings, options));

  return { path: colors.tmThemePath(), text: colors.tmTheme() };
}

/**
 * The document prelude for exports, publishing, and the project mirror. The
 * style block (theme, text, headings, fonts, code-block theme) comes from the
 * wasm engine's `stylePrelude`, so it is byte-for-byte the prelude the app
 * compiles with. Only the page geometry and the user's prelude are added here.
 */
export async function publishPrelude(
  settings: WorkspaceSettings,
  options: PublishPreludeOptions = {},
): Promise<string> {
  await useTypst();
  const textSize = (options.textSize ?? settings.textSize) * (options.textScale ?? 1);
  const style = TypstState.stylePrelude(
    themeColorsFromPalette(publishThemePalette(settings, options)),
    textSize,
    settings.font,
    settings.mathFont,
    settings.codeFont,
    settings.locale && settings.locale !== "auto" ? settings.locale : "en",
    settings.typography.ligatures,
    settings.typography.kerning,
  );

  const page = options.paged
    ? [
        // Page geometry lives here rather than in the wasm prelude so the
        // exported `.typ` compiles to the same document outside the app.
        `#set page(width: ${PAGE_WIDTHS[options.pageSize ?? "a4"]}pt, height: auto, margin: 16pt, fill: theme.surface)`,
        "",
      ]
    : [];
  // The context sits before the user prelude so custom Typst can read it.
  const context = options.context ? [options.context, ""] : [];

  return [style, ...page, ...context, settings.pagePrelude ?? ""].join("\n");
}
