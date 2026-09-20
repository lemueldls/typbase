import type { ThemePaletteTokens, WorkspaceSettings } from "@typbase/typing";

import { TypstState } from "@typbase/wasm";

import { useTypst } from "~/composables/typst";
import { themeColorsFromPalette } from "~/lib/rendererPalette";
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
  /** Body text size in pt; defaults to the workspace's configured size. */
  textSize?: number;
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

/**
 * The code-block theme for an export palette: the generated tmTheme plus the
 * virtual path the prelude references. Project bundles write it next to
 * `lib.typ`; the render worker inserts it into its own world.
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
 * compiles with; only the page geometry and the user's prelude are added here.
 */
export async function publishPrelude(
  settings: WorkspaceSettings,
  options: PublishPreludeOptions = {},
): Promise<string> {
  await useTypst();
  const style = TypstState.stylePrelude(
    themeColorsFromPalette(publishThemePalette(settings, options)),
    options.textSize ?? settings.textSize,
    settings.font,
    settings.mathFont,
    settings.codeFont,
    settings.locale && settings.locale !== "auto" ? settings.locale : "en",
  );

  const page = options.paged
    ? [
        // Page geometry lives here rather than in the wasm prelude so the
        // exported `.typ` compiles to the same document outside the app.
        `#set page(width: ${PAGE_WIDTHS[options.pageSize ?? "a4"]}pt, height: auto, margin: 16pt, fill: theme.surface)`,
        "",
      ]
    : [];

  return [style, ...page, settings.pagePrelude ?? ""].join("\n");
}
