/**
 * Shared workspace/page types for typbase.
 *
 * These describe the Loro doc data model as JS data. The app, the storage
 * layer, and (later) the server and public records all speak this shape.
 * The `typbase/query/*.json` files injected into the Typst world serialize
 * these same types, so a change here is a breaking change for `.typ` docs
 * that consume `#typbase.query`.
 */

/** A page in a workspace. Mirrors an entry of the workspace doc's `pages` map. */
export interface PageMeta {
  id: string;
  /** Virtual Typst path, e.g. `pages/welcome.typ` or `daily/2026-08-31.typ`. */
  path: string;
  title: string;
  /**
   * How the page is edited. "notebook" splits the source into `// %%` cells;
   * "document" is the plain editor. Older docs read back as "document".
   */
  kind: PageKind;
  categoryId: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  publishedAt: number | null;
  publishUri: string | null;
}

/** Page editing shape; the notebook marker syntax is in AGENTS.md. */
export type PageKind = "document" | "notebook";

/** A page category. Categories are named groups in the sidebar. */
export interface Category {
  id: string;
  name: string;
}

/** One workspace in the local registry (`workspaces.json`). */
export interface WorkspaceInfo {
  id: string;
  /** Cache of the workspace doc's `settings.name`; refreshed on open/rename. */
  name: string;
  /** Material Symbols glyph name (e.g. "folder"); empty means the default. */
  icon?: string;
  createdAt: number;
  lastOpenedAt: number;
}

/** Typed-section metadata extracted from `#typbase.section(...)` blocks. */
export interface Section {
  /** Stable-ish id: `${kind}:${rangeStart}`. */
  id: string;
  /** Section kind, e.g. "flashcards", "quiz", "summary", "agenda", "code". */
  kind: string;
  /** Byte range of the block content in the raw page source. */
  rangeStart: number;
  rangeEnd: number;
  /** Heading text or first words, for listing. */
  title: string;
  /** Raw Typst source of the block content. */
  text?: string;
}

/** Media a page references, keyed by the reference path in the Typst source. */
export interface AssetMeta {
  /** Content hash in the workspace's local blob store. */
  hash?: string;
  /** atproto blob CID; absent until the asset is uploaded to a space. */
  cid?: string;
  mime: string;
  size: number;
  alt: string | null;
}

/** Per-page publish defaults (overridable per publish). */
export interface PublishSettings {
  langs: string[];
  tags: string[];
  includePdf: boolean;
}

/** Provider config for AI features. Keys never live here: they are in local.json. */
export interface AiConfig {
  /**
   * AI features are opt-in: generators run nothing until a user turns this
   * on. Keys alone do not enable anything either.
   */
  enabled: boolean;
  provider: "openai-compatible" | "anthropic" | "ollama";
  /** Base URL. Empty for the well-known host of the chosen provider. */
  baseUrl: string;
  chatModel: string;
}

export interface SearchSettings {
  /** Semantic search costs a model download; off by default. */
  semantic: boolean;
  /** HuggingFace model id used for embeddings. */
  embeddingModel: string;
}

/** Notebook-mode behavior, synced with the workspace like the theme. */
export interface NotebookSettings {
  /** Show the `[n]` execution counters in cell headers. */
  showCounters: boolean;
}

export type ThemeMode = "auto" | "light" | "dark";

/**
 * Interface size preset. Scales chrome text, control heights, and icons
 * together so controls never clip their labels.
 */
export type UiSize = "small" | "default" | "large";

/** Interface density preset. Scales padding and gaps only. */
export type UiDensity = "compact" | "default" | "spacious";

/** Corner radius preset. Scales the radius tokens; pills stay pills. */
export type UiRadius = "square" | "default" | "round";

/**
 * Editor spellcheck provider: "off", the browser's own checker ("native"), or
 * Harper's local WASM grammar checker ("harper").
 */
export type SpellcheckMode = "off" | "native" | "harper";

/**
 * Theme seed names, in display order. A theme authors these; the resolver
 * derives soft variants, mode-dependent overlay, and on-* text from them.
 */
export const THEME_SEED_KEYS = [
  "surface",
  "surface2",
  "surface3",
  "border",
  "borderStrong",
  "text",
  "textSecondary",
  "accent",
  "ok",
  "warning",
  "danger",
  "info",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "code",
] as const;

export type ThemeSeedToken = (typeof THEME_SEED_KEYS)[number];

/**
 * What a theme author writes: the surface and text ramps, borders, the
 * accent, status solids, the tinted hue ramp, and the code surface. Soft
 * backgrounds, overlay, and on-* text colors are derived, so themes cannot
 * drift apart on those.
 */
export type ThemeSeeds = Record<ThemeSeedToken, string>;

/**
 * Resolved palette token names, in display order. The custom palette editor
 * edits these; the chrome reads them as `--color-*` and the Typst renderer
 * mirrors the ones that are not chrome-only (see `THEME_COLOR_KEYS`).
 */
export const THEME_PALETTE_TOKEN_KEYS = [
  "surface",
  "surface2",
  "surface3",
  "border",
  "borderStrong",
  "text",
  "textSecondary",
  "accent",
  "accentSoft",
  "ok",
  "okSoft",
  "warning",
  "warningSoft",
  "danger",
  "dangerSoft",
  "info",
  "infoSoft",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "code",
  "overlay",
] as const;

export type ThemePaletteToken = (typeof THEME_PALETTE_TOKEN_KEYS)[number];

