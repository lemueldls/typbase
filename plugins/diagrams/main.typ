// Diagrams plugin. Nodes and edges are synced records. The surface editor is
// HTML/SVG so it can stay interactive; notes embed Fletcher in paged output
// and an inline SVG fallback wherever the Typst HTML renderer is used.

#import "@preview/fletcher:0.5.8" as fletcher
#import "/typbase/lib.typ" as typbase
#import "/typbase/ui.typ": *

#let board-width = 720
#let board-height = 520
#let unit = 48.0
#let history-limit = 40

#let nodes(state) = state.at("nodes", default: ())
#let edges(state) = state.at("edges", default: ())
#let ordered-nodes(state) = nodes(state).sorted(key: node => node.at("order", default: 0))
#let ordered-edges(state) = edges(state).sorted(key: edge => edge.at("order", default: 0))

#let find-node(all, id) = all.find(node => node.id == id)

// Records store theme tokens as `@surface2`, not a copy of the color. The
// surface resolves them through `ctx.theme`, and an embed resolves them through
// the document's `theme` dict. A literal hex value still works.
#let theme-camel = (
  "surface-2": "surface2",
  "surface-3": "surface3",
  "border-strong": "borderStrong",
  "text-secondary": "textSecondary",
  "accent-soft": "accentSoft",
  "on-accent": "onAccent",
  "ok-soft": "okSoft",
  "warning-soft": "warningSoft",
  "danger-soft": "dangerSoft",
  "info-soft": "infoSoft",
  "on-danger": "onDanger",
)
#let theme-keys = (
  "surface2": "surface-2",
  "surface3": "surface-3",
  "borderStrong": "border-strong",
  "textSecondary": "text-secondary",
  "accentSoft": "accent-soft",
  "onAccent": "on-accent",
  "okSoft": "ok-soft",
  "warningSoft": "warning-soft",
  "dangerSoft": "danger-soft",
  "infoSoft": "info-soft",
  "onDanger": "on-danger",
)
#let fallback-colors = (
  surface: "#f9f9f8",
  surface2: "#f1f3f2",
  surface3: "#e7eae8",
  border: "#dbe0dd",
  borderStrong: "#c6ccc8",
  text: "#293133",
  textSecondary: "#66716f",
  accent: "#1f6f6b",
  accentSoft: "#e3e8e7",
  onAccent: "#ffffff",
  ok: "#3f704e",
  okSoft: "#e3e8e7",
  warning: "#8f6a13",
  warningSoft: "#ece8dd",
  danger: "#b3443e",
  dangerSoft: "#f1e3e2",
  info: "#2f6f9f",
  infoSoft: "#e1e8ed",
  red: "#b3443e",
  orange: "#a85c23",
  yellow: "#8f6a13",
  green: "#3f704e",
  cyan: "#2f6f9f",
  blue: "#2f6f9f",
  violet: "#6b538f",
  code: "#f1f4f2",
)
#let local-key(key) = theme-camel.at(key, default: key)
#let prelude-key(key) = theme-keys.at(key, default: key)
#let theme-color(value, ctx: none, theme: none) = {
  if not value.starts-with("@") { return value }

  let key = value.slice(1)
  let fallback = fallback-colors.at(local-key(key), default: value)
  if ctx != none { return ctx.theme.at(local-key(key), default: fallback) }
  if theme != none { return theme.at(prelude-key(local-key(key)), default: fallback) }

  fallback
}
#let html-color(value, ctx: none, theme: none) = {
  let resolved = theme-color(value, ctx: ctx, theme: theme)
  if type(resolved) == color { resolved.to-hex() } else { resolved }
}
#let typst-color(value, ctx: none, theme: none) = {
  let resolved = theme-color(value, ctx: ctx, theme: theme)
  if type(resolved) == color { resolved } else { rgb(resolved) }
}
#let node-center(node) = (
  x: node.at("x", default: 0) + node.at("width", default: 120) / 2,
  y: node.at("y", default: 0) + node.at("height", default: 48) / 2,
)

