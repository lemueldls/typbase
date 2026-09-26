// Host-supplied helpers for plugin surfaces. Import them from any plugin:
//
//   #import "/typbase/ui.typ": *
//
// A surface function returns `surface(ui, state: ops, view: dict)`. Typst
// binds required parameters positionally, so `ui` is passed first. The host
// applies `state` to the plugin's synced doc and `view` to device-local
// state, then renders the surface once more without an action. Step functions
// therefore only describe the change:
//
//   #let main(ctx) = {
//     let patch = if ctx.action != none { step(ctx.state, ctx.action, ctx) } else { (:) }
//     surface([ ... ], ..patch)
//   }
//
// Every interactive element carries data-tb-* attributes; the sandbox runtime
// turns clicks and field values into actions. Colors come from `ctx.theme`
// (camelCase palette tokens: text, textSecondary, accent, accentSoft, red,
// orange, yellow, green, cyan, blue, violet, code, ...).


#let action-attrs(name, args: (:)) = (
  "data-tb-action": name,
  "data-tb-args": json.encode(args),
)

// Runs several host actions in order from one element. Entries are
// `(name: "...", args: (:))`; fields from the enclosing form are sent to each.
// `button(actions: ...)` builds this attribute for you.
#let action-chain(entries) = (
  "data-tb-chain": json.encode(
    entries.map(entry => (name: entry.at("name"), args: entry.at("args", default: (:)))),
  ),
)

// The surface result. `state` ops go to the synced doc, `view` merges into
// device-local state.
#let surface(ui, state: (), view: ()) = (ui: ui, state: state, view: view)

// Patch builders for step functions. Spread the result into `surface(...)`.
#let ops-state(ops) = (state: ops)
#let ops-view(view) = (view: view)
#let ops-both(ops, view) = (state: ops, view: view)


// Buttons and every other helper here follow Typst's rule: parameters with
// defaults are named-only, so write `action:`, `args:`, `kind:` explicitly.
#let button(
  label,
  action: none,
  actions: (),
  args: (:),
  kind: "default",
  selected: false,
  disabled: false,
  style: none,
  body: none,
) = {
  let attrs = (type: "button", class: "tb-button tb-button--" + kind)
  if selected { attrs.insert("class", attrs.at("class") + " tb-button--selected") }
  if action != none { attrs += action-attrs(action, args: args) }
  if actions.len() > 0 { attrs.insert("data-tb-chain", json.encode(actions)) }
  if disabled { attrs.insert("disabled", "disabled") }
  if style != none { attrs.insert("style", style) }

  html.elem("button", attrs: attrs, (if body == none { label } else { body }))
}

// Color chip. The plugin passes a color from `ctx.theme` (or its own value).
#let swatch(color, action: none, args: (:), selected: false, label: "") = {
  let attrs = (
    type: "button",
    class: "tb-swatch" + (if selected { " tb-button--selected" } else { "" }),
    style: "--tb-swatch:" + color,
    title: label,
    "aria-label": label,
  )
  if action != none { attrs += action-attrs(action, args: args) }

  html.elem("button", attrs: attrs)
}

// Material Symbols ligature; the host loads the icon font.
#let icon(name, size: none) = html.elem(
  "span",
  attrs: (class: "tb-icon") + (if size != none { (style: "font-size:" + size) } else { (:) }),
  name,
)

#let field(title, name, value: "", placeholder: "", kind: "text", commit: "change") = html.elem(
  "label",
  attrs: (class: "tb-field"),
  [
    #html.elem("span", attrs: (class: "tb-field__label"), title)
    #html.elem(
      "input",
      attrs: (
        class: "tb-input",
        type: kind,
        "data-tb-field": name,
        "data-tb-commit": commit,
        value: str(value),
        placeholder: placeholder,
      ),
    )
  ],
)

#let textarea(name, value: "", rows: 3, placeholder: "", commit: "change") = html.elem(
  "textarea",
  attrs: (
    class: "tb-input tb-textarea",
    rows: str(rows),
    placeholder: placeholder,
    "data-tb-field": name,
    "data-tb-commit": commit,
  ),
  value,
)

#let select(name, options, value: none, commit: "change") = html.elem(
  "select",
  attrs: (
    class: "tb-input tb-select",
    "data-tb-field": name,
    "data-tb-commit": commit,
  ),
  {
    for option in options {
      let (option-value, label) = option
      let selected = if option-value == value { ("selected": "selected") } else { (:) }
      html.elem("option", attrs: (value: str(option-value)) + selected, label)
    }
  },
)

#let checkbox(title, name, checked: false) = html.elem(
  "label",
  attrs: (class: "tb-check"),
  [
    #html.elem(
      "input",
      attrs: (type: "checkbox", "data-tb-field": name, "data-tb-commit": "change")
        + (if checked { ("checked": "checked") } else { (:) }),
    )
    #html.elem("span", title)
  ],
)

