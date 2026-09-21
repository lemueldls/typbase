#let double(x) = x * 2
#let greet(name) = [Hello, #name!]

#show heading: it => strong(it.body)

= Shown heading

#greet("world") and #double(21).

#if 1 < 2 [yes] else [no]

#for i in range(3) [#i ]