// Stop a line on the node outline instead of at its center. The arrow then
// sits on the border, where it is readable, rather than under the label.
#let edge-anchor(node, toward) = {
  let center = node-center(node)
  let half-w = calc.max(node.at("width", default: 120) / 2, 1)
  let half-h = calc.max(node.at("height", default: 48) / 2, 1)
  let dx = toward.x - center.x
  let dy = toward.y - center.y
  if dx == 0 and dy == 0 { return center }

  let shape = node.at("shape", default: "round")
  let scale = if shape == "circle" {
    1 / calc.sqrt((dx / half-w) * (dx / half-w) + (dy / half-h) * (dy / half-h))
  } else if shape == "diamond" {
    1 / (calc.abs(dx) / half-w + calc.abs(dy) / half-h)
  } else if dx == 0 {
    half-h / calc.abs(dy)
  } else if dy == 0 {
    half-w / calc.abs(dx)
  } else {
    calc.min(half-w / calc.abs(dx), half-h / calc.abs(dy))
  }

  (x: center.x + dx * scale, y: center.y + dy * scale)
}

#let next-order(all) = {
  let highest = 0
  for item in all {
    highest = calc.max(highest, item.at("order", default: 0))
  }
  highest + 1
}

#let history-entry(undo, redo) = (undo: undo, redo: redo)
#let push-history(view, undo, redo) = {
  let next = view.at("undo", default: ()) + (history-entry(undo, redo),)
  (
    undo: if next.len() > history-limit { next.slice(1) } else { next },
    redo: (),
  )
}

#let undo-step(view) = {
  let undo = view.at("undo", default: ())
  if undo.len() == 0 { (:) } else {
    let entry = undo.last()
    ops-both(
      entry.undo,
      (
        undo: undo.slice(0, undo.len() - 1),
        redo: view.at("redo", default: ()) + (entry,),
      ),
    )
  }
}

#let redo-step(view) = {
  let redo = view.at("redo", default: ())
  if redo.len() == 0 { (:) } else {
    let entry = redo.last()
    ops-both(
      entry.redo,
      (
        undo: view.at("undo", default: ()) + (entry,),
        redo: redo.slice(0, redo.len() - 1),
      ),
    )
  }
}

#let edge-endpoints(all, edge) = {
  let from = find-node(all, edge.at("from", default: ""))
  let to = find-node(all, edge.at("to", default: ""))
  if from == none or to == none { none } else { (from: from, to: to) }
}

#let arrow-head(from, to, color) = {
  let fx = from.x
  let fy = from.y
  let tx = to.x
  let ty = to.y
  let angle = calc.atan2(tx - fx, ty - fy)
  let size = 8.0
  let left = (
    x: tx - size * calc.cos(angle - 0.5rad),
    y: ty - size * calc.sin(angle - 0.5rad),
  )
  let right = (
    x: tx - size * calc.cos(angle + 0.5rad),
    y: ty - size * calc.sin(angle + 0.5rad),
  )
  (points: str(tx) + "," + str(ty) + " " + str(left.x) + "," + str(left.y) + " " + str(right.x) + "," + str(right.y), color: color)
}

#let edge-svg(state, ctx) = {
  let all = nodes(state)
  let parts = ()
  for edge in ordered-edges(state) {
    let ends = edge-endpoints(all, edge)
    if ends != none {
      let from-center = node-center(ends.from)
      let to-center = node-center(ends.to)
      let bend = edge.at("bend", default: 0)
      let mx = (from-center.x + to-center.x) / 2
      let my = (from-center.y + to-center.y) / 2 - bend * 3
      let control = (x: mx, y: my)
      let start = edge-anchor(ends.from, if bend != 0 { control } else { to-center })
      let end = edge-anchor(ends.to, if bend != 0 { control } else { from-center })
      let color = html-color(edge.at("color", default: "@text"), ctx: ctx)

      if bend != 0 {
        parts.push(html.elem("path", attrs: (
          d: "M " + str(start.x) + " " + str(start.y) + " Q " + str(control.x) +
            " " + str(control.y) + " " + str(end.x) + " " + str(end.y),
          fill: "none",
          stroke: color,
          "stroke-width": "1.8",
        )))
      } else {
        parts.push(html.elem("line", attrs: (
          x1: str(start.x),
          y1: str(start.y),
          x2: str(end.x),
          y2: str(end.y),
          stroke: color,
          "stroke-width": "1.8",
        )))
      }

      let arrow = edge.at("arrow", default: "forward")
      let tip-source = if bend != 0 { control } else { start }
      let tail-source = if bend != 0 { control } else { end }
      if arrow == "forward" or arrow == "both" {
        let head = arrow-head(tip-source, end, color)
        parts.push(html.elem("polygon", attrs: (
          points: head.points,
          fill: head.color,
        )))
      }
      if arrow == "back" or arrow == "both" {
        let head = arrow-head(tail-source, start, color)
        parts.push(html.elem("polygon", attrs: (
          points: head.points,
          fill: head.color,
        )))
      }
    }
  }
  html.elem(
    "svg",
    attrs: (
      class: "dg-edges",
      viewBox: "0 0 " + str(board-width) + " " + str(board-height),
      "aria-hidden": "true",
    ),
    [
      #for part in parts [
        #part
      ]
    ],
  )
}

