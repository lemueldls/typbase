import { EditorView } from "@codemirror/view";

/**
 * Editor line-height. The engine crops frames to the editor's line box, so pass
 * this to `TypstState.setLineHeightRatio`. A host that changes the line height
 * in its own theme must pass the same number.
 */
export const TYPST_EDITOR_LINE_HEIGHT = 1.4;

/**
 * Default chrome for the Typst editor: cursor, selection, gutters, panels,
 * tooltips, completions, and diagnostics.
 *
 * Colors, fonts, and spacing come from the `--typst-*` properties defined in
 * `@typbase/codemirror/theme.css`. Add this extension before the host's own
 * theme so the host wins where it has an opinion.
 *
 * The chrome lives in a theme extension rather than the stylesheet because
 * CodeMirror mounts its base theme at runtime, after any static stylesheet.
 * At equal specificity the later sheet wins, so only a theme module can
 * replace those rules reliably.
 */
export const typstTheme = EditorView.theme({
  "&.cm-editor": {
    backgroundColor: "transparent",
    color: "var(--typst-color-text)",
    fontFamily: "var(--typst-font-mono)",
    fontSize: "var(--typst-font-size)",
    fontFeatureSettings: "var(--typst-font-features)",
  },
  "&.cm-editor.cm-focused": {
    outline: "none",
  },

  ".cm-scroller": {
    fontFamily: "var(--typst-font-mono)",
    lineHeight: `${TYPST_EDITOR_LINE_HEIGHT}`,
    overflowX: "hidden",
    overflowY: "scroll",
    padding: "var(--typst-space-2-5) 0",
    scrollbarColor: "auto",
  },
  ".cm-scroller::-webkit-scrollbar": {
    width: "10px",
    height: "10px",
  },
  ".cm-scroller::-webkit-scrollbar-track": {
    background: "transparent",
  },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    background: "var(--typst-color-border-strong)",
    border: "2px solid transparent",
    borderRadius: "var(--typst-radius-full)",
    backgroundClip: "content-box",
  },
  ".cm-scroller::-webkit-scrollbar-thumb:hover": {
    backgroundColor: "var(--typst-color-text-secondary)",
    backgroundClip: "content-box",
  },
  ".cm-content": {
    fontFamily: "var(--typst-font-text)",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-placeholder": {
    color: "var(--typst-color-text-secondary)",
  },
  ".cm-specialChar": {
    color: "var(--typst-color-danger)",
  },
  ".cm-highlightSpace": {
    backgroundImage:
      "radial-gradient(circle at 50% 55%, var(--typst-color-border-strong) 20%, transparent 0)",
  },
  ".cm-trailingSpace": {
    backgroundColor: "color-mix(in srgb, var(--typst-color-danger) 22%, transparent)",
  },

  // Cursor and selection.
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "1.5px solid var(--typst-color-accent)",
    marginLeft: "-0.75px",
  },
  ".cm-selectionLayer": {
    zIndex: "0",
  },
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--typst-color-accent) 26%, transparent)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--typst-color-accent) 30%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--typst-color-warning) 24%, transparent)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--typst-color-warning) 32%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--typst-color-warning) 45%, transparent)",
    borderRadius: "var(--typst-radius-xs)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--typst-color-accent) 35%, transparent)",
    outlineColor: "color-mix(in srgb, var(--typst-color-accent) 55%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--typst-color-text) 5%, transparent)",
  },

  // Gutters. CM sizes each element to its line block, so sharing the content
  // font and line-height puts every number on the baseline of its line. The
  // count grows leftward from a fixed right edge. Centering would shift the
  // digits as the number gains a column.
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--typst-color-text-secondary)",
    border: "none",
    fontSize: "var(--typst-font-size)",
    // Same as the content so numbers share the raw text baseline.
    lineHeight: `${TYPST_EDITOR_LINE_HEIGHT}`,
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 var(--typst-space-3) 0 var(--typst-space-2)",
    minWidth: "2.75rem",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--typst-color-text)",
  },
  ".cm-gutter-lint": {
    width: "1.25rem",
  },
  ".cm-gutters .cm-gutter-lint .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
  },
  ".cm-lint-marker": {
    content: "none",
    width: "2px",
    height: "100%",
    backgroundImage: "none",
  },
  ".cm-lint-marker-error": {
    backgroundColor: "var(--typst-color-danger)",
  },
  ".cm-lint-marker-warning": {
    backgroundColor: "var(--typst-color-warning)",
  },
  ".cm-lint-marker-info": {
    backgroundColor: "var(--typst-color-accent)",
  },
  ".cm-lint-marker-hint": {
    backgroundColor: "var(--typst-color-text-secondary)",
  },

  // Bracket matching.
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--typst-color-ok) 20%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--typst-color-ok) 45%, transparent)",
    borderRadius: "var(--typst-radius-xs)",
  },
  ".cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--typst-color-danger) 22%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--typst-color-danger) 45%, transparent)",
    borderRadius: "var(--typst-radius-xs)",
  },

  // Panels: search, go-to-line, lint.
  ".cm-panels": {
    backgroundColor: "var(--typst-color-surface-2)",
    color: "var(--typst-color-text)",
    fontFamily: "var(--typst-font-text)",
    fontSize: "var(--typst-text-md)",
  },
  ".cm-panels-top": {
    borderBottom: "1px solid var(--typst-color-border)",
  },
  ".cm-panels-bottom": {
    borderTop: "1px solid var(--typst-color-border)",
  },
  ".cm-panel.cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "var(--typst-space-1-5)",
    padding:
      "var(--typst-space-2) var(--typst-space-8) var(--typst-space-2) var(--typst-space-2-5)",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
    margin: "0",
  },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--typst-space-1)",
    fontSize: "var(--typst-text-sm)",
    color: "var(--typst-color-text-secondary)",
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    marginRight: "0",
    accentColor: "var(--typst-color-accent)",
  },
  ".cm-panel.cm-search [name=close], .cm-dialog-close, .cm-panel.cm-panel-lint [name=close]": {
    position: "absolute",
    top: "var(--typst-space-1-5)",
    right: "var(--typst-space-1-5)",
    padding: "var(--typst-space-0-5) var(--typst-space-1-5)",
    font: "inherit",
    fontSize: "var(--typst-text-lg)",
    lineHeight: "var(--typst-leading-none)",
    color: "var(--typst-color-text-secondary)",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "var(--typst-radius-sm)",
    cursor: "pointer",
  },
  ".cm-panel.cm-search [name=close]:hover, .cm-dialog-close:hover, .cm-panel.cm-panel-lint [name=close]:hover":
    {
      color: "var(--typst-color-text)",
      backgroundColor: "var(--typst-color-surface-3)",
    },
  ".cm-textfield": {
    padding: "var(--typst-space-1) var(--typst-space-2)",
    color: "var(--typst-color-text)",
    fontFamily: "var(--typst-font-mono)",
    fontSize: "var(--typst-text-md)",
    backgroundColor: "var(--typst-color-surface)",
    border: "1px solid var(--typst-color-border)",
    borderRadius: "var(--typst-radius-md)",
    outline: "none",
  },
  ".cm-textfield:focus": {
    borderColor: "var(--typst-color-accent)",
    boxShadow: "0 0 0 2px var(--typst-color-focus-ring)",
  },
  ".cm-button": {
    padding: "var(--typst-space-1) var(--typst-space-2-5)",
    fontFamily: "inherit",
    fontSize: "var(--typst-text-sm)",
    color: "var(--typst-color-text)",
    background: "var(--typst-color-surface-3)",
    border: "1px solid var(--typst-color-border)",
    borderRadius: "var(--typst-radius-md)",
    cursor: "pointer",
  },
  ".cm-button:hover": {
    backgroundColor: "var(--typst-color-surface)",
  },
  ".cm-panel.cm-goto-line": {
    display: "flex",
    alignItems: "center",
    gap: "var(--typst-space-2)",
    padding:
      "var(--typst-space-2) var(--typst-space-8) var(--typst-space-2) var(--typst-space-2-5)",
  },
  ".cm-panel.cm-goto-line label": {
    fontSize: "var(--typst-text-sm)",
    color: "var(--typst-color-text-secondary)",
  },
  ".cm-panel.cm-panel-lint ul": {
    maxHeight: "12rem",
    padding: "0",
    margin: "0",
    listStyle: "none",
  },
  ".cm-panel.cm-panel-lint ul li": {
    padding:
      "var(--typst-space-1) var(--typst-space-8) var(--typst-space-1) var(--typst-space-2-5)",
    cursor: "pointer",
  },
  ".cm-panel.cm-panel-lint ul li[aria-selected]": {
    backgroundColor: "var(--typst-color-accent-soft)",
    color: "var(--typst-color-text)",
  },
  ".cm-panel.cm-panel-lint ul li u": {
    textDecoration: "none",
  },

  // Tooltips: hover previews, completions, diagnostics.
  ".cm-tooltip": {
    maxWidth: "min(50vw, 28rem)",
    fontFamily: "var(--typst-font-text)",
    fontSize: "var(--typst-text-md)",
    color: "var(--typst-color-text)",
    backgroundColor: "var(--typst-color-surface)",
    border: "1px solid var(--typst-color-border)",
    borderRadius: "var(--typst-radius-md)",
    boxShadow: "0 8px 30px rgb(0 0 0 / 0.12)",
    // Tooltips are usually parented to the body, so they need a tier above
    // the host's panes and menus.
    zIndex: "var(--typst-z-tooltip)",
    // Long identifiers and URLs would otherwise run past the edge.
    overflowWrap: "anywhere",
  },
  ".cm-tooltip-section:not(:first-child)": {
    borderTop: "1px solid var(--typst-color-border)",
  },
  ".cm-tooltip-hover": {
    padding: "var(--typst-space-2)",
    maxHeight: "min(70vh, 32rem)",
    overflow: "auto",
    overscrollBehavior: "contain",
  },
  // Docs hovers arrive as <pre>. Wrap instead of scrolling sideways.
  ".cm-tooltip pre": {
    margin: "0",
    fontFamily: "var(--typst-font-mono)",
    fontSize: "var(--typst-text-sm)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  ".cm-tooltip code": {
    fontFamily: "var(--typst-font-mono)",
  },
  ".cm-tooltip.cm-tooltip-above .cm-tooltip-arrow:before, .cm-tooltip.cm-tooltip-below .cm-tooltip-arrow:before":
    {
      borderTopColor: "var(--typst-color-border)",
      borderBottomColor: "var(--typst-color-border)",
    },
  ".cm-tooltip.cm-tooltip-above .cm-tooltip-arrow:after, .cm-tooltip.cm-tooltip-below .cm-tooltip-arrow:after":
    {
      borderTopColor: "var(--typst-color-surface)",
      borderBottomColor: "var(--typst-color-surface)",
    },

  // Autocomplete.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    padding: "var(--typst-space-1)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    minWidth: "16rem",
    maxHeight: "14em",
    fontFamily: "var(--typst-font-mono)",
    fontSize: "var(--typst-text-md)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li, .cm-tooltip.cm-tooltip-autocomplete > ul > completion-section":
    {
      padding: "var(--typst-space-1) var(--typst-space-2)",
      lineHeight: "var(--typst-leading-tight)",
      borderRadius: "var(--typst-radius-sm)",
    },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    color: "var(--typst-color-text)",
    backgroundColor: "var(--typst-color-accent-soft)",
  },
  ".cm-tooltip-autocomplete-disabled ul li[aria-selected]": {
    color: "var(--typst-color-text-secondary)",
    backgroundColor: "var(--typst-color-surface-3)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    fontSize: "var(--typst-text-xs)",
    color: "var(--typst-color-text-secondary)",
    borderBottom: "1px solid var(--typst-color-border)",
  },
  ".cm-completionLabel": {
    fontFamily: "var(--typst-font-mono)",
  },
  ".cm-completionMatchedText": {
    color: "var(--typst-color-accent)",
    fontWeight: "600",
    textDecoration: "none",
  },
  ".cm-completionDetail": {
    marginLeft: "0.6em",
    fontSize: "0.8em",
    fontStyle: "normal",
    color: "var(--typst-color-text-secondary)",
  },
  ".cm-tooltip.cm-completionInfo": {
    padding: "var(--typst-space-2) var(--typst-space-2-5)",
    maxHeight: "min(70vh, 32rem)",
    overflow: "auto",
    overscrollBehavior: "contain",
  },
  ".cm-snippetField": {
    borderRadius: "var(--typst-radius-xs)",
    backgroundColor: "color-mix(in srgb, var(--typst-color-accent) 22%, transparent)",
  },

  // The lint hover tooltip is a section inside the hover host. The host's
  // max-height and overflow handle long diagnostic lists.
  ".cm-tooltip-lint": {
    padding: "0",
    margin: "0",
    listStyle: "none",
  },

  // Lint ranges and diagnostics.
  ".cm-lintRange": {
    paddingBottom: "0",
    backgroundImage: "none",
  },
  ".cm-lintRange-error": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--typst-color-danger)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--typst-color-warning)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-info": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--typst-color-accent)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-hint": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--typst-color-text-secondary)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-active": {
    borderRadius: "var(--typst-radius-xs)",
    backgroundColor: "color-mix(in srgb, var(--typst-color-warning) 18%, transparent)",
  },
  ".cm-diagnostic": {
    padding: "var(--typst-space-1-5) var(--typst-space-2-5)",
    fontFamily: "var(--typst-font-text)",
  },
  ".cm-diagnosticText": {
    display: "block",
  },
  ".cm-diagnostic-error": {
    color: "var(--typst-color-danger)",
    borderLeft: "3px solid var(--typst-color-danger)",
  },
  ".cm-diagnostic-warning": {
    color: "var(--typst-color-warning)",
    borderLeft: "3px solid var(--typst-color-warning)",
  },
  ".cm-diagnostic-info": {
    color: "var(--typst-color-accent)",
    borderLeft: "3px solid var(--typst-color-accent)",
  },
  ".cm-diagnostic-hint": {
    color: "var(--typst-color-text-secondary)",
    borderLeft: "3px solid var(--typst-color-border-strong)",
  },
  ".cm-diagnosticSource": {
    marginTop: "var(--typst-space-1)",
    fontSize: "0.75em",
    opacity: "0.75",
  },
  ".cm-diagnosticAction": {
    margin: "var(--typst-space-1-5) var(--typst-space-1-5) 0 0",
    padding: "var(--typst-space-1) var(--typst-space-2)",
    font: "inherit",
    fontSize: "var(--typst-text-sm)",
    lineHeight: "var(--typst-leading-tight)",
    textAlign: "left",
    color: "var(--typst-color-text)",
    backgroundColor: "var(--typst-color-surface-2)",
    border: "1px solid var(--typst-color-border)",
    borderRadius: "var(--typst-radius-sm)",
    cursor: "pointer",
  },
  ".cm-diagnosticAction:hover": {
    backgroundColor: "var(--typst-color-surface-3)",
    borderColor: "var(--typst-color-border-strong)",
  },
  ".cm-diagnosticAction:active": {
    backgroundColor: "var(--typst-color-accent-soft)",
    borderColor: "var(--typst-color-accent)",
  },
  ".cm-lintPoint-error:after": {
    borderBottomColor: "var(--typst-color-danger)",
  },
  ".cm-lintPoint-warning:after": {
    borderBottomColor: "var(--typst-color-warning)",
  },
  ".cm-lintPoint-info:after": {
    borderBottomColor: "var(--typst-color-accent)",
  },
  ".cm-lintPoint-hint:after": {
    borderBottomColor: "var(--typst-color-border-strong)",
  },
});
