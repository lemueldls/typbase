import type { PageKind } from "@typbase/typing";
import type { MaterialSymbol } from "material-symbols";

export type ViewModeId = "write" | "notebook" | "split" | "source" | "read";

export interface ViewMode {
  /** The mode's unique identifier, used in the URL and for state. */
  id: ViewModeId;
  /** The Material Symbols icon to use for this mode. */
  icon: MaterialSymbol;
}

/** Notebook glyph, shared by the view-mode tab and the sidebar rows. */
const NOTEBOOK_ICON: MaterialSymbol = "view_agenda";

/** View modes in tab order. The shell validates `?mode=` against this list. */
export const VIEW_MODES: ViewMode[] = [
  { id: "write", icon: "edit_square" },
  { id: "notebook", icon: NOTEBOOK_ICON },
  { id: "split", icon: "split_scene" },
  { id: "source", icon: "frame_source" },
  { id: "read", icon: "article" },
] as const;

/** Page-kind glyphs for the sidebar: a document sheet, or the notebook cells. */
export const PAGE_KIND_ICONS: Record<PageKind, MaterialSymbol> = {
  document: "description",
  notebook: NOTEBOOK_ICON,
};