#let edge-labels(state) = {
  let all = nodes(state)
  let labels = ()
  for edge in ordered-edges(state) {
    if edge.at("label", default: "") != "" {
      let ends = edge-endpoints(all, edge)
      if ends != none {
        let from = node-center(ends.from)
        let to = node-center(ends.to)
        let mx = (from.x + to.x) / 2
        let my = (from.y + to.y) / 2 - edge.at("bend", default: 0) * 1.5
        labels.push(html.elem("span", attrs: (
          class: "dg-edge-label",
          style: "left:" + str(mx) + "px;top:" + str(my) + "px;",
        ), edge.at("label")))
      }
    }
  }
  if labels.len() == 0 { none } else {
    for label in labels [ #label ]
  }
}

#let node-card(ctx, node, selected, connect-from) = {
  let classes = "dg-node"
  if selected == node.id { classes += " dg-node--selected" }
  if connect-from == node.id { classes += " dg-node--connect" }
  let fill = html-color(node.at("fill", default: "@surface2"), ctx: ctx)
  let stroke = html-color(node.at("stroke", default: "@borderStrong"), ctx: ctx)
  let text-color = html-color(node.at("textColor", default: "@text"), ctx: ctx)

  movable(
    "node.move",
    x: node.at("x", default: 0),
    y: node.at("y", default: 0),
    args: (id: node.id),
    attrs: action-attrs("node.select", args: (id: node.id)),
    body: [
      #html.elem(
        "div",
        attrs: (
          class: classes,
          style: "width:" + str(node.at("width", default: 120)) + "px;height:" +
            str(node.at("height", default: 48)) + "px;background:" + fill + ";color:" +
            text-color + ";border-color:" + stroke + ";",
        ) + action-attrs("node.select", args: (id: node.id)),
        [
          #html.elem(
            "span",
            attrs: (class: "dg-node-handle", title: "Drag node", "aria-hidden": "true"),
            [#icon("drag_indicator", size: "16px")],
          )
          #html.elem("span", attrs: (class: "dg-node-label"), node.at("label", default: "Node"))
        ],
      )
    ],
  )
}

#let edge-list(ctx, state) = {
  let all = nodes(state)
  let rows = ()
  for edge in ordered-edges(state) {
    let ends = edge-endpoints(all, edge)
    if ends != none {
      rows.push(html.elem("div", attrs: (class: "dg-edge-row"), [
        #html.elem("span", attrs: (class: "dg-edge-row__label"), [
          #ends.from.at("label", default: "Node") + " → " + ends.to.at("label", default: "Node")
        ])
        #button(
          if edge.at("label", default: "") == "" { "label" } else { edge.at("label") },
          action: "edge.select",
          args: (id: edge.id),
          kind: "ghost",
        )
        #button("×", action: "edge.remove", args: (id: edge.id), kind: "ghost")
      ]))
    }
  }
  if rows.len() == 0 {
    muted(body: "No edges.")
  } else {
    stack(
      body: [
        #for row in rows [
          #row
        ]
      ],
      gap: "0",
    )
  }
}

#let node-inspector(ctx, state, selected) = {
  let node = find-node(nodes(state), selected)
  if node == none {
    muted(body: "Click a node to inspect it. Drag the grip to move it.")
  } else {
    form(body: [
      #field("Label", "label", value: node.at("label", default: ""))
      #select(
        "shape",
        (
          ("rect", "Rectangle"),
          ("round", "Rounded"),
          ("circle", "Circle"),
          ("diamond", "Diamond"),
        ),
        value: node.at("shape", default: "round"),
      )
      #row(body: [
        #field("Fill", "fill", value: node.at("fill", default: "@surface2"))
        #field("Stroke", "stroke", value: node.at("stroke", default: "@borderStrong"))
      ])
      #field("Text", "textColor", value: node.at("textColor", default: "@text"))
      #row(body: [
        #field("Width", "width", value: str(node.at("width", default: 120)))
        #field("Height", "height", value: str(node.at("height", default: 48)))
      ])
      #muted(body: "Colors accept @theme tokens such as @accent or @surface2, or a hex value.")
      #toolbar(body: [
        #button("Apply node", action: "node.update", kind: "primary")
        #button("Use theme colors", action: "node.theme", kind: "ghost")
        #button("Delete node", action: "node.remove", args: (id: node.id), kind: "danger")
      ])
    ])
  }
}