// Field container: the runtime collects only the fields inside one form.
#let form(body: []) = html.elem(
  "div",
  attrs: (class: "tb-form tb-stack", "data-tb-form": "form"),
  body,
)


#let panel(body: [], title: none) = html.elem(
  "section",
  attrs: (class: "tb-panel"),
  [
    #if title != none [#html.elem("h3", attrs: (class: "tb-panel__title"), title)]
    #body
  ],
)

#let stack(body: [], gap: "0.5rem") = html.elem(
  "div",
  attrs: (class: "tb-stack", style: "gap:" + gap),
  body,
)

#let row(body: [], gap: "0.5rem") = html.elem(
  "div",
  attrs: (class: "tb-row", style: "gap:" + gap),
  body,
)

#let grid(columns, body: [], gap: "0.5rem") = html.elem(
  "div",
  attrs: (
    class: "tb-grid",
    style: "gap:" + gap + ";grid-template-columns:repeat(" + str(columns) + ",minmax(0,1fr))",
  ),
  body,
)

#let toolbar(body: [], gap: "0.35rem") = html.elem(
  "div",
  attrs: (class: "tb-row tb-toolbar", style: "gap:" + gap),
  body,
)

#let card(body: []) = html.elem("div", attrs: (class: "tb-card"), body)

#let badge(body: [], tone: "muted") = html.elem(
  "span",
  attrs: (class: "tb-badge tb-badge--" + tone),
  body,
)

#let muted(body: []) = html.elem("span", attrs: (class: "tb-muted"), body)

#let empty(body: []) = html.elem("div", attrs: (class: "tb-empty"), body)


// Free-positioned element inside `board`. The runtime moves it live and sends
// x/y on drop, merged with `args` (carry the record id there).
#let movable(action, x: 0, y: 0, body: [], args: (:)) = html.elem(
  "div",
  attrs: (
    class: "tb-movable",
    style: "left:" + str(x) + "px;top:" + str(y) + "px",
    "data-tb-move": action,
    "data-tb-x": str(x),
    "data-tb-y": str(y),
    "data-tb-args": json.encode(args),
  ),
  body,
)

#let draggable(action, value, body: [], args: (:)) = html.elem(
  "div",
  attrs: (class: "tb-draggable") + action-attrs(action, args: (value: value) + args),
  body,
)

#let droppable(value, body: []) = html.elem(
  "div",
  attrs: (class: "tb-drop", "data-tb-drop": value),
  body,
)

// Paint surface. `strokes` round-trips to the canvas as
// `((color:, width:, points: ()))`; each point is `(x, y)`.
#let canvas(action, strokes: (), color: "#1f2328", width: 3, height: 320) = html.elem(
  "div",
  attrs: (
    class: "tb-canvas-host",
    style: "height:" + str(height) + "px",
    "data-tb-component": "canvas",
    "data-tb-action": action,
    "data-tb-props": json.encode((strokes: strokes, color: color, width: width)),
  ),
)

#let board(body: [], height: 360) = html.elem(
  "div",
  attrs: (class: "tb-board", "data-tb-board": "board", style: "height:" + str(height) + "px"),
  body,
)


// Patch op builders.
#let op-append(collection, record) = (op: "append", collection: collection, record: record)
#let op-set(collection, id, key, value) = (
  op: "set",
  collection: collection,
  id: id,
  key: key,
  value: value,
)
#let op-merge(collection, id, record) = (op: "merge", collection: collection, id: id, record: record)
#let op-inc(collection, id, key, value) = (
  op: "inc",
  collection: collection,
  id: id,
  key: key,
  value: value,
)
#let op-remove(collection, id) = (op: "remove", collection: collection, id: id)


//
// AI calls arrive back at the plugin as a render whose `ctx.action` is
// `ai.result` with `text`, `diagnostics`, and `error` in its args. A surface
// that wants to keep the answer stores it through its patch; a surface that
// only displays it can branch on the action name.
//
// `format: "typst"` runs the app's dialect prompt and the compile check, so
// the text is validated Typst (and repaired first when it does not compile).

// One-shot call; the answer arrives as an `ai.result` action.
#let ai-complete(prompt, format: "text", args: (:), kind: "default", label: "Ask AI") = button(
  label,
  action: "ai.complete",
  args: (prompt: prompt, format: format) + args,
  kind: kind,
)

// Streaming call: the host writes the growing text into record `id`'s `field`
// (and `<field>Status` = streaming/done/error) while the model answers, so the
// surface re-renders live. The final `field` holds the validated text for
// `format: "typst"`.
#let ai-stream(
  label,
  prompt,
  collection,
  id,
  field: "text",
  format: "text",
  args: (:),
  kind: "default",
) = button(
  label,
  action: "ai.stream",
  args: (prompt: prompt, collection: collection, id: id, field: field, format: format) + args,
  kind: kind,
)
