// Host-supplied helpers for plugin surfaces. Import them from any plugin:
//
//   #import "/typbase-ui.typ": panel, button, field, patch-holder
//
// Every interactive element is a plain HTML element carrying data-tb-*
// attributes; the sandbox runtime turns clicks and field values into actions.
// The host applies the patch the surface returns and styles all tb-* classes.
//
// Bodies are named (`body:`) so call sites read the same everywhere; Typst
// `html.elem` wants its body positionally, which the helpers handle.

// ---------------------------------------------------------------- actions --

#let action-attrs(name, args: (:)) = (
  "data-tb-action": name,
  "data-tb-args": json.encode(args),
)

#let button(label, action, args: (:), kind: "default", disabled: false) = {
  let base = (
      type: "button",
      class: "tb-button tb-button--" + kind,
    ) + action-attrs(action, args: args)
  let attrs = if disabled { base + ("disabled": "disabled") } else { base }

  html.elem("button", attrs: attrs, label)
}

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
      attrs: (type: "checkbox", "data-tb-field": name, "data-tb-commit": "change") +
        (if checked { ("checked": "checked") } else { (:) }),
    )
    #html.elem("span", title)
  ],
)

// ------------------------------------------------------------------ layout --

#let panel(body: [], title: none) = html.elem(
  "section",
  attrs: (class: "tb-panel"),
  [
    #if title != none [#html.elem("h3", attrs: (class: "tb-panel__title"), title)]
    #body
  ],
)

#let stack(body: [], gap: "0.4rem") = html.elem(
  "div",
  attrs: (class: "tb-stack", style: "gap:" + gap),
  body,
)

#let row(body: [], gap: "0.4rem") = html.elem(
  "div",
  attrs: (class: "tb-row", style: "gap:" + gap),
  body,
)

#let grid(columns, body: [], gap: "0.4rem") = html.elem(
  "div",
  attrs: (
    class: "tb-grid",
    style: "gap:" + gap + ";grid-template-columns:repeat(" + str(columns) + ",minmax(0,1fr))",
  ),
  body,
)

#let card(body: []) = html.elem("div", attrs: (class: "tb-card"), body)

#let badge(body: [], tone: "muted") = html.elem(
  "span",
  attrs: (class: "tb-badge tb-badge--" + tone),
  body,
)

#let muted(body: []) = html.elem("span", attrs: (class: "tb-muted"), body)

#let calendar-cell(body: [], tone: "default", action: none, args: (:)) = {
  let base = (class: "tb-day tb-day--" + tone)
  let attrs = if action == none { base } else { base + action-attrs(action, args: args) }

  html.elem("div", attrs: attrs, body)
}

// ------------------------------------------------------------ canvas/board --

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

// Full-viewport board for overlay surfaces; floating children position
// against the window, and the surface lets pointer events fall through.
#let overlay-board(body: []) = html.elem(
  "div",
  attrs: (class: "tb-board tb-board--fill", "data-tb-board": "overlay"),
  body,
)

#let floating(body: [], x: 12, y: 12, right: false, bottom: false) = html.elem(
  "div",
  attrs: (
    class: "tb-floating",
    style: if right and bottom {
      "right:" + str(x) + "px;bottom:" + str(y) + "px"
    } else if right {
      "right:" + str(x) + "px;top:" + str(y) + "px"
    } else if bottom {
      "left:" + str(x) + "px;bottom:" + str(y) + "px"
    } else {
      "left:" + str(x) + "px;top:" + str(y) + "px"
    },
  ),
  body,
)

// Free-positioned element. The runtime moves it live and sends x/y on drop,
// merged with `args` (carry the record id there).
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

// ----------------------------------------------------------------- patches --

// Action builders. A patch is `(state: (op, ..), view: (key: value, ..))`.
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

#let patch-state(ops) = (state: ops)
#let patch-both(ops, view) = (state: ops, view: view)
#let patch-view(view) = (view: view)

// Hidden holder the host reads, validates, and persists before the HTML hits
// the frame. Renders nothing when there is no patch.
#let patch-holder(patch) = if patch == none { [] } else {
  html.elem("div", attrs: ("hidden": "hidden", "data-tb-patch": json.encode(patch)))
}

// Applies a patch's state ops to a state dict so a surface can render the
// post-action view from the same object it sends to the host.
#let apply-patch(state, patch) = {
  if patch == none { return state }

  let next = state
  for op in patch.at("state", default: ()) {
    let collection = next.at(op.collection, default: ())
    if op.op == "append" {
      collection.push(op.record)
    } else if op.op == "remove" {
      collection = collection.filter(record => record.id != op.id)
    } else {
      collection = collection.map(record => {
        if record.id != op.id { return record }
        let updated = record
        if op.op == "merge" {
          for (key, value) in op.record { updated.insert(key, value) }
        } else if op.op == "set" {
          updated.insert(op.key, op.value)
        } else if op.op == "inc" {
          updated.insert(op.key, updated.at(op.key, default: 0) + op.value)
        }
        updated
      })
    }
    next.insert(op.collection, collection)
  }

  next
}

// Merges a patch's view changes into the view dict.
#let apply-view(view, patch) = {
  if patch == none { return view }

  let next = view
  for (key, value) in patch.at("view", default: (:)) { next.insert(key, value) }

  next
}

// Field container: the runtime collects only the fields inside one form.
#let form(body: []) = html.elem(
  "div",
  attrs: (class: "tb-form", "data-tb-form": "form"),
  stack(body: body),
)