#let edge-inspector(ctx, state, selected) = {
  let edge = edges(state).find(item => item.id == selected)
  if edge == none {
    muted(body: "Select an edge from the list.")
  } else {
    form(body: [
      #field("Label", "label", value: edge.at("label", default: ""))
      #field("Color", "color", value: edge.at("color", default: "@text"))
      #select(
        "arrow",
        (
          ("forward", "Forward"),
          ("back", "Back"),
          ("both", "Both"),
          ("none", "None"),
        ),
        value: edge.at("arrow", default: "forward"),
      )
      #field("Bend (degrees)", "bend", value: str(edge.at("bend", default: 0)))
      #toolbar(body: [
        #button("Apply edge", action: "edge.update", kind: "primary")
        #button("Use theme color", action: "edge.theme", kind: "ghost")
        #button("Delete edge", action: "edge.remove", args: (id: edge.id), kind: "danger")
      ])
    ])
  }
}

#let fletcher-arrow(value) = if value == "none" {
  ""
} else if value == "back" {
  "<|-"
} else if value == "both" {
  "<|-|>"
} else {
  "-|>"
}

#let fletcher-shape(value) = if value == "circle" {
  fletcher.shapes.circle
} else if value == "diamond" {
  fletcher.shapes.diamond
} else {
  fletcher.shapes.rect
}

#let fletcher-diagram(state, theme: none) = {
  let all = nodes(state)
  let parts = ()
  for node in ordered-nodes(state) {
    let center = node-center(node)
    parts.push(fletcher.node(
      (center.x / unit, center.y / unit),
      [#node.at("label", default: "Node")],
      fill: typst-color(node.at("fill", default: "@surface2"), theme: theme),
      stroke: typst-color(node.at("stroke", default: "@borderStrong"), theme: theme),
      shape: fletcher-shape(node.at("shape", default: "round")),
      corner-radius: if node.at("shape", default: "round") == "round" { 4pt } else { 0pt },
    ))
  }
  for edge in ordered-edges(state) {
    let ends = edge-endpoints(all, edge)
    if ends != none {
      let from = node-center(ends.from)
      let to = node-center(ends.to)
      let bend = edge.at("bend", default: 0)
      parts.push(fletcher.edge(
        (from.x / unit, from.y / unit),
        (to.x / unit, to.y / unit),
        fletcher-arrow(edge.at("arrow", default: "forward")),
        [#edge.at("label", default: "")],
        stroke: typst-color(edge.at("color", default: "@text"), theme: theme),
        ..(if bend != 0 { (bend: bend * 1deg) } else { (:) }),
      ))
    }
  }
  fletcher.diagram(..parts)
}

#let html-node-shape(node, center, theme: none) = {
  let w = node.at("width", default: 120)
  let h = node.at("height", default: 48)
  let fill = html-color(node.at("fill", default: "@surface2"), theme: theme)
  let stroke = html-color(node.at("stroke", default: "@borderStrong"), theme: theme)
  let shape = node.at("shape", default: "round")
  if shape == "circle" {
    html.elem("ellipse", attrs: (
      cx: str(center.x), cy: str(center.y), rx: str(w / 2), ry: str(h / 2),
      fill: fill, stroke: stroke, "stroke-width": "1.5",
    ))
  } else if shape == "diamond" {
    html.elem("polygon", attrs: (
      points: str(center.x) + "," + str(center.y - h / 2) + " " +
        str(center.x + w / 2) + "," + str(center.y) + " " +
        str(center.x) + "," + str(center.y + h / 2) + " " +
        str(center.x - w / 2) + "," + str(center.y),
      fill: fill, stroke: stroke, "stroke-width": "1.5",
    ))
  } else {
    html.elem("rect", attrs: (
      x: str(center.x - w / 2), y: str(center.y - h / 2),
      width: str(w), height: str(h),
      rx: if shape == "round" { "6" } else { "0" },
      fill: fill, stroke: stroke, "stroke-width": "1.5",
    ))
  }
}

