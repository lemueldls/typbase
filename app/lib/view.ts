/** View modes in tab order. The shell validates `?mode=` against this list. */
export const VIEW_MODES = ["write", "split", "source", "read"] as const;

export type ViewMode = (typeof VIEW_MODES)[number];