/**
 * A theme palette as token -> CSS color. The renderer palette is derived
 * from these, so a custom theme only needs the same tokens the app chrome
 * uses; values are CSS color strings.
 */
export type ThemePaletteTokens = Record<ThemePaletteToken, string>;

/** Workspace settings stored in the workspace doc's `settings` map. */
/** A Typst package installed in the workspace, synced with the settings. */
export interface InstalledPackage {
  namespace: string;
  name: string;
  version: string;
}

export interface WorkspaceSettings {
  name: string;
  /** Page id shown when the app opens, and the page that "Home" points to. */
  homePageId: string | null;
  /**
   * Typst source for newly created daily notes. Placeholders: `{title}` (the
   * formatted title, e.g. "Wednesday, Sep 16, 2026"), `{date}` (ISO date),
   * `{weekday}`, and `{previous}` / `{next}` (neighboring note ids, or "none").
   */
  dailyNoteTemplate: string;
  /**
   * User prelude appended after the generated one on every compile (editor,
   * previews, published pages). This is the escape hatch for custom styling
   * and Typst-driven views; theme/fonts stay in their own settings.
   */
  pagePrelude: string;
  /** UI language and date formatting locale; "auto" follows the browser. */
  locale: string;
  font: string;
  mathFont: string | null;
  codeFont: string | null;
  /**
   * Body text size in pt. One app pt renders as one screen px (the editor
   * shows 16px source text, so the default 16pt matches it).
   */
  textSize: number;
  /** Editor spellcheck provider; synced with the workspace like fonts. */
  spellcheck: SpellcheckMode;
  /** Theme mode; "auto" follows the OS preference. Synced like everything else. */
  theme: ThemeMode;
  /** Named theme from the registry ("default", "catppuccin", "custom", ...). */
  themeName: string;
  /** Token map for the "custom" theme (or a complete override for any theme). */
  themeCustom: ThemePaletteTokens | null;
  /** Interface sizing, synced with the workspace like the theme. */
  uiSize: UiSize;
  uiDensity: UiDensity;
  uiRadius: UiRadius;
  /**
   * Universe packages the workspace depends on. The spec list syncs with the
   * workspace; the tarballs stay in a device-local cache and are re-fetched
   * on demand.
   */
  installedPackages: InstalledPackage[];
  publish: PublishSettings;
  ai: AiConfig;
  search: SearchSettings;
  notebook: NotebookSettings;
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  name: "My workspace",
  homePageId: null,
  dailyNoteTemplate: [
    "= {title}",
    "",
    'Previous: #typbase.page-link("{previous}")',
    "",
    'Next: #typbase.page-link("{next}")',
    "",
  ].join("\n"),
  pagePrelude: "",
  locale: "auto",
  font: "Maple Mono",
  mathFont: "New Computer Modern Math",
  codeFont: null,
  textSize: 16,
  spellcheck: "off",
  theme: "auto",
  themeName: "default",
  themeCustom: null,
  uiSize: "default",
  uiDensity: "default",
  uiRadius: "default",
  installedPackages: [],
  publish: {
    langs: ["en"],
    tags: [],
    includePdf: false,
  },
  ai: {
    enabled: false,
    provider: "ollama",
    baseUrl: "",
    chatModel: "qwen2.5:7b",
  },
  search: {
    semantic: false,
    embeddingModel: "Xenova/bge-small-en-v1.5",
  },
  notebook: {
    showCounters: true,
  },
};

/*
 * Shapes served at `typbase/query/<kind>.json`. These are what Typst code
 * receives from `#typbase.query`, so keep field names stable.
 */

/** `typbase/query/config.json` */
export interface QueryConfig {
  name: string;
  homePageId: string | null;
  font: string;
}

/** `typbase/query/pages.json` (optionally filtered by category id). */
export type QueryPages = PageMeta[];

/** `typbase/query/categories.json` */
export type QueryCategories = Category[];

/** `typbase/query/daily.json` (optionally filtered by `YYYY-MM`). */
export type QueryDaily = PageMeta[];

export {
  NATIVE_OAUTH_METADATA_PATH,
  NATIVE_OAUTH_REDIRECT_URI,
  OAUTH_CLIENT_NAME,
  OAUTH_METADATA_PATH,
  OAUTH_REDIRECT_PATH,
  OAUTH_SCOPES,
} from "./atproto";
export * from "./plugins";

/** Kinds `#typbase.query` supports. */
export type QueryKind =
  | "config"
  | "pages"
  | "categories"
  | "daily"
  | "backlinks"
  | "sections"
  | "content"
  | "plugin-data";

export interface ParsedQuery {
  kind: QueryKind;
  /** Filter name, e.g. `by-category`. */
  filterName: string | null;
  /** Filter value matched by its name, e.g. the category id. */
  filterValue: string | null;
}

/**
 * Parse a `typbase/query/...` request path into a query description. Filters
 * are `<name>/<value>` pairs, e.g. `typbase/query/pages/by-category/work.json`.
 */
export function parseQueryPath(path: string): ParsedQuery | null {
  const match = /^typbase\/query\/([a-z-]+)(?:\/([\w-]+)(?:\/([\w-]+))?)?\.json$/.exec(path);
  if (!match) return null;

  const kind = match[1] as QueryKind;
  if (
    ![
      "config",
      "pages",
      "categories",
      "daily",
      "backlinks",
      "sections",
      "content",
      "plugin-data",
    ].includes(kind)
  ) {
    return null;
  }

  return {
    kind,
    filterName: match[2] ?? null,
    filterValue: match[3] ?? null,
  };
}