#let html-diagram(state, theme: none) = {
  let all = nodes(state)
  let parts = ()
  for edge in ordered-edges(state) {
    let ends = edge-endpoints(all, edge)
    if ends != none {
      let from-center = node-center(ends.from)
      let to-center = node-center(ends.to)
      let color = html-color(edge.at("color", default: "@text"), theme: theme)
      let bend = edge.at("bend", default: 0)
      let mid-x = (from-center.x + to-center.x) / 2
      let mid-y = (from-center.y + to-center.y) / 2 - bend * 3
      let control = (x: mid-x, y: mid-y)
      let start = edge-anchor(ends.from, if bend != 0 { control } else { to-center })
      let end = edge-anchor(ends.to, if bend != 0 { control } else { from-center })
      if bend != 0 {
        parts.push(html.elem("path", attrs: (
          d: "M " + str(start.x) + " " + str(start.y) + " Q " + str(mid-x) +
            " " + str(mid-y) + " " + str(end.x) + " " + str(end.y),
          fill: "none", stroke: color, "stroke-width": "1.5",
        )))
      } else {
        parts.push(html.elem("line", attrs: (
          x1: str(start.x), y1: str(start.y), x2: str(end.x), y2: str(end.y),
          stroke: color, "stroke-width": "1.5",
        )))
      }
      let arrow = edge.at("arrow", default: "forward")
      if arrow == "forward" or arrow == "both" {
        let head = arrow-head(if bend != 0 { control } else { start }, end, color)
        parts.push(html.elem("polygon", attrs: (points: head.points, fill: head.color)))
      }
      if arrow == "back" or arrow == "both" {
        let head = arrow-head(if bend != 0 { control } else { end }, start, color)
        parts.push(html.elem("polygon", attrs: (points: head.points, fill: head.color)))
      }
      if edge.at("label", default: "") != "" {
        parts.push(html.elem("text", attrs: (
          x: str(mid-x), y: str(mid-y - 6),
          "text-anchor": "middle", fill: color,
          "font-family": "sans-serif", "font-size": "11",
        ), edge.at("label")))
      }
    }
  }
  for node in ordered-nodes(state) {
    let center = node-center(node)
    parts.push(html-node-shape(node, center, theme: theme))
    parts.push(html.elem("text", attrs: (
      x: str(center.x), y: str(center.y),
      "text-anchor": "middle", "dominant-baseline": "middle",
      fill: html-color(node.at("textColor", default: "@text"), theme: theme),
      "font-family": "sans-serif", "font-size": "13",
    ), node.at("label", default: "Node")))
  }
  html.elem(
    "svg",
    attrs: (
      viewBox: "0 0 " + str(board-width) + " " + str(board-height),
      width: "100%",
      height: "auto",
      style: "max-width:100%;display:block",
    ),
    [
      #for part in parts [
        #part
      ]
    ],
  )
}

#let fletcher-source(state, ctx: none, theme: none) = {
  let lines = (
    "#import \"@preview/fletcher:0.5.8\" as fletcher",
    "#fletcher.diagram(",
    "  // node positions map from the editor grid",
  )
  let all = nodes(state)
  for node in ordered-nodes(state) {
    let center = node-center(node)
    let shape = if node.at("shape", default: "round") == "circle" {
      "fletcher.shapes.circle"
    } else if node.at("shape", default: "round") == "diamond" {
      "fletcher.shapes.diamond"
    } else {
      "fletcher.shapes.rect"
    }
    lines.push(
      "  fletcher.node((" + str(center.x / unit) + ", " + str(center.y / unit) + "), [" +
        node.at("label", default: "Node") + "], fill: rgb(" +
        repr(html-color(node.at("fill", default: "@surface2"), ctx: ctx, theme: theme)) + "), stroke: rgb(" +
        repr(html-color(node.at("stroke", default: "@borderStrong"), ctx: ctx, theme: theme)) + "), shape: " + shape +
        (if node.at("shape", default: "round") == "round" { ", corner-radius: 4pt" } else { "" }) + "),",
    )
  }
  for edge in ordered-edges(state) {
    let ends = edge-endpoints(all, edge)
    if ends != none {
      let from = node-center(ends.from)
      let to = node-center(ends.to)
      let bend = edge.at("bend", default: 0)
      lines.push(
        "  fletcher.edge((" + str(from.x / unit) + ", " + str(from.y / unit) + "), (" +
          str(to.x / unit) + ", " + str(to.y / unit) + "), " +
          repr(fletcher-arrow(edge.at("arrow", default: "forward"))) + ", [" +
          edge.at("label", default: "") + "], stroke: rgb(" +
          repr(html-color(edge.at("color", default: "@text"), ctx: ctx, theme: theme)) + ")" +
          (if bend != 0 { ", bend: " + str(bend) + "deg" } else { "" }) + "),",
      )
    }
  }
  lines.push(")")
  lines.join("\n")
}

