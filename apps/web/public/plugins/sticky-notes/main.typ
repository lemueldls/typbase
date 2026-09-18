// Sticky notes plugin. The overlay surface floats notes above the whole app;
// the main surface is a bigger board with the same records. Positions are
// viewport pixels; the runtime moves the DOM live and sends one patch on drop.

#import "/typbase/ui.typ": *

#let palette = ("#fff3bf", "#d3f9d8", "#d0ebff", "#ffd6e0", "#e5dbff")

// Pastel backgrounds get dark ink, dark ones get white. Components come back
// as ratios, so the threshold is a percentage too.
#let ink-for(background) = {
  let channels = rgb(background).components(alpha: false)
  let brightness = channels.at(0) * 0.2126 + channels.at(1) * 0.7152 + channels.at(2) * 0.0722

  if brightness > 45% { "#1f2328" } else { "#ffffff" }
}

#let notes(state) = state.at("notes", default: ())

#let spawn-position(view) = {
  let spawn = view.at("spawn", default: 0)
  let column = calc.rem(spawn, 3)
  let row-index = calc.div-euclid(spawn, 3)

  (x: 32 + column * 200, y: 96 + row-index * 170)
}

#let step(state, view, action, ctx) = {
  let name = action.name

  if name == "note.create" {
    let text = action.fields.at("text", default: "").trim()
    if text == "" { text = "New note" }
    let spawn = view.at("spawn", default: 0)
    let position = spawn-position(view)

    patch-both(
      (
        op-append("notes", (
          id: action.id,
          text: text,
          x: position.x,
          y: position.y,
          color: palette.at(calc.rem(spawn, palette.len())),
        )),
      ),
      (spawn: spawn + 1),
    )
  } else if name == "note.move" {
    patch-state((
      op-merge("notes", action.args.id, (
        x: action.args.x,
        y: action.args.y,
      )),
    ))
  } else if name == "note.update" {
    patch-state((op-merge("notes", action.args.id, (text: action.fields.at("text", default: ""))),))
  } else if name == "note.remove" {
    patch-state((op-remove("notes", action.args.id),))
  } else if name == "note.hide" {
    patch-view((hidden: true))
  } else if name == "note.show" {
    patch-view((hidden: false))
  } else {
    none
  }
}

#let note-card(note) = html.elem(
  "div",
  attrs: (class: "tb-note", style: "background:" + note.color + ";color:" + ink-for(note.color)),
  [
    #html.elem(
      "textarea",
      attrs: (
        class: "tb-note__text",
        rows: "3",
        "data-tb-field": "text",
        "data-tb-commit": "change",
        "data-tb-action": "note.update",
        "data-tb-args": json.encode((id: note.id)),
      ),
      note.text,
    )
    #button("×", "note.remove", args: (id: note.id), kind: "ghost")
  ],
)

#let sidebar(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { none }
  let state = apply-patch(ctx.state, patch)

  [
    #patch-holder(patch)
    #panel(title: "Sticky Notes", body: [
      #muted(body: str(notes(state).len()) + " notes")
      #button("Open board", "app.open-plugin", args: (pluginId: "local:sticky-notes"), kind: "ghost")
    ])
  ]
}

// Overlay: notes float above whatever page is open. "Hide" keeps the tiny
// controls but gets every note out of the way.
#let overlay(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { none }
  let state = apply-patch(ctx.state, patch)
  let view = apply-view(ctx.view, patch)
  let hidden = view.at("hidden", default: false)

  [
    #patch-holder(patch)
    #overlay-board(body: [
      #floating(x: 16, y: 16, right: true, bottom: true, body: [
        #row(
          body: [
            #button("＋", "note.create", kind: "primary")
            #if hidden [
              #button("Show", "note.show")
            ] else [
              #button("Hide", "note.hide")
            ]
            #button("Board", "app.open-plugin", args: (pluginId: "local:sticky-notes"), kind: "ghost")
          ],
          gap: "0.25rem",
        )
      ])
      #if not hidden [
        #for note in notes(state) [
          #movable("note.move", x: note.x, y: note.y, args: (id: note.id), body: note-card(note))
        ]
      ]
    ])
  ]
}

#let main(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { none }
  let state = apply-patch(ctx.state, patch)

  [
    #patch-holder(patch)
    #panel(title: "Sticky Notes", body: [
      #form(body: [
        #row(
          body: [
            #field("New note", "text", placeholder: "Write something")
            #button("Add", "note.create", kind: "primary")
          ],
          gap: "0.4rem",
        )
      ])

      #board(height: 440, body: [
        #for note in notes(state) [
          #movable("note.move", x: note.x, y: note.y, args: (id: note.id), body: note-card(note))
        ]
      ])
    ])
  ]
}
