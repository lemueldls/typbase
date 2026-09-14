import { EditorView } from "@codemirror/view";

export function typstEditorTheme() {
  return EditorView.theme({
    "&.cm-editor": {
      backgroundColor: "transparent",
      color: "var(--color-text)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--color-accent)",
    },
    ".cm-content": {
      caretColor: "var(--color-accent)",
    },
    ".cm-placeholder": {
      color: "var(--color-text-secondary)",
    },
    ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      {
        backgroundColor: "color-mix(in srgb, var(--color-accent) 26%, transparent)",
      },
    ".cm-selectionMatch": {
      backgroundColor: "color-mix(in srgb, var(--color-warning) 24%, transparent)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--color-text) 5%, transparent)",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--color-text-secondary)",
      border: "none",
    },
    ".cm-lintRange-error": {
      textDecorationColor: "var(--color-danger)",
    },
    ".cm-lintRange-warning": {
      textDecorationColor: "var(--color-warning)",
    },
    ".cm-lint-marker-error": {
      backgroundColor: "var(--color-danger)",
    },
    ".cm-lint-marker-warning": {
      backgroundColor: "var(--color-warning)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--color-surface)",
      color: "var(--color-text)",
      border: "1px solid var(--color-border)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected=true]": {
      backgroundColor: "var(--color-accent-soft)",
      color: "var(--color-text)",
    },
    ".cm-tooltip-hover": {
      backgroundColor: "var(--color-surface)",
      color: "var(--color-text)",
      border: "1px solid var(--color-border)",
    },
    ".cm-panels": {
      backgroundColor: "var(--color-surface-2)",
      color: "var(--color-text)",
    },
  });
}
