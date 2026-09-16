/**
 * Shared workspace/page types for typbase.
 *
 * These describe the Loro doc data model as JS data. The app, the storage
 * layer, and (later) the server and public records all speak this shape.
 * The `typbase-query/*.json` files injected into the Typst world serialize
 * these same types, so a change here is a breaking change for `.typ` docs
 * that consume `#typbase.query`.
 */

/** A page in a workspace. Mirrors an entry of the workspace doc's `pages` map. */
export interface PageMeta {
  id: string;
  /** Virtual Typst path, e.g. `pages/welcome.typ` or `daily/2026-08-31.typ`. */
  path: string;
  title: string;
  categoryId: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  publishedAt: number | null;
  publishUri: string | null;
}

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

export type ThemeMode = "auto" | "light" | "dark";

/**
 * A theme palette as token -> CSS color. The renderer palette is derived
 * from these, so a custom theme only needs the same tokens the app chrome
 * uses. Union of TokenName keys; values are CSS color strings.
 */
export type ThemePaletteTokens = Record<
  | "surface"
  | "surface2"
  | "surface3"
  | "border"
  | "borderStrong"
  | "text"
  | "textSecondary"
  | "accent"
  | "accentSoft"
  | "danger"
  | "dangerSoft"
  | "ok"
  | "warning",
  string
>;

/** Workspace settings stored in the workspace doc's `settings` map. */
export interface WorkspaceSettings {
  name: string;
  /** Page id shown when the app opens, and the page that "Home" points to. */
  homePageId: string | null;
  /** Typst source for newly created daily notes. */
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
  /** Theme mode; "auto" follows the OS preference. Synced like everything else. */
  theme: ThemeMode;
  /** Named theme from the registry ("default", "catppuccin", "custom", ...). */
  themeName: string;
  /** Token map for the "custom" theme (or a complete override for any theme). */
  themeCustom: ThemePaletteTokens | null;
  publish: PublishSettings;
  ai: AiConfig;
  search: SearchSettings;
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  name: "My workspace",
  homePageId: null,
  dailyNoteTemplate: [
    "= {date} ({weekday})",
    "",
    'Previous: #typbase.page-link("{previous}")',
    "",
    'Next: #typbase.page-link("{next}")',
  ].join("\n"),
  pagePrelude: "",
  locale: "auto",
  font: "Maple Mono",
  mathFont: "New Computer Modern Math",
  codeFont: null,
  textSize: 16,
  theme: "auto",
  themeName: "default",
  themeCustom: null,
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
    embeddingModel: "BAAI/bge-small-en-v1.5",
  },
};

/*
 * Shapes served at `typbase-query/<kind>.json`. These are what Typst code
 * receives from `#typbase.query`, so keep field names stable.
 */

/** `typbase-query/config.json` */
export interface QueryConfig {
  name: string;
  homePageId: string | null;
  font: string;
}

/** `typbase-query/pages.json` (optionally filtered by category id). */
export type QueryPages = PageMeta[];

/** `typbase-query/categories.json` */
export type QueryCategories = Category[];

/** `typbase-query/daily.json` (optionally filtered by `YYYY-MM`). */
export type QueryDaily = PageMeta[];

export { NATIVE_OAUTH_REDIRECT_URI, OAUTH_SCOPES } from "./atproto";
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
 * Parse a `typbase-query/...` request path into a query description. Filters
 * are `<name>/<value>` pairs, e.g. `typbase-query/pages/by-category/work.json`.
 */
export function parseQueryPath(path: string): ParsedQuery | null {
  const match = /^typbase-query\/([a-z-]+)(?:\/([\w-]+)(?:\/([\w-]+))?)?\.json$/.exec(path);
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
