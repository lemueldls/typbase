import { EditorView } from "@codemirror/view";

/**
 * Workspace additions on top of `typstTheme` from `@typbase/codemirror`.
 * The package theme covers the generic chrome and token colors; keep only
 * choices specific to this app here.
 */
export const typstEditorTheme = EditorView.theme({
  // Soft wrap off: long lines scroll sideways instead of being clipped. The
  // package theme hides horizontal overflow because wrapped lines have nothing
  // to scroll.
  "&.cm-soft-wrap-off .cm-scroller": {
    overflowX: "auto",
  },

  // Autocomplete icons are Material Symbols ligatures, same font as MsIcon.
  // The ::after content is the glyph name. The font turns it into a
  // pictogram. CodeMirror's default glyphs (ƒ, ○) would win, so the mapping
  // has to live in the theme.
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
});
