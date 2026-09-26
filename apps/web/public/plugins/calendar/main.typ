// Calendar plugin. Events come from two places: the plugin's own `events`
// collection (structured, typed) and daily notes, where lines shaped like
// `- 10:00 Dentist` become events. Daily notes are read through the normal
// `#typbase.query` channel and written through `app.page-append`.
//
// The widget and the pane are two surfaces of one instance, so both read the
// same event list.

#import "/typbase/lib.typ" as typbase
#import "/typbase/ui.typ": *


#let pad(value) = if value < 10 { "0" + str(value) } else { str(value) }

#let iso-date(year, month, day) = str(year) + "-" + pad(month) + "-" + pad(day)

#let days-in-month(year, month) = {
  if month == 2 {
    if calc.rem(year, 4) == 0 and (calc.rem(year, 100) != 0 or calc.rem(year, 400) == 0) {
      29
    } else {
      28
    }
  } else if month == 4 or month == 6 or month == 9 or month == 11 {
    30
  } else {
    31
  }
}

#let shift-month(key, delta) = {
  let year = int(key.slice(0, 4))
  let month = int(key.slice(5, 7))
  let total = year * 12 + month - 1 + delta
  let next-year = calc.div-euclid(total, 12)
  let next-month = calc.rem-euclid(total, 12) + 1

  str(next-year) + "-" + pad(next-month)
}

#let month-label(key) = {
  let year = int(key.slice(0, 4))
  let month = int(key.slice(5, 7))

  datetime(year: year, month: month, day: 1).display("[month repr:long] [year]")
}

#let current-month(view, ctx) = {
  let key = view.at("month", default: "")
  if key == "" { ctx.today.slice(0, 7) } else { key }
}


// `daily/2026-09-14.typ` -> `2026-09-14`.
#let date-of(page) = page.path.slice(6, 16)

#let is-digit(ch) = "0123456789".contains(ch)

// A note line becomes an event when it starts with a list marker; an
// `HH:MM` prefix is kept as the time.
#let parse-note-line(line) = {
  let trimmed = line.trim()
  if not trimmed.starts-with("- ") { return none }

  let rest = trimmed.slice(2).trim()
  if rest == "" { return none }

  if (
    rest.len() >= 6
      and is-digit(rest.at(0))
      and is-digit(rest.at(1))
      and rest.at(2) == ":"
      and is-digit(rest.at(3))
      and is-digit(rest.at(4))
  ) {
    (time: rest.slice(0, 5), title: rest.slice(5).trim())
  } else {
    (time: "", title: rest)
  }
}

#let note-day(state, month) = {
  let out = ()
  for page in typbase.query("daily", filter: month) {
    let content = typbase.query("content", filter: page.id)
    if content != none {
      for line in content.text.split("\n") {
        let parsed = parse-note-line(line)
        if parsed != none and parsed.title != "" {
          out.push((
            id: "note-" + page.id + "-" + str(out.len()),
            title: parsed.title,
            time: parsed.time,
            date: date-of(page),
            source: "note",
            pageId: page.id,
          ))
        }
      }
    }
  }

  out
}

#let collection-events(state) = state.at("events", default: ())
#let all-events(state, month) = collection-events(state) + note-day(state, month)
#let events-on(state, month, date) = all-events(state, month).filter(event => event.date == date)


#let step(state, view, action, ctx) = {
  let name = action.name

  if name == "calendar.select" {
    ops-view((selected: action.args.date))
  } else if name == "calendar.prev" or name == "calendar.next" {
    let delta = if name == "calendar.prev" { -1 } else { 1 }
    ops-view((month: shift-month(action.args.month, delta)))
  } else if name == "event.create" {
    let title = action.fields.at("title", default: "").trim()
    let date = action.fields.at("date", default: action.args.date)
    if title == "" {
      (:)
    } else {
      ops-both(
        (
          op-append("events", (
            id: action.id,
            title: title,
            date: date,
            time: action.fields.at("time", default: ""),
          )),
        ),
        (selected: date),
      )
    }
  } else if name == "event.remove" {
    ops-state((op-remove("events", action.args.id),))
  } else {
    (:)
  }
}


