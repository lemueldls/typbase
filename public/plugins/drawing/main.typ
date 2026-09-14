// Drawing plugin. Strokes are records in the plugin doc; `embed` renders
// them as vector curves inside a note, wrapped in a `typbase://plugin/<id>`
// link so clicking the drawing opens this plugin's canvas.

#import "/typbase.typ" as typbase
#import "/typbase-ui.typ": *

#let colors = ("#1f2328", "#b42828", "#2f6f4f", "#1e5aa0", "#96660f", "#7a3fa0")

#let strokes(state) = state.at("strokes", default: ())

#let stroke-bounds(stroke) = {
  let xs = stroke.points.map(point => point.at(0))
  let ys = stroke.points.map(point => point.at(1))

  (
    calc.min(..xs),
    calc.min(..ys),
    calc.max(..xs),
    calc.max(..ys),
  )
}

// Renders the board in a note. The host answers the plugin-data query, so
// the note recompiles whenever the drawing changes.
#let embed(instance-id) = {
  let data = typbase.query("plugin-data", filter: instance-id)
  if data == none { return text(fill: rgb("#9aa1aa"))[Missing drawing] }

  let all = data.at("strokes", default: ())
  if all.len() == 0 {
    return box(width: 100%, inset: 8pt, stroke: 0.5pt, radius: 4pt)[
      #text(fill: rgb("#9aa1aa"))[Empty drawing]
    ]
  }

  let xs = ()
  let ys = ()
  for stroke in all {
    for point in stroke.points {
      xs.push(point.at(0))
      ys.push(point.at(1))
    }
  }
  let min-x = calc.min(..xs)
  let max-x = calc.max(..xs)
  let min-y = calc.min(..ys)
  let max-y = calc.max(..ys)
  let scale = 360 / calc.max(max-x - min-x, 1)

  link("typbase://plugin/" + instance-id)[
    #box(
      width: 100%,
      height: ((max-y - min-y) * scale + 10) * 1pt,
      inset: 5pt,
      stroke: 0.5pt,
      radius: 4pt,
      [
        #for stroke in all [
          #let bounds = stroke-bounds(stroke)
          #let segs = stroke.points.enumerate().map(((index, point)) => {
            let px = ((point.at(0) - bounds.at(0)) * scale) * 1pt
            let py = ((point.at(1) - bounds.at(1)) * scale) * 1pt
            if index == 0 { curve.move((px, py)) } else { curve.line((px, py)) }
          })
          #place(
            dx: ((bounds.at(0) - min-x) * scale) * 1pt,
            dy: ((bounds.at(1) - min-y) * scale) * 1pt,
            curve(
              fill: none,
              stroke: (
                paint: rgb(stroke.color),
                thickness: calc.max(stroke.width * scale * 1pt, 0.5pt),
              ),
              ..segs,
            ),
          )
        ]
      ],
    )
  ]
}

#let step(state, view, action, ctx) = {
  let name = action.name

  if name == "stroke.add" {
    let stroke = action.args.at("stroke", default: none)
    if stroke == none { none } else {
      patch-state((op-append("strokes", (
        id: action.id,
        color: stroke.at("color", default: "#1f2328"),
        width: stroke.at("width", default: 3),
        points: stroke.at("points", default: ()),
      )),))
    }
  } else if name == "stroke.clear" {
    let ops = ()
    for stroke in strokes(state) { ops.push(op-remove("strokes", stroke.id)) }
    patch-state(ops)
  } else if name == "draw.color" {
    patch-view((color: action.args.color))
  } else if name == "draw.width" {
    patch-view((width: action.args.width))
  } else {
    none
  }
}

#let main(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { none }
  let state = apply-patch(ctx.state, patch)
  let view = apply-view(ctx.view, patch)
  let color = view.at("color", default: "#1f2328")
  let width = view.at("width", default: 3)
  let all = strokes(state)

  [
    #patch-holder(patch)
    #panel(title: "Drawing", body: [
      #row(body: [
        #for swatch in colors [
          #button("●", "draw.color", args: (color: swatch), kind: (if color == swatch { "primary" } else { "ghost" }))
        ]
        #button("Thin", "draw.width", args: (width: 2), kind: (if width == 2 { "primary" } else { "ghost" }))
        #button("Thick", "draw.width", args: (width: 6), kind: (if width == 6 { "primary" } else { "ghost" }))
        #button("Clear", "stroke.clear", kind: "danger")
      ], gap: "0.25rem")

      #canvas(
        "stroke.add",
        strokes: all.map(stroke => (
          color: stroke.color,
          width: stroke.width,
          points: stroke.points,
        )),
        color: color,
        width: width,
        height: 460,
      )

      #muted(body: str(all.len()) + " strokes, synced with the workspace")
    ])

    #panel(title: "Embed in a note", body: [
      #if ctx.page == none [
        #muted(body: "Open a note first, then insert the drawing.")
      ] else [
        #button("Insert embed in the open note", "app.page-append", args: (
          pageId: ctx.page.id,
          text: "\n#import \"/typbase-plugin/local-drawing/main.typ\": embed\n#embed(\"" + ctx.instance.id + "\")\n",
          separator: "\n",
        ), kind: "primary")
      ]
      #muted(body: "Or paste this in any note:")
      #raw(lang: "typst", "#import \"/typbase-plugin/local-drawing/main.typ\": embed\n#embed(\"" + ctx.instance.id + "\")")
    ])
  ]
}