#let step(state, view, action, ctx) = {
  let name = action.name
  let all-nodes = nodes(state)
  let all-edges = edges(state)

  if name == "node.add" {
    let node = (
      id: action.id,
      x: action.args.at("x", default: 48 + calc.rem(all-nodes.len(), 3) * 170),
      y: action.args.at("y", default: 44 + calc.div-euclid(all-nodes.len(), 3) * 110),
      label: action.args.at("label", default: "Node " + str(all-nodes.len() + 1)),
      shape: "round",
      fill: "@surface2",
      stroke: "@borderStrong",
      textColor: "@text",
      width: 120,
      height: 48,
      order: next-order(all-nodes),
    )
    ops-both(
      (op-append("nodes", node),),
      push-history(view, (op-remove("nodes", node.id),), (op-append("nodes", node),))
        + (selected: node.id, selectedEdge: none, connectFrom: none),
    )
  } else if name == "node.move" {
    let id = action.args.at("id", default: "")
    let node = find-node(all-nodes, id)
    if node != none {
      let patch = (x: action.args.at("x", default: node.x), y: action.args.at("y", default: node.y))
      ops-both(
        (op-merge("nodes", id, patch),),
        push-history(
          view,
          (op-merge("nodes", id, (x: node.at("x", default: 0), y: node.at("y", default: 0))),),
          (op-merge("nodes", id, patch),),
        ),
      )
    }
  } else if name == "node.select" {
    let id = action.args.at("id", default: "")
    if view.at("connect", default: false) {
      let from = view.at("connectFrom", default: none)
      if from == none {
        ops-view((connectFrom: id, selected: id, selectedEdge: none))
      } else if from == id {
        ops-view((connectFrom: none))
      } else {
        let edge = (
          id: action.id,
          from: from,
          to: id,
          label: "",
          arrow: "forward",
          color: "@text",
          bend: 0,
          order: next-order(all-edges),
        )
        ops-both(
          (op-append("edges", edge),),
          push-history(view, (op-remove("edges", edge.id),), (op-append("edges", edge),))
            + (connectFrom: none, selected: id, selectedEdge: none),
        )
      }
    } else {
      ops-view((selected: id, selectedEdge: none))
    }
  } else if name == "node.update" {
    let id = view.at("selected", default: "")
    let node = find-node(all-nodes, id)
    if node != none {
      let patch = (
        label: action.fields.at("label", default: node.at("label", default: "Node")),
        shape: action.fields.at("shape", default: node.at("shape", default: "round")),
        fill: action.fields.at("fill", default: node.at("fill", default: "@surface2")),
        stroke: action.fields.at("stroke", default: node.at("stroke", default: "@borderStrong")),
        textColor: action.fields.at("textColor", default: node.at("textColor", default: "@text")),
        width: int(action.fields.at("width", default: str(node.at("width", default: 120)))),
        height: int(action.fields.at("height", default: str(node.at("height", default: 48)))),
      )
      ops-both(
        (op-merge("nodes", id, patch),),
        push-history(view, (op-merge("nodes", id, node),), (op-merge("nodes", id, patch),)),
      )
    }
  } else if name == "node.theme" {
    let id = view.at("selected", default: "")
    let node = find-node(all-nodes, id)
    if node != none {
      let patch = (fill: "@surface2", stroke: "@borderStrong", textColor: "@text")
      ops-both(
        (op-merge("nodes", id, patch),),
        push-history(view, (op-merge("nodes", id, node),), (op-merge("nodes", id, patch),)),
      )
    }
  } else if name == "edge.theme" {
    let id = view.at("selectedEdge", default: "")
    let edge = all-edges.find(item => item.id == id)
    if edge != none {
      ops-both(
        (op-merge("edges", id, (color: "@text")),),
        push-history(view, (op-merge("edges", id, edge),), (op-merge("edges", id, (color: "@text")),)),
      )
    }
  } else if name == "node.remove" {
    let id = action.args.at("id", default: view.at("selected", default: ""))
    let node = find-node(all-nodes, id)
    if node != none {
      let attached = all-edges.filter(edge => edge.from == id or edge.to == id)
      let undo = (op-append("nodes", node),) + attached.map(edge => op-append("edges", edge))
      let redo = (op-remove("nodes", id),) + attached.map(edge => op-remove("edges", edge.id))
      ops-both(
        redo,
        push-history(view, undo, redo) + (selected: none, selectedEdge: none, connectFrom: none),
      )
    }
  } else if name == "edge.select" {
    ops-view((selectedEdge: action.args.at("id", default: ""), selected: none, connectFrom: none))
  } else if name == "edge.update" {
    let id = view.at("selectedEdge", default: "")
    let edge = all-edges.find(item => item.id == id)
    if edge != none {
      let bend = action.fields.at("bend", default: str(edge.at("bend", default: 0)))
      let patch = (
        label: action.fields.at("label", default: edge.at("label", default: "")),
        color: action.fields.at("color", default: edge.at("color", default: "@text")),
        arrow: action.fields.at("arrow", default: edge.at("arrow", default: "forward")),
        bend: int(bend),
      )
      ops-both(
        (op-merge("edges", id, patch),),
        push-history(view, (op-merge("edges", id, edge),), (op-merge("edges", id, patch),)),
      )
    }
  } else if name == "edge.remove" {
    let id = action.args.at("id", default: "")
    let edge = all-edges.find(item => item.id == id)
    if edge != none {
      ops-both(
        (op-remove("edges", id),),
        push-history(view, (op-append("edges", edge),), (op-remove("edges", id),))
          + (selectedEdge: none),
      )
    }
  } else if name == "tool.connect" {
    ops-view((
      connect: not view.at("connect", default: false),
      connectFrom: none,
    ))
  } else if name == "layout.grid" {
    let old = ordered-nodes(state)
    let patches = old.enumerate().map(((index, node)) => (id: node.id, x: 48 + calc.rem(index, 3) * 190, y: 44 + calc.div-euclid(index, 3) * 110))
    if patches.len() > 0 {
      ops-both(
        patches.map(patch => op-merge("nodes", patch.id, (x: patch.x, y: patch.y))),
        push-history(
          view,
          old.map(node => op-merge("nodes", node.id, (x: node.at("x", default: 0), y: node.at("y", default: 0)))),
          patches.map(patch => op-merge("nodes", patch.id, (x: patch.x, y: patch.y))),
        ),
      )
    }
  } else if name == "layout.radial" {
    let old = ordered-nodes(state)
    let count = old.len()
    let patches = if count == 0 { () } else {
      old.enumerate().map(((index, node)) => (
        id: node.id,
        x: 360 + 240 * calc.cos(index * 360deg / count),
        y: 260 + 180 * calc.sin(index * 360deg / count),
      ))
    }
    if patches.len() > 0 {
      ops-both(
        patches.map(patch => op-merge("nodes", patch.id, (x: patch.x, y: patch.y))),
        push-history(
          view,
          old.map(node => op-merge("nodes", node.id, (x: node.at("x", default: 0), y: node.at("y", default: 0)))),
          patches.map(patch => op-merge("nodes", patch.id, (x: patch.x, y: patch.y))),
        ),
      )
    }
  } else if name == "theme.apply" {
    let node-ops = all-nodes.map(node => op-merge(
      "nodes",
      node.id,
      (fill: "@surface2", stroke: "@borderStrong", textColor: "@text"),
    ))
    let edge-ops = all-edges.map(edge => op-merge("edges", edge.id, (color: "@text")))
    let undo = all-nodes.map(node => op-merge(
      "nodes",
      node.id,
      (fill: node.at("fill", default: "@surface2"), stroke: node.at("stroke", default: "@borderStrong"), textColor: node.at("textColor", default: "@text")),
    )) + all-edges.map(edge => op-merge("edges", edge.id, (color: edge.at("color", default: "@text"))))
    let redo = node-ops + edge-ops
    if redo.len() > 0 {
      ops-both(redo, push-history(view, undo, redo))
    }
  } else if name == "history.undo" {
    undo-step(view)
  } else if name == "history.redo" {
    redo-step(view)
  } else {
    (:)
  }
}