#let month-grid(state, month-key, year, month, today-iso, selected) = {
  let first-weekday = datetime(year: year, month: month, day: 1).weekday()
  let offset = if first-weekday == none { 0 } else { first-weekday - 1 }
  let total = days-in-month(year, month)

  let cells = ()
  for _ in range(offset) { cells.push(none) }
  for day in range(1, total + 1) { cells.push(day) }
  while calc.rem(cells.len(), 7) != 0 { cells.push(none) }

  grid(
    7,
    body: [
      #for cell in cells [
        #if cell == none [
          #html.elem("div", attrs: (class: "cal-day cal-day--empty"))
        ] else [
          #let iso = iso-date(year, month, cell)
          #let day-events = events-on(state, month-key, iso)
          #let tone = if iso == selected {
            " cal-day--selected"
          } else if iso == today-iso {
            " cal-day--today"
          } else {
            ""
          }
          #html.elem(
            "button",
            attrs: (
              type: "button",
              class: "cal-day" + tone,
              "data-tb-action": "calendar.select",
              "data-tb-args": json.encode((date: iso)),
            ),
            [
              #html.elem("span", attrs: (class: "cal-day__number"), str(cell))
              #for event in day-events.slice(0, calc.min(2, day-events.len())) [
                #html.elem("span", attrs: (class: "cal-event"), event.title)
              ]
              #if day-events.len() > 2 [
                #html.elem(
                  "span",
                  attrs: (class: "cal-day__more"),
                  "+" + str(day-events.len() - 2),
                )
              ]
            ],
          )
        ]
      ]
    ],
  )
}

#let day-panel(state, month, selected) = {
  let day-events = events-on(state, month, selected)
  let content = typbase.query("content", filter: selected)
  let note = if content == none { none } else { content.text.trim() }

  panel(title: selected, body: [
    #if day-events.len() == 0 [
      #empty(body: "No events.")
    ] else [
      #for event in day-events [
        #card(body: [
          #row(
            body: [
              #if event.at("time", default: "") != "" [
                #muted(body: event.at("time", default: ""))
              ]
              #event.title
              #if event.at("source", default: "") == "note" [
                #badge(body: "note")
              ] else [
                #button("×", action: "event.remove", args: (id: event.id), kind: "ghost")
              ]
            ],
            gap: "0.35rem",
          )
        ])
      ]
    ]

    #if note != none and note != "" [
      #muted(body: note.slice(0, calc.min(400, note.len())))
    ]

    #form(body: [
      #row(
        body: [
          #field("Date", "date", value: selected, kind: "date")
          #field("Time", "time", placeholder: "10:00", kind: "time")
          #field("Title", "title", placeholder: "Dentist")
        ],
        gap: "0.4rem",
      )
      #button("Add event", action: "event.create", args: (date: selected), kind: "primary")
    ])

    #form(body: [
      #row(
        body: [
          #field("Daily note line", "text", placeholder: "10:00 Dentist")
          #button("Write to daily note", action: "app.page-append", args: (date: selected), kind: "ghost")
        ],
        gap: "0.4rem",
      )
    ])
  ])
}


#let widget(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { (:) }
  let today-events = events-on(ctx.state, ctx.today.slice(0, 7), ctx.today)

  surface(
    [
      #panel(title: "Today", body: [
        #if today-events.len() == 0 [
          #muted(body: "No events today.")
        ] else [
          #for event in today-events [
            #row(
              body: [
                #if event.at("time", default: "") != "" [
                  #muted(body: event.at("time", default: ""))
                ]
                #event.title
              ],
              gap: "0.35rem",
            )
          ]
        ]
        #button("Open calendar", action: "app.open-plugin", args: (pluginId: "local:calendar"), kind: "ghost")
      ])
    ],
    ..patch,
  )
}

#let pane(ctx) = {
  let patch = if ctx.action != none { step(ctx.state, ctx.view, ctx.action, ctx) } else { (:) }
  let view = ctx.view
  let month = current-month(view, ctx)
  let year = int(month.slice(0, 4))
  let month-number = int(month.slice(5, 7))
  let selected = view.at("selected", default: ctx.today)

  surface(
    [
      #panel(title: month-label(month), body: [
        #toolbar(body: [
          #button("‹", action: "calendar.prev", args: (month: month), kind: "ghost")
          #button("Today", action: "calendar.select", args: (date: ctx.today), kind: "ghost")
          #button("›", action: "calendar.next", args: (month: month), kind: "ghost")
        ])
        #month-grid(ctx.state, month, year, month-number, ctx.today, selected)
      ])

      #day-panel(ctx.state, month, selected)

      #if selected != ctx.today [
        #button("Open daily note", action: "app.create-daily", args: (date: selected), kind: "ghost")
      ]
    ],
    ..patch,
  )
}
