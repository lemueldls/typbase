/**
 * Typst text-editing commands exposed by EditablePane and driven by the
 * EditToolbar. Each maps to one markup insertion: inline wrappers (bold,
 * italic, code...), line prefixes (headings, lists), or history steps.
 */
export type EditCommand =
  | "undo"
  | "redo"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "math"
  | "link"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList";
