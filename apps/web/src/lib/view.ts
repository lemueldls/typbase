import type { MaterialSymbol } from "material-symbols";

export type ViewModeId = "write" | "notebook" | "split" | "source" | "read";

export interface ViewMode {
  /** The mode's unique identifier, used in the URL and for state. */
  id: ViewModeId;
  /** The Material Symbols icon to use for this mode. */
  icon: MaterialSymbol;
}

/** View modes in tab order. The shell validates `?mode=` against this list. */
export const VIEW_MODES: ViewMode[] = [
  { id: "write", icon: "edit_square" },
  { id: "notebook", icon: "note_stack" },
  { id: "split", icon: "split_scene" },
  { id: "source", icon: "frame_source" },
  { id: "read", icon: "article" },
] as const;
