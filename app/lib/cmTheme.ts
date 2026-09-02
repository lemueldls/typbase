import { EditorView } from "@codemirror/view";

/**
 * CodeMirror theme extension bound to the app tokens. The static rules in
 * main.css LOSE to CM's base theme, which is injected at runtime with equal
 * specificity — that is why the cursor stayed black and tooltips stayed
 * grey. A theme extension is injected after the base theme, so these win.
 * Values are `var(--...)`, which re-resolve on theme changes without
 * recreating the extension.
 */
export function typstEditorTheme() {
  return EditorView.theme({
    "&.cm-editor": {
      backgroundColor: "transparent",
      color: "var(--text)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--accent)",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
    },
    ".cm-placeholder": {
      color: "var(--text-secondary)",
    },
    ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      {
        backgroundColor: "color-mix(in srgb, var(--accent) 26%, transparent)",
      },
    ".cm-selectionMatch": {
      backgroundColor: "color-mix(in srgb, var(--warning) 24%, transparent)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--text-secondary)",
      border: "none",
    },
    ".cm-lintRange-error": {
      textDecorationColor: "var(--danger)",
    },
    ".cm-lintRange-warning": {
      textDecorationColor: "var(--warning)",
    },
    ".cm-lint-marker-error": {
      backgroundColor: "var(--danger)",
    },
    ".cm-lint-marker-warning": {
      backgroundColor: "var(--warning)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--surface)",
      color: "var(--text)",
      border: "1px solid var(--border)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected=true]": {
      backgroundColor: "var(--accent-soft)",
      color: "var(--text)",
    },
    ".cm-tooltip-hover": {
      backgroundColor: "var(--surface)",
      color: "var(--text)",
      border: "1px solid var(--border)",
    },
    ".cm-panels": {
      backgroundColor: "var(--surface-2)",
      color: "var(--text)",
    },
  });
}
