// Flashcards plugin. Cards are not stored here: they are read from
// `#typbase.section(kind: "flashcards")` blocks in notes (the shape the AI
// generators emit), and only the review log lives in the plugin doc. Reviews
// are append-only, so two devices grading the same card merge cleanly.

#import "/typbase.typ" as typbase
#import "/typbase-ui.typ": *

// -------------------------------------------------------------- scheduling

#let intervals = (1, 3, 7, 16, 35)

#let to-date(iso) = {
  if iso == none or iso == "" { return none }
  datetime(year: int(iso.slice(0, 4)), month: int(iso.slice(5, 7)), day: int(iso.slice(8, 10)))
}

#let add-days(iso, days) = (to-date(iso) + duration(days: days)).display("[year]-[month]-[day]")

#let card-score(reviews) = {
  let score = 0
  for review in reviews {
    if review.at("grade", default: "good") == "again" { score = 0 } else { score = score + 1 }
  }

  score
}

#let card-due(card, reviews, today) = {
  let own = reviews
    .filter(review => review.at("card", default: "") == card.id)
    .sorted(key: review => review.at("at", default: ""))
  if own.len() == 0 { return today }

  let last = own.at(own.len() - 1)
  if last.at("grade", default: "good") == "again" { return today }

  let index = calc.min(card-score(own), intervals.len() - 1)

  add-days(last.at("at", default: today), intervals.at(index))
}

#let due-ids(cards, reviews, today) = {
  cards.filter(card => card-due(card, reviews, today) <= today).map(card => card.id)
}

// ------------------------------------------------------------------- cards

// One card per `== Title` block with `Q:` and `A:` lines inside a
// `flashcards` section. The id is tied to the section position, so editing a
// note earlier on the page starts those cards' schedules over.
#let parse-section(section) = {
  let cards = ()
  let title = ""
  let front = none

  for line in section.at("text", default: "").split("\n") {
    let trimmed = line.trim()
    if trimmed.starts-with("==") {
      title = trimmed.slice(2).trim()
    } else if trimmed.starts-with("Q:") {
      front = trimmed.slice(2).trim()
    } else if trimmed.starts-with("A:") and front != none {
      cards.push((
        id: section.pageId + ":" + section.id + ":" + str(cards.len()),
        front: front,
        back: trimmed.slice(2).trim(),
        title: title,
        pageId: section.pageId,
      ))
      front = none
    }
  }

  cards
}

#let all-cards() = {
  let cards = ()
  for section in typbase.query("sections") {
    if section.kind == "flashcards" { cards += parse-section(section) }
  }

  cards
}

// ------------------------------------------------------------------ reducer

#let step(state, action, view, cards, ctx) = {
  let reviews = state.at("reviews", default: ())
  let name = action.name

  if name == "card.reveal" {
    patch-view((revealed: action.args.card))
  } else if name == "card.grade" {
    let card-id = action.args.card
    let grade = action.args.grade
    let queue = view.at("queue", default: none)
    let base = if queue == none { due-ids(cards, reviews, ctx.today) } else { queue }
    let rest = base.filter(id => id != card-id)

    patch-both(
      (op-append("reviews", (id: action.id, card: card-id, grade: grade, at: ctx.today)),),
      (queue: if grade == "again" { rest + (card-id,) } else { rest }, revealed: ""),
    )
  } else if name == "card.reset" {
    patch-view((queue: due-ids(cards, reviews, ctx.today), revealed: ""))
  } else {
    none
  }
}

// ---------------------------------------------------------------- surfaces

#let current-card(cards, view, reviews, ctx) = {
  let queue = view.at("queue", default: none)
  let ids = if queue == none { due-ids(cards, reviews, ctx.today) } else { queue }
  if ids.len() == 0 { return none }

  cards.find(card => card.id == ids.at(0))
}

#let sidebar(ctx) = {
  let cards = all-cards()
  let patch = if ctx.action != none { step(ctx.state, ctx.action, ctx.view, cards, ctx) } else { none }
  let state = apply-patch(ctx.state, patch)
  let due = due-ids(cards, state.at("reviews", default: ()), ctx.today)

  [
    #patch-holder(patch)
    #panel(title: "Flashcards", body: [
      #muted(body: if due.len() == 0 { "Nothing due." } else { str(due.len()) + " due" })
      #button("Review", "app.open-plugin", args: (pluginId: "local:flashcards"), kind: "ghost")
    ])
  ]
}

#let main(ctx) = {
  let cards = all-cards()
  let patch = if ctx.action != none { step(ctx.state, ctx.action, ctx.view, cards, ctx) } else { none }
  let state = apply-patch(ctx.state, patch)
  let view = apply-view(ctx.view, patch)
  let reviews = state.at("reviews", default: ())
  let current = current-card(cards, view, reviews, ctx)
  let revealed = current != none and view.at("revealed", default: "") == current.id

  [
    #patch-holder(patch)

    #if cards.len() == 0 [
      #panel(title: "Review", body: [
        #muted(body: "No cards yet. Generate flashcards with the AI menu, or write a section like:")
        #raw(lang: "typst", "#typbase.section(kind: \"flashcards\")[\n  == Question\n  Q: Front\n  A: Back\n]")
      ])
    ] else if current == none [
      #panel(title: "Review", body: [
        #muted(body: "All caught up.")
        #button("Reload queue", "card.reset", kind: "ghost")
      ])
    ] else [
      #panel(title: "Card", body: [
        #card(body: [
          #html.elem("p", attrs: (class: "tb-flash-front"), current.front)
          #if revealed [
            #html.elem("p", attrs: (class: "tb-flash-back"), current.back)
          ]
        ])
        #if revealed [
          #row(body: [
            #button("Again", "card.grade", args: (card: current.id, grade: "again"), kind: "danger")
            #button("Good", "card.grade", args: (card: current.id, grade: "good"), kind: "primary")
          ])
        ] else [
          #button("Show answer", "card.reveal", args: (card: current.id), kind: "primary")
        ]
        #button("Open note", "app.open-page", args: (id: current.pageId), kind: "ghost")
      ])
    ]

    #if cards.len() > 0 [
      #panel(title: "Cards (" + str(cards.len()) + ")", body: [
        #for entry in cards.slice(0, calc.min(20, cards.len())) [
          #row(body: [
            #muted(body: entry.front)
            #button("↗", "app.open-page", args: (id: entry.pageId), kind: "ghost")
          ], gap: "0.35rem")
        ]
        #if cards.len() > 20 [#muted(body: "+" + str(cards.len() - 20) + " more")]
      ])
    ]

    #muted(body: str(reviews.len()) + " reviews logged")
  ]
}
