import type { MaterialSymbol } from "material-symbols";

import symbols from "~/assets/symbols.json";

/** One searchable icon from the Material Symbols catalog. */
export interface SymbolEntry {
  id: MaterialSymbol;
  title: string;
  /** Google's font-metadata tags ("house" for `home`); the search matches them. */
  synonyms: string[];
}

/** The catalog is generated from the font's own glyph list (see
 *  scripts/symbols/transform.mjs), so every id renders. */
export const allSymbols = symbols as SymbolEntry[];

/** Fallback used when a workspace has no icon of its own. */
export const DEFAULT_WORKSPACE_ICON: MaterialSymbol = "folder";

/**
 * Curated set shown first when the search box is empty. Without it the grid
 * opens on "123", "360", "10k" — alphabetically first, practically useless.
 * All ids are verified against the glyph union; sorting by this list is what
 * makes the picker inviting on first open.
 */
export const POPULAR_WORKSPACE_ICONS: MaterialSymbol[] = [
  "folder",
  "book",
  "menu_book",
  "school",
  "home",
  "work",
  "lightbulb",
  "science",
  "palette",
  "code",
  "translate",
  "calendar_month",
  "notes",
  "auto_stories",
  "psychology",
  "music_note",
  "sports_soccer",
  "storefront",
  "travel_explore",
  "contact_page",
  "dashboard",
  "functions",
  "attach_money",
  "pets",
  "account_circle",
  "rocket_launch",
  "newspaper",
];

export interface SymbolSearchResult {
  entries: SymbolEntry[];
  total: number;
}

/**
 * Text search over icon names. Matches the underscored id, the title-cased
 * name, the font metadata synonyms ("house" finds `home`), and per-word
 * prefixes ("cal" finds "calendar_month"), like mnemo's picker. The grid
 * renders `limit` entries at most; `total` carries the full count so the
 * picker can say when the list was cut.
 */
export function searchSymbols(query: string, limit = 300): SymbolSearchResult {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    // Popular first, then the rest in catalog order, deduped.
    const popular = POPULAR_WORKSPACE_ICONS.map((id) =>
      allSymbols.find((entry) => entry.id === id),
    ).filter((entry): entry is SymbolEntry => !!entry);
    const rest = allSymbols.filter((entry) => !POPULAR_WORKSPACE_ICONS.includes(entry.id));
    return {
      entries: [...popular, ...rest].slice(0, limit),
      total: allSymbols.length,
    };
  }

  const entries = allSymbols.filter(({ id, title, synonyms }) => {
    if (id.includes(needle) || title.toLowerCase().includes(needle)) return true;
    if (synonyms?.some((tag) => tag.toLowerCase().includes(needle))) return true;
    return title.split(/\s+/).some((word) => word.toLowerCase().startsWith(needle));
  });

  return { entries: entries.slice(0, limit), total: entries.length };
}
