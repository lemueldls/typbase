// Drawing plugin. Strokes are records in the plugin doc. `embed` renders
// them as vector curves inside a note, wrapped in a `typbase://plugin/<id>`
// link so clicking the drawing opens this window.
//
// The window surface owns the canvas. Colors come from `ctx.theme`, so the
// swatches follow the workspace palette.
//
// Undo history is device-local view state. Each entry holds the state ops that
// undo and redo it, so replaying an entry is the whole undo implementation.
// A stroke carries a `seq` because collection records come back in map order,
// which is not insertion order.

#import "/typbase/lib.typ" as typbase
#import "/typbase/ui.typ": *

#let history-limit = 50

#let strokes(state) = state.at("strokes", default: ())

// Collection records have no guaranteed order, and two devices can draw at
// the same time. `seq` is the draw order and `id` breaks a tie.
#let ordered(all) = all.sorted(key: stroke => (stroke.at("seq", default: 0), stroke.id))

#let next-seq(all) = {
  let highest = 0
  for stroke in all {
    highest = calc.max(highest, stroke.at("seq", default: 0))
  }
  highest + 1
}

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

// An entry carries both directions. Undo pops it from `undo`, applies `undo`,
// and moves it to `redo`. Redo does the reverse.
#let history-entry(label, undo, redo) = (label: label, undo: undo, redo: redo)

#let push-history(view, entry) = {
  let undo = view.at("undo", default: ()) + (entry,)
  (
    undo: if undo.len() > history-limit { undo.slice(1) } else { undo },
    redo: (),
  )
}

// Removing records is undoable by appending them back with the same ids.
#let removed-entry(label, removed) = history-entry(
  label,
  removed.map(stroke => op-append("strokes", stroke)),
  removed.map(stroke => op-remove("strokes", stroke.id)),
)

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

// Renders the board in a note. The host answers the plugin-data query, so
// the note recompiles whenever the drawing changes.
#let embed(instance-id) = {
  let data = typbase.query("plugin-data", filter: instance-id)
  if data == none { return text(fill: luma(140))[Missing drawing] }

  let all = ordered(data.at("strokes", default: ()))
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
      let points = stroke.at("points", default: ())
      if points.len() == 0 { (:) } else {
        let record = (
          id: action.id,
          seq: next-seq(strokes(state)),
          color: stroke.at("color", default: ctx.theme.text),
          width: stroke.at("width", default: 3),
          points: points,
        )
        ops-both(
          (op-append("strokes", record),),
          push-history(view, history-entry(
            "draw",
            (op-remove("strokes", record.id),),
            (op-append("strokes", record),),
          )),
        )
      }
    }
  } else if name == "stroke.erase" {
    let ids = action.args.at("ids", default: ())
    let removed = strokes(state).filter(stroke => ids.contains(stroke.id))
    if removed.len() == 0 { (:) } else {
      ops-both(
        removed.map(stroke => op-remove("strokes", stroke.id)),
        push-history(view, removed-entry("erase", removed)),
      )
    }
  } else if name == "stroke.clear" {
    let removed = strokes(state)
    if removed.len() == 0 { (:) } else {
      ops-both(
        removed.map(stroke => op-remove("strokes", stroke.id)),
        push-history(view, removed-entry("clear", removed)),
      )
    }
  } else if name == "history.undo" {
    undo-step(view)
  } else if name == "history.redo" {
    redo-step(view)
  } else if name == "draw.tool" {
    ops-view((tool: action.args.at("tool", default: "draw")))
  } else if name == "draw.color" {
    ops-view((color: action.args.color))
  } else if name == "draw.width" {
    ops-view((width: action.args.width))
  } else {
    (:)
  }
}

#let insert-snippet(ctx) = {
  let alias = "drawing"
  let path = "/typbase/plugin/" + ctx.plugin.slug + "/main.typ"
  "#import \"" + path + "\" as " + alias + "\n#" + alias + ".embed(\"" + ctx.instance.id + "\")"
}

#let window(ctx) = {
  let patch = if ctx.action != none {
    step(ctx.state, ctx.view, ctx.action, ctx)
  } else { (:) }
  let view = ctx.view
  let color = view.at("color", default: ctx.theme.text)
  let width = view.at("width", default: 3)
  let tool = view.at("tool", default: "draw")
  let all = ordered(strokes(ctx.state))
  let undo-count = view.at("undo", default: ()).len()
  let redo-count = view.at("redo", default: ()).len()

  surface(
    [
      #panel(title: "Brush", body: [
        #toolbar(body: [
          #button("Undo", action: "history.undo", kind: "ghost", disabled: undo-count == 0)
          #button("Redo", action: "history.redo", kind: "ghost", disabled: redo-count == 0)
          #button("Clear", action: "stroke.clear", kind: "danger", disabled: all.len() == 0)
        ])
        #toolbar(body: [
          #button(
            "Draw",
            action: "draw.tool",
            args: (tool: "draw"),
            kind: "ghost",
            selected: tool == "draw",
          )
          #button(
            "Eraser",
            action: "draw.tool",
            args: (tool: "erase"),
            kind: "ghost",
            selected: tool == "erase",
          )
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
        ])
        #canvas(
          "stroke.add",
          strokes: all.map(stroke => (
            id: stroke.id,
            color: stroke.color,
            width: stroke.width,
            points: stroke.points,
          )),
          color: color,
          width: width,
          height: 380,
          tool: tool,
          erase-action: "stroke.erase",
        )
        #if tool == "erase" [
          #muted(body: "Drag over a stroke to erase it.")
        ]
        #muted(body: str(all.len()) + " strokes · " + str(undo-count) + " undo steps")
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
