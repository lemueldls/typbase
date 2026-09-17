import { EditorView } from "@codemirror/view";

export const typstEditorTheme = EditorView.theme({
  "&.cm-editor": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--color-text)",
    fontFamily: "var(--font-mono)",
    fontSize: "1rem",
  },
  "&.cm-editor.cm-focused": {
    outline: "none",
  },

  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.4",
    overflowX: "hidden",
    overflowY: "scroll",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    padding: "1rem 1.25rem",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-placeholder": {
    color: "var(--color-text-secondary)",
  },
  ".cm-specialChar": {
    color: "var(--color-danger)",
  },
  ".cm-highlightSpace": {
    backgroundImage:
      "radial-gradient(circle at 50% 55%, var(--color-border-strong) 20%, transparent 0)",
  },
  ".cm-trailingSpace": {
    backgroundColor: "color-mix(in srgb, var(--color-danger) 22%, transparent)",
  },

  // Cursor and selection.
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "1.5px solid var(--color-accent)",
    marginLeft: "-0.75px",
  },
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 26%, transparent)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 30%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--color-warning) 24%, transparent)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--color-warning) 32%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--color-warning) 45%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 35%, transparent)",
    outlineColor: "color-mix(in srgb, var(--color-accent) 55%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--color-text) 5%, transparent)",
  },

  // Gutters. CM sizes each element to its line block, so sharing the content
  // font and line-height puts every number on the baseline of its line. The
  // count grows leftward from a fixed right edge; centering would shift the
  // digits as the number gains a column.
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-text-secondary)",
    border: "none",
    fontSize: "1rem",
    // Same as the content so numbers share the raw text baseline.
    lineHeight: "1.4",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 0.75rem 0 0.5rem",
    minWidth: "2.75rem",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--color-text)",
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
    // The base theme paints an SVG with `content:`; swap it for a dot.
    content: "none",
    width: "0.5rem",
    height: "0.5rem",
    borderRadius: "999px",
    backgroundImage: "none",
  },
  ".cm-lint-marker-error": {
    backgroundColor: "var(--color-danger)",
  },
  ".cm-lint-marker-warning": {
    backgroundColor: "var(--color-warning)",
  },
  ".cm-lint-marker-info": {
    backgroundColor: "var(--color-accent)",
  },
  ".cm-lint-marker-hint": {
    backgroundColor: "var(--color-text-secondary)",
  },

  // Bracket matching.
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--color-ok) 20%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--color-ok) 45%, transparent)",
    borderRadius: "2px",
  },
  ".cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--color-danger) 22%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--color-danger) 45%, transparent)",
    borderRadius: "2px",
  },

  // Panels: search, go-to-line, lint.
  ".cm-panels": {
    backgroundColor: "var(--color-surface-2)",
    color: "var(--color-text)",
    fontFamily: "var(--font-sans)",
    fontSize: "0.85rem",
  },
  ".cm-panels-top": {
    borderBottom: "1px solid var(--color-border)",
  },
  ".cm-panels-bottom": {
    borderTop: "1px solid var(--color-border)",
  },
  ".cm-panel.cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.35rem",
    padding: "0.5rem 2rem 0.5rem 0.65rem",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
    margin: "0",
  },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    fontSize: "0.78rem",
    color: "var(--color-text-secondary)",
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    marginRight: "0",
    accentColor: "var(--color-accent)",
  },
  ".cm-panel.cm-search [name=close], .cm-dialog-close, .cm-panel.cm-panel-lint [name=close]": {
    position: "absolute",
    top: "0.4rem",
    right: "0.4rem",
    padding: "0.1rem 0.35rem",
    font: "inherit",
    fontSize: "1rem",
    lineHeight: "1",
    color: "var(--color-text-secondary)",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "0.35rem",
    cursor: "pointer",
  },
  ".cm-panel.cm-search [name=close]:hover, .cm-dialog-close:hover, .cm-panel.cm-panel-lint [name=close]:hover":
    {
      color: "var(--color-text)",
      backgroundColor: "var(--color-surface-3)",
    },
  ".cm-textfield": {
    padding: "0.25rem 0.5rem",
    color: "var(--color-text)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.85rem",
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.5rem",
    outline: "none",
  },
  ".cm-textfield:focus": {
    borderColor: "var(--color-accent)",
    boxShadow: "0 0 0 2px var(--color-focus-ring)",
  },
  ".cm-button": {
    padding: "0.25rem 0.6rem",
    fontFamily: "inherit",
    fontSize: "0.8rem",
    color: "var(--color-text)",
    background: "var(--color-surface-3)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.5rem",
    cursor: "pointer",
  },
  ".cm-button:hover": {
    backgroundColor: "var(--color-surface)",
  },
  ".cm-panel.cm-goto-line": {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 2rem 0.5rem 0.65rem",
  },
  ".cm-panel.cm-goto-line label": {
    fontSize: "0.78rem",
    color: "var(--color-text-secondary)",
  },
  ".cm-panel.cm-panel-lint ul": {
    maxHeight: "12rem",
    padding: "0",
    margin: "0",
    listStyle: "none",
  },
  ".cm-panel.cm-panel-lint ul li": {
    padding: "0.3rem 2rem 0.3rem 0.65rem",
    cursor: "pointer",
  },
  ".cm-panel.cm-panel-lint ul li[aria-selected]": {
    backgroundColor: "var(--color-accent-soft)",
    color: "var(--color-text)",
  },
  ".cm-panel.cm-panel-lint ul li u": {
    textDecoration: "none",
  },

  // Tooltips: hover previews, completions, diagnostics.
  ".cm-tooltip": {
    maxWidth: "min(50vw, 28rem)",
    fontFamily: "var(--font-sans)",
    fontSize: "0.85rem",
    color: "var(--color-text)",
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.6rem",
    boxShadow: "0 8px 30px rgb(0 0 0 / 0.12)",
    // Long identifiers and URLs would otherwise run past the edge.
    overflowWrap: "anywhere",
  },
  ".cm-tooltip-section:not(:first-child)": {
    borderTop: "1px solid var(--color-border)",
  },
  ".cm-tooltip-hover": {
    padding: "0.5rem",
    // Docs hovers, render popups, and lint lists can outgrow the viewport.
    // None of these tooltips set `arrow`, so scrolling the host clips nothing.
    maxHeight: "min(70vh, 32rem)",
    overflow: "auto",
    overscrollBehavior: "contain",
  },
  // Docs hovers arrive as <pre>; wrap instead of scrolling sideways.
  ".cm-tooltip pre": {
    margin: "0",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8rem",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  ".cm-tooltip.cm-tooltip-above .cm-tooltip-arrow:before, .cm-tooltip.cm-tooltip-below .cm-tooltip-arrow:before":
    {
      borderTopColor: "var(--color-border)",
      borderBottomColor: "var(--color-border)",
    },
  ".cm-tooltip.cm-tooltip-above .cm-tooltip-arrow:after, .cm-tooltip.cm-tooltip-below .cm-tooltip-arrow:after":
    {
      borderTopColor: "var(--color-surface)",
      borderBottomColor: "var(--color-surface)",
    },

  // Autocomplete.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    padding: "0.2rem",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    minWidth: "16rem",
    maxHeight: "14em",
    fontFamily: "var(--font-mono)",
    fontSize: "0.875rem",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li, .cm-tooltip.cm-tooltip-autocomplete > ul > completion-section":
    {
      padding: "0.3rem 0.45rem",
      lineHeight: "1.4",
      borderRadius: "0.35rem",
    },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    color: "var(--color-text)",
    backgroundColor: "var(--color-accent-soft)",
  },
  ".cm-tooltip-autocomplete-disabled ul li[aria-selected]": {
    color: "var(--color-text-secondary)",
    backgroundColor: "var(--color-surface-3)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    fontSize: "0.75rem",
    color: "var(--color-text-secondary)",
    borderBottom: "1px solid var(--color-border)",
  },
  ".cm-completionLabel": {
    fontFamily: "var(--font-mono)",
  },
  ".cm-completionMatchedText": {
    color: "var(--color-accent)",
    fontWeight: "600",
    textDecoration: "none",
  },
  ".cm-completionDetail": {
    marginLeft: "0.6em",
    fontSize: "0.8em",
    fontStyle: "normal",
    color: "var(--color-text-secondary)",
  },
  ".cm-tooltip.cm-completionInfo": {
    padding: "0.5rem 0.65rem",
    maxHeight: "min(70vh, 32rem)",
    overflow: "auto",
    overscrollBehavior: "contain",
  },
  ".cm-snippetField": {
    borderRadius: "2px",
    backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, transparent)",
  },

  // Autocomplete icons are Material Symbols ligatures, same font as MsIcon.
  // The ::after content holds the glyph name; the font turns it into a
  // pictogram. Base glyphs (ƒ, ○) would win from codemirror.css, so the
  // mapping has to live in the theme.
  ".cm-completionIcon": {
    width: "1em",
    paddingRight: "0.5em",
    fontFamily: "var(--md-icon-font)",
    fontSize: "100%",
    color: "var(--color-text-secondary)",
    opacity: "0.8",
    fontVariationSettings: '"FILL" 0, "wght" var(--md-icon-weight)',
  },
  ".cm-completionIcon-syntax:after": {
    content: "'code'",
  },
  ".cm-completionIcon-function:after": {
    content: "'function'",
  },
  ".cm-completionIcon-type:after": {
    content: "'category'",
  },
  ".cm-completionIcon-param:after": {
    content: "'settings'",
  },
  ".cm-completionIcon-constant:after": {
    content: "'special_character'",
  },
  ".cm-completionIcon-path:after": {
    content: "'folder'",
  },
  ".cm-completionIcon-package:after": {
    content: "'package'",
  },
  ".cm-completionIcon-label:after": {
    content: "'label'",
  },
  ".cm-completionIcon-font:after": {
    content: "'font_download'",
  },
  ".cm-completionIcon-symbol:after": {
    content: "'tag'",
  },

  // The lint hover tooltip is a section inside the hover host; the host's
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
    textDecorationColor: "var(--color-danger)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--color-warning)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-info": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--color-accent)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-hint": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--color-text-secondary)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-active": {
    borderRadius: "2px",
    backgroundColor: "color-mix(in srgb, var(--color-warning) 18%, transparent)",
  },
  ".cm-diagnostic": {
    padding: "0.4rem 0.65rem",
    fontFamily: "var(--font-sans)",
  },
  ".cm-diagnosticText": {
    display: "block",
  },
  ".cm-diagnostic-error": {
    color: "var(--color-danger)",
    borderLeft: "3px solid var(--color-danger)",
  },
  ".cm-diagnostic-warning": {
    color: "var(--color-warning)",
    borderLeft: "3px solid var(--color-warning)",
  },
  ".cm-diagnostic-info": {
    color: "var(--color-accent)",
    borderLeft: "3px solid var(--color-accent)",
  },
  ".cm-diagnostic-hint": {
    color: "var(--color-text-secondary)",
    borderLeft: "3px solid var(--color-border-strong)",
  },
  ".cm-diagnosticSource": {
    marginTop: "0.3rem",
    fontSize: "0.75em",
    opacity: "0.75",
  },
  ".cm-diagnosticAction": {
    margin: "0.35rem 0.4rem 0 0",
    padding: "0.2rem 0.55rem",
    font: "inherit",
    fontSize: "0.78rem",
    lineHeight: "1.4",
    textAlign: "left",
    color: "var(--color-text)",
    backgroundColor: "var(--color-surface-2)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.4rem",
    cursor: "pointer",
  },
  ".cm-diagnosticAction:hover": {
    backgroundColor: "var(--color-surface-3)",
    borderColor: "var(--color-border-strong)",
  },
  ".cm-diagnosticAction:active": {
    backgroundColor: "var(--color-accent-soft)",
    borderColor: "var(--color-accent)",
  },
  ".cm-lintPoint-error:after": {
    borderBottomColor: "var(--color-danger)",
  },
  ".cm-lintPoint-warning:after": {
    borderBottomColor: "var(--color-warning)",
  },
  ".cm-lintPoint-info:after": {
    borderBottomColor: "var(--color-accent)",
  },
  ".cm-lintPoint-hint:after": {
    borderBottomColor: "var(--color-border-strong)",
  },
});
