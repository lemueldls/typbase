# @typbase/codemirror

CodeMirror 6 editing for Typst, extracted from the Typbase editor.

- Inline WYSIWYG frames rendered by the Typbase engine.
- Typst highlighting, hover documentation, and autocomplete.
- Notebook cells, diagnostics, and the static fallback highlighter.
- The Typst keymap and the shared frame and widget helpers.

`@typbase/engine` is a peer dependency.

## Setup

The theme extension styles the editor chrome. `theme.css` styles the DOM the
extension creates: rendered frames, token classes, and notebook cells. Import
both.

```ts
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { typstPlugin, typstTheme } from "@typbase/codemirror";
import "@typbase/codemirror/theme.css";

const view = new EditorView({
  parent,
  state: EditorState.create({
    extensions: [typstTheme, typstPlugin(fileId, spaceId, path, text, prelude, false, typstState)],
  }),
});
```

Put `typstTheme` before the host's own theme so host rules win.

The engine crops frames to the editor's line box. Pass `TYPST_EDITOR_LINE_HEIGHT`
to `TypstState.setLineHeightRatio` for the config. A host that changes the line
height in its theme passes the same number.

```ts
import { TYPST_EDITOR_LINE_HEIGHT } from "@typbase/codemirror";

typstState.setLineHeightRatio(configId, TYPST_EDITOR_LINE_HEIGHT);
```

The chrome is a theme extension, not part of the stylesheet, because CodeMirror
mounts its base theme at runtime. A static stylesheet lands before it in the
document and loses every rule at equal specificity.

## Theming

`theme.css` ships a neutral light palette and reads every value from a
`--typst-*` custom property on `:root`. Set the properties to restyle the editor
without copying rules.

- `--typst-font-text`, `--typst-font-mono`, `--typst-font-size`, `--typst-font-features`
- `--typst-color-*` for text, surfaces, borders, accent, status colors, and the heading hues
- `--typst-space-*`, `--typst-text-*`, `--typst-leading-*`, `--typst-radius-*`
- `--typst-motion-fast`, `--typst-z-menu`, `--typst-z-tooltip`

Notebook rails and their menu draw Material Symbols Rounded ligatures. Load the
face in the host and point `--typst-icon-font` at it. Without the face, the rail
shows the glyph name next to the cell label.
