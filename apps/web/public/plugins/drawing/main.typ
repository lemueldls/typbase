// Drawing plugin. Strokes are records in the plugin doc; `embed` renders
// them as vector curves inside a note, wrapped in a `typbase://plugin/<id>`
// link so clicking the drawing opens this window.
//
// The window surface owns the canvas. Colors come from `ctx.theme`, so the
// swatches follow the workspace palette.

#import "/typbase/lib.typ" as typbase
#import "/typbase/ui.typ": *


#let strokes(state) = state.at("strokes", default: ())
#let colors(ctx) = (
  (name: "Ink", color: ctx.theme.text),
  (name: "Red", color: ctx.theme.red),
  (name: "Yellow", color: ctx.theme.yellow),
  (name: "Green", color: ctx.theme.green),
  (name: "Blue", color: ctx.theme.blue),
  (name: "Violet", color: ctx.theme.violet),
)

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
  if data == none { return text(fill: luma(140))[Missing drawing] }

  let all = data.at("strokes", default: ())
  if all.len() == 0 {
    return box(width: 100%, inset: 8pt, stroke: 0.5pt, radius: 4pt)[
      #text(fill: luma(140))[Empty drawing]
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
          #let segs = (
            stroke
              .points
              .enumerate()
              .map(((index, point)) => {
                let px = ((point.at(0) - bounds.at(0)) * scale) * 1pt
                let py = ((point.at(1) - bounds.at(1)) * scale) * 1pt
                if index == 0 { curve.move((px, py)) } else { curve.line((px, py)) }
              })
          )
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
    if stroke == none { (:) } else {
      ops-state((
        op-append("strokes", (
          id: action.id,
          color: stroke.at("color", default: ctx.theme.text),
          width: stroke.at("width", default: 3),
          points: stroke.at("points", default: ()),
        )),
      ))
    }
  } else if name == "stroke.clear" {
    let ops = ()
    for stroke in strokes(state) { ops.push(op-remove("strokes", stroke.id)) }
    ops-state(ops)
  } else if name == "draw.color" {
    ops-view((color: action.args.color))
  } else if name == "draw.width" {
    ops-view((width: action.args.width))
  } else {
    (:) 
  }
}

#let insert-snippet(ctx) = {
  "#import \"/typbase/plugin/local-drawing/main.typ\": embed\n#embed(\"" + ctx.instance.id + "\")"
}

#let window(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { (:) }
  let view = ctx.view
  let color = view.at("color", default: ctx.theme.text)
  let width = view.at("width", default: 3)
  let all = strokes(ctx.state)

  surface(
    [
      #panel(title: "Brush", body: [
        #toolbar(body: [
          #for entry in colors(ctx) [
            #swatch(
              entry.color,
              action: "draw.color",
              args: (color: entry.color),
              selected: color == entry.color,
              label: entry.name,
            )
          ]
          #button("Thin", action: "draw.width", args: (width: 2), kind: "ghost", selected: width == 2)
          #button("Thick", action: "draw.width", args: (width: 6), kind: "ghost", selected: width == 6)
          #button("Clear", action: "stroke.clear", kind: "danger")
        ])
        #canvas(
          "stroke.add",
          strokes: all.map(stroke => (
            color: stroke.color,
            width: stroke.width,
            points: stroke.points,
          )),
          color: color,
          width: width,
          height: 380,
        )
        #muted(body: str(all.len()) + " strokes, synced with the workspace")
      ])

      #panel(title: "Insert in a note", body: [
        #if ctx.page == none [
          #muted(body: "Open a note first, then insert the drawing.")
        ] else [
          #button(
            "Insert in the open note",
            actions: (
              (
                name: "app.page-append",
                args: (
                  pageId: ctx.page.id,
                  text: "\n" + insert-snippet(ctx) + "\n",
                ),
              ),
              (name: "app.window-close"),
            ),
            kind: "primary",
          )
        ]
        #muted(body: "Or paste this in any note:")
        #raw(lang: "typst", insert-snippet(ctx))
      ])
    ],
    ..patch,
  )
}
