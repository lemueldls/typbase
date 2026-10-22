import type { ThemePaletteTokens, WorkspaceSettings } from "@typbase/typing";

import { TypstState } from "@typbase/engine";

import { effectiveLocale } from "~/composables/appLocale";
import { useTypst } from "~/composables/typst";
import { themeColorsFromPalette } from "~/lib/rendererPalette";
import { resolveLightTheme, resolveTheme } from "~/lib/themes";

/**
 * How much a paged export shrinks. The whole document is scaled, so absolute
 * units (diagrams, raw-block padding) shrink with the text.
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
   * How much a paged export shrinks. `document` mode scales the whole
   * document; `text` mode multiplies the font size. Leave it at 1 for anything
   * standing in for the editor pane (chat rendering, link resolution) and pass
   * `EXPORT_TEXT_SCALE` for output that lands on a real page.
   */
  textScale?: number;
  /**
   * How `textScale` is applied. `document` scales the whole paged document
   * with Typst's `scale(reflow: true)`, so absolute units (diagrams, raw-block
   * padding) shrink along with the text. `text` scales only the font size,
   * which is the fallback for a document that sets its own page configuration:
   * `#set page` cannot live inside the scale container. `none` leaves scaling
   * to the caller, which the combined workspace export uses to wrap each page.
   * Defaults to `document` for paged output and `text` for HTML, whose renderer
   * drops scaled content entirely.
   */
  scaleMode?: "document" | "text" | "none";
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
 * compiles with. Page geometry, the export scale, and the user's prelude are
 * added here.
 */
export async function publishPrelude(
  settings: WorkspaceSettings,
  options: PublishPreludeOptions = {},
): Promise<string> {
  await useTypst();
  const scale = options.textScale ?? 1;
  const bodySize = options.textSize ?? settings.textSize;
  const scaleMode = options.scaleMode ?? (options.paged ? "document" : "text");
  // Document scaling keeps the text size and scales everything; text scaling
  // is the fallback for documents that set their own page configuration.
  const textSize = scaleMode === "text" ? bodySize * scale : bodySize;
  const style = TypstState.stylePrelude(
    themeColorsFromPalette(publishThemePalette(settings, options)),
    textSize,
    settings.font,
    settings.mathFont,
    settings.codeFont,
    effectiveLocale(settings),
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
  // Last, so page configuration in the user prelude stays outside the scale
  // container. A `#set page` inside it is an error.
  const percent = Number((scale * 100).toFixed(3));
  const scaleRule =
    scaleMode === "document" && scale !== 1
      ? `#show: doc => scale(${percent}%, reflow: true, doc)`
      : "";

  return [style, ...page, ...context, settings.pagePrelude ?? "", scaleRule]
    .filter(Boolean)
    .join("\n");
}