#let insert-snippet(ctx) = {
  let path = "/typbase/plugin/" + ctx.plugin.slug + "/main.typ"
  "#import \"" + path + "\" as diagrams\n#diagrams.embed(\"" + ctx.instance.id + "\", theme: theme)"
}

#let editor(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { (:) }
  let view = ctx.view
  let all-nodes = ordered-nodes(ctx.state)
  let all-edges = ordered-edges(ctx.state)
  let selected = view.at("selected", default: none)
  let selected-edge = view.at("selectedEdge", default: none)
  let connect = view.at("connect", default: false)
  let connect-from = view.at("connectFrom", default: none)
  let undo-count = view.at("undo", default: ()).len()
  let redo-count = view.at("redo", default: ()).len()

  surface(
    [
      #panel(title: "Diagram", body: [
        #toolbar(body: [
          #button("Add node", action: "node.add", kind: "primary")
          #button("Connect", action: "tool.connect", kind: "ghost", selected: connect)
          #button("Grid", action: "layout.grid", kind: "ghost")
          #button("Radial", action: "layout.radial", kind: "ghost")
          #button("Theme colors", action: "theme.apply", kind: "ghost")
          #button("Undo", action: "history.undo", kind: "ghost", disabled: undo-count == 0)
          #button("Redo", action: "history.redo", kind: "ghost", disabled: redo-count == 0)
          #if ctx.surface.kind != "window" [
            #button("Window", action: "app.window-open", kind: "ghost")
          ]
        ])
        #html.elem("div", attrs: (class: "dg-hint"), [
          #muted(body: if connect {
            if connect-from == none { "Click a node to start an edge." } else { "Click the target node to connect." }
          } else {
            "Select a node or drag its grip."
          })
        ])
        #html.elem(
          "div",
          attrs: (class: "dg-board-scroll"),
          [
            #html.elem(
              "div",
              attrs: (
                class: "dg-board",
                "data-tb-board": "diagram",
                style: "height:" + str(board-height) + "px;",
              ),
              [
                #edge-svg(ctx.state, ctx)
                #edge-labels(ctx.state)
                #for node in all-nodes [
                  #node-card(ctx, node, selected, connect-from)
                ]
              ],
            )
          ],
        )
        #muted(body: str(all-nodes.len()) + " nodes · " + str(all-edges.len()) + " edges")
        #html.elem("span", attrs: (class: "dg-mobile-hint"), "Scroll sideways to reach the full canvas.")
      ])

      #html.elem(
        "div",
        attrs: (class: "dg-inspectors"),
        [
          #panel(title: "Node", body: node-inspector(ctx, ctx.state, selected))
          #panel(title: "Edge", body: edge-inspector(ctx, ctx.state, selected-edge))
        ],
      )

      #panel(title: "Edges", body: edge-list(ctx, ctx.state))

      #panel(title: "Embed", body: [
        #if ctx.page == none [
          #muted(body: "Open a note first, then insert the diagram.")
        ] else [
          #button(
            "Insert in the open note",
            action: "app.page-append",
            args: (pageId: ctx.page.id, text: "\n" + insert-snippet(ctx) + "\n"),
            kind: "primary",
          )
        ]
        #stack(body: [
          #muted(body: "Fletcher source")
          #html.elem("div", attrs: (class: "dg-source"), [
            #raw(lang: "typst", fletcher-source(ctx.state, ctx: ctx))
          ])
        ], gap: "0.35rem")
      ])
    ],
    ..patch,
  )
}

#let pane(ctx) = editor(ctx)
#let window(ctx) = editor(ctx)

// Paged output uses Fletcher. HTML output uses an inline SVG because the
// Typst HTML renderer drops layout-heavy CeTZ/Fletcher output.
#let embed(instance-id, theme: none) = {
  let data = typbase.query("plugin-data", filter: instance-id)
  if data == none { return text(fill: luma(140))[Missing diagram] }
  let state = data
  if nodes(state).len() == 0 { return text(fill: luma(140))[Empty diagram] }
  let target = sys.inputs.at("target", default: "paged")
  let body = if target == "html" {
    html-diagram(state, theme: theme)
  } else {
    fletcher-diagram(state, theme: theme)
  }
  link("typbase://plugin/" + instance-id)[#body]
}
